import 'dotenv/config'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, test } from 'node:test'
import { GTS_REPRESENTATIVE_EMAIL } from '../server/limits.js'

let server: Server | undefined
let base = ''
let closePools: (() => Promise<void>) | undefined

function sessionCookie(setCookie: string | null) {
  const match = /cc_session=([^;]+)/.exec(setCookie ?? '')
  assert.ok(match, 'session cookie')
  return `cc_session=${match[1]}`
}

async function call(cookie: string | null, method: string, urlPath: string, body?: string) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) as Record<string, unknown> : {}
  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie().join('; ')
    : response.headers.get('set-cookie')
  return { status: response.status, data, cookie: setCookie }
}

after(async () => {
  server?.close()
  await closePools?.()
})

test('designated email becomes the GTS representative without opening free signup', async () => {
  const db = await import('../server/db.js')
  const migrateMod = await import('../server/migrate.js')
  const appMod = await import('../server/app.js')
  closePools = db.closePools
  await migrateMod.migrate()
  await db.adminPool().query(`
    TRUNCATE TABLE
      notifications, access_log, practice_checks, transcript_lines, skill_progress,
      cards, uploads, lesson_plans, consents, invites, teacher_assignments,
      sessions, criteria_versions, memberships, users
    RESTART IDENTITY CASCADE
  `)
  await db.adminPool().query(`DELETE FROM organizations WHERE slug <> 'gts'`)

  const app = appMod.createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server?.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  base = `http://127.0.0.1:${address.port}`

  const owner = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'owner@example.com', password: 'password1', displayName: '기존 대표', mode: 'create_org', organizationName: '해바라기',
  }))
  assert.equal(owner.status, 201)
  const ownerCookie = sessionCookie(owner.cookie)
  const invite = await call(ownerCookie, 'POST', '/api/invites', JSON.stringify({ role: 'teacher' }))
  assert.equal(invite.status, 201)
  const teacher = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'soon@example.com', password: 'password1', displayName: '김선생', mode: 'invite', inviteCode: invite.data.code,
  }))
  assert.equal(teacher.status, 201)
  await db.adminPool().query(`UPDATE users SET email = $1 WHERE email = 'soon@example.com'`, [GTS_REPRESENTATIVE_EMAIL])

  const wrong = await call(null, 'POST', '/api/auth/login', JSON.stringify({
    email: 'JungNLee1117@gmail.com', password: 'nope-nope',
  }))
  assert.equal(wrong.status, 401)
  const stillTeacher = await db.adminPool().query<{ role: string; slug: string }>(
    `SELECT m.role, o.slug FROM memberships m
     JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id
     WHERE u.email = $1`,
    [GTS_REPRESENTATIVE_EMAIL],
  )
  assert.equal(stillTeacher.rows[0].role, 'teacher')
  assert.equal(stillTeacher.rows[0].slug, '해바라기')

  const promoted = await call(null, 'POST', '/api/auth/login', JSON.stringify({
    email: GTS_REPRESENTATIVE_EMAIL, password: 'password1',
  }))
  assert.equal(promoted.status, 200)
  const promotedMe = await call(sessionCookie(promoted.cookie), 'GET', '/api/me')
  const promotedOrg = promotedMe.data.organization as { slug: string; billingTier: string }
  assert.equal(promotedMe.data.role, 'representative')
  assert.equal(promotedOrg.slug, '해바라기')
  assert.equal(promotedOrg.billingTier, 'paid')
  const ownerStill = await db.adminPool().query<{ role: string }>(
    `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'owner@example.com'`,
  )
  assert.equal(ownerStill.rows[0].role, 'representative')

  await db.adminPool().query(
    `DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [GTS_REPRESENTATIVE_EMAIL],
  )
  const linked = await call(null, 'POST', '/api/auth/login', JSON.stringify({
    email: GTS_REPRESENTATIVE_EMAIL, password: 'password1',
  }))
  assert.equal(linked.status, 200)
  const linkedMe = await call(sessionCookie(linked.cookie), 'GET', '/api/me')
  const gts = linkedMe.data.organization as { slug: string; billingTier: string; joinPolicy: string }
  assert.equal(linkedMe.data.role, 'representative')
  assert.equal(gts.slug, 'gts')
  assert.equal(gts.billingTier, 'free')
  assert.equal(gts.joinPolicy, 'invite_or_approval')

  await db.adminPool().query(`DELETE FROM users WHERE email = $1`, [GTS_REPRESENTATIVE_EMAIL])
  await db.adminPool().query(`DELETE FROM organizations WHERE slug = 'gts'`)
  const fresh = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'JungNLee1117@gmail.com', password: 'password1', displayName: '대표', mode: 'create_org', organizationName: '다른기관',
  }))
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data))
  const freshMe = await call(sessionCookie(fresh.cookie), 'GET', '/api/me')
  const created = freshMe.data.organization as { slug: string; billingTier: string; joinPolicy: string }
  assert.equal(freshMe.data.role, 'representative')
  assert.equal(created.slug, 'gts')
  assert.equal(created.billingTier, 'free')
  assert.equal(created.joinPolicy, 'invite_or_approval')
  const stray = await db.adminPool().query(`SELECT 1 FROM organizations WHERE name = '다른기관'`)
  assert.equal(stray.rowCount, 0)

  const again = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: GTS_REPRESENTATIVE_EMAIL, password: 'password1', displayName: '대표', mode: 'gts_request',
  }))
  assert.equal(again.status, 409)

  const reserved = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'free@example.com', password: 'password1', displayName: '무료', mode: 'create_org', organizationName: 'GTS',
  }))
  assert.equal(reserved.status, 400)

  const ask = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'ask@example.com', password: 'password1', displayName: '신청', mode: 'gts_request',
  }))
  assert.equal(ask.status, 201)
  const askMe = await call(sessionCookie(ask.cookie), 'GET', '/api/me')
  assert.equal(askMe.data.role, 'pending')
  assert.equal((askMe.data.memberships as Array<{ role: string; organizationName: string }>)[0].role, 'teacher')
  assert.equal((askMe.data.organization as { slug: string }).slug, 'gts')

  const paid = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'paid@example.com', password: 'password1', displayName: '다른 대표', mode: 'create_org', organizationName: '민들레',
  }))
  assert.equal(paid.status, 201)
  const paidMe = await call(sessionCookie(paid.cookie), 'GET', '/api/me')
  assert.equal(paidMe.data.role, 'representative')
  assert.equal((paidMe.data.organization as { billingTier: string; slug: string }).billingTier, 'paid')
  assert.notEqual((paidMe.data.organization as { slug: string }).slug, 'gts')
})
