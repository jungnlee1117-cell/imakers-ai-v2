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

test('password change and role setting work for the right people', async () => {
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

  const rep = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: GTS_REPRESENTATIVE_EMAIL, password: 'password1', displayName: '대표', mode: 'gts_request',
  }))
  assert.equal(rep.status, 201)
  const repCookie = sessionCookie(rep.cookie)
  const t = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'teacher@example.com', password: 'password1', displayName: '선생님 A', mode: 'gts_request',
  }))
  assert.equal(t.status, 201)
  const tCookie = sessionCookie(t.cookie)
  const tid = (await db.adminPool().query<{ id: string }>(`SELECT id FROM users WHERE email = 'teacher@example.com'`)).rows[0].id

  const team = await call(repCookie, 'GET', '/api/team')
  assert.equal(team.status, 200)
  assert.ok((team.data.members as Array<{ email: string; status: string }>).some((m) => m.email === 'teacher@example.com' && m.status === 'pending'))
  assert.equal((await call(sessionCookie((await call(null, 'POST', '/api/auth/login', JSON.stringify({ email: 'teacher@example.com', password: 'password1' }))).cookie), 'GET', '/api/team')).status, 403)
  // pending teacher cannot see lessons; rep approves
  assert.equal((await call(tCookie, 'GET', '/api/lessons')).status, 403)
  assert.equal((await call(repCookie, 'POST', `/api/memberships/${tid}/decision`, JSON.stringify({ status: 'active' }))).status, 200)
  const lessons = await call(tCookie, 'GET', '/api/lessons')
  assert.equal(lessons.status, 200)

  // teacher cannot change roles
  assert.equal((await call(tCookie, 'POST', `/api/memberships/${tid}/role`, JSON.stringify({ role: 'admin' }))).status, 403)
  // rep can; rep itself cannot be demoted
  assert.equal((await call(repCookie, 'POST', `/api/memberships/${tid}/role`, JSON.stringify({ role: 'admin' }))).status, 200)
  const repId = (await db.adminPool().query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [GTS_REPRESENTATIVE_EMAIL])).rows[0].id
  assert.equal((await call(repCookie, 'POST', `/api/memberships/${repId}/role`, JSON.stringify({ role: 'teacher' }))).status, 404)
  assert.equal((await call(repCookie, 'POST', `/api/memberships/${tid}/role`, JSON.stringify({ role: 'teacher' }))).status, 200)

  // password change
  assert.equal((await call(tCookie, 'POST', '/api/auth/password', JSON.stringify({ currentPassword: 'wrong-one', newPassword: 'newpassword1' }))).status, 400)
  assert.equal((await call(tCookie, 'POST', '/api/auth/password', JSON.stringify({ currentPassword: 'password1', newPassword: 'short' }))).status, 400)
  assert.equal((await call(tCookie, 'POST', '/api/auth/password', JSON.stringify({ currentPassword: 'password1', newPassword: 'newpassword1' }))).status, 200)
  assert.equal((await call(null, 'POST', '/api/auth/login', JSON.stringify({ email: 'teacher@example.com', password: 'password1' }))).status, 401)
  assert.equal((await call(null, 'POST', '/api/auth/login', JSON.stringify({ email: 'teacher@example.com', password: 'newpassword1' }))).status, 200)
  assert.equal((await call(null, 'POST', '/api/auth/password', JSON.stringify({ currentPassword: 'a', newPassword: 'newpassword2' }))).status, 401)
})
