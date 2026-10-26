import 'dotenv/config'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Server } from 'node:http'
import { after, test } from 'node:test'

const execFileAsync = promisify(execFile)

let server: Server | undefined
let base = ''
let closePools: (() => Promise<void>) | undefined

function sessionCookie(setCookie: string | null) {
  const match = /cc_session=([^;]+)/.exec(setCookie ?? '')
  assert.ok(match, 'session cookie')
  return `cc_session=${match[1]}`
}

async function call(cookie: string | null, method: string, urlPath: string, body?: BodyInit, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    body,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) as Record<string, unknown> : {}
  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie().join('; ')
    : response.headers.get('set-cookie')
  return { status: response.status, data, cookie: setCookie }
}

async function signup(email: string, extra: Record<string, string>) {
  const response = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email, password: 'password1', displayName: email, ...extra,
  }), { 'content-type': 'application/json' })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  return sessionCookie(response.cookie)
}

after(async () => {
  server?.close()
  await closePools?.()
})

test('a representative uploads a same-org teacher lesson and nobody else can', async () => {
  process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'coach-rep-'))
  process.env.SIGNING_SECRET = 'test-signing-secret-012345'
  // .env 가 process-run 이어도 테스트는 고정 결과만 쓰고 API를 부르지 않는다
  process.env.PROCESSOR_ID = 'local-band'
  delete process.env.ANTHROPIC_API_KEY
  const db = await import('../server/db.js')
  const migrateMod = await import('../server/migrate.js')
  const appMod = await import('../server/app.js')
  const worker = await import('../server/worker.js')
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

  const rep = await signup('rep-up@example.com', { mode: 'create_org', organizationName: '해바라기' })
  const invite = await call(rep, 'POST', '/api/invites', JSON.stringify({ role: 'teacher' }), { 'content-type': 'application/json' })
  const teacher = await signup('teacher-up@example.com', { mode: 'invite', inviteCode: String(invite.data.code) })
  const teacherMe = await call(teacher, 'GET', '/api/me')
  const teacherId = (teacherMe.data.user as { id: string }).id
  const adminInvite = await call(rep, 'POST', '/api/invites', JSON.stringify({ role: 'admin' }), { 'content-type': 'application/json' })
  const admin = await signup('admin-up@example.com', { mode: 'invite', inviteCode: String(adminInvite.data.code) })
  const adminMe = await call(admin, 'GET', '/api/me')
  const assigned = await call(rep, 'POST', '/api/assignments', JSON.stringify({
    adminId: (adminMe.data.user as { id: string }).id,
    teacherId,
  }), { 'content-type': 'application/json' })
  assert.equal(assigned.status, 201)
  const otherRep = await signup('other-up@example.com', { mode: 'create_org', organizationName: '다른 기관' })
  const otherInvite = await call(otherRep, 'POST', '/api/invites', JSON.stringify({ role: 'teacher' }), { 'content-type': 'application/json' })
  const otherTeacher = await signup('other-teacher@example.com', { mode: 'invite', inviteCode: String(otherInvite.data.code) })
  const otherTeacherId = ((await call(otherTeacher, 'GET', '/api/me')).data.user as { id: string }).id

  assert.equal((await call(rep, 'POST', '/api/consents', '{}', { 'content-type': 'application/json' })).status, 201)
  assert.equal((await call(teacher, 'POST', '/api/consents', '{}', { 'content-type': 'application/json' })).status, 201)
  assert.equal((await call(admin, 'POST', '/api/consents', '{}', { 'content-type': 'application/json' })).status, 201)
  assert.equal((await call(otherRep, 'POST', '/api/consents', '{}', { 'content-type': 'application/json' })).status, 201)

  const wav = path.join(process.env.DATA_DIR, 'lesson.wav')
  await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
  const wavBytes = await readFile(wav)
  const initBody = {
    filename: 'lesson.wav', byteSize: wavBytes.length, contentType: 'audio/wav',
    lessonDate: '2026-10-25', className: '대표가 올린 반', sport: 'soccer', languageMode: 'korean',
    teacherId,
  }
  const missingTeacher = await call(rep, 'POST', '/api/uploads/init', JSON.stringify({ ...initBody, teacherId: undefined }), { 'content-type': 'application/json' })
  assert.equal(missingTeacher.status, 400)
  const init = await call(rep, 'POST', '/api/uploads/init', JSON.stringify(initBody), { 'content-type': 'application/json' })
  assert.equal(init.status, 201, JSON.stringify(init.data))
  const uploadId = String(init.data.id)
  await call(rep, 'PUT', `/api/uploads/${uploadId}/chunks/0`, wavBytes, { 'content-type': 'application/octet-stream' })
  const queued = await call(rep, 'POST', `/api/uploads/${uploadId}/complete`)
  assert.equal(queued.status, 200, JSON.stringify(queued.data))
  assert.equal(queued.data.status, 'queued')

  const teacherList = await call(teacher, 'GET', '/api/uploads')
  const teacherRows = teacherList.data.uploads as Array<{ id: string; className: string; status: string }>
  assert.equal(teacherRows.some((row) => row.id === uploadId && row.className === '대표가 올린 반' && row.status === 'queued'), true)
  const repList = await call(rep, 'GET', '/api/uploads')
  assert.equal((repList.data.uploads as Array<{ id: string }>).some((row) => row.id === uploadId), true)

  const processed = await worker.processNext()
  assert.equal(processed.status, 'done')
  const card = await call(teacher, 'GET', `/api/uploads/${uploadId}`)
  const document = card.data.card as { schema_version: string; area_reviews?: unknown[] }
  assert.equal(document.schema_version, '1.1')
  assert.ok(document.area_reviews && document.area_reviews.length >= 1)
  const stored = await db.adminPool().query<{ teacher_id: string; status: string; organization_id: string }>(
    `SELECT u.teacher_id, u.status, u.organization_id FROM uploads u WHERE u.id = $1`,
    [uploadId],
  )
  assert.equal(stored.rows[0].teacher_id, teacherId)
  assert.equal(stored.rows[0].status, 'done')
  const cardOwner = await db.adminPool().query<{ teacher_id: string }>(`SELECT teacher_id FROM cards WHERE upload_id = $1`, [uploadId])
  assert.equal(cardOwner.rows[0].teacher_id, teacherId)

  const mp4 = path.join(process.env.DATA_DIR, 'lesson.mp4')
  await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', mp4])
  const videoBytes = await readFile(mp4)
  const videoInit = await call(rep, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'lesson.mp4', byteSize: videoBytes.length, contentType: 'video/mp4',
    lessonDate: '2026-10-26', className: '영상반', sport: 'jumprope', languageMode: 'korean', teacherId,
  }), { 'content-type': 'application/json' })
  assert.equal(videoInit.status, 201, JSON.stringify(videoInit.data))
  const videoId = String(videoInit.data.id)
  await call(rep, 'PUT', `/api/uploads/${videoId}/chunks/0`, videoBytes, { 'content-type': 'application/octet-stream' })
  assert.equal((await call(rep, 'POST', `/api/uploads/${videoId}/complete`)).status, 200)
  assert.equal((await worker.processNext()).status, 'done')
  const videoRow = await db.adminPool().query<{ teacher_id: string; file_path: string | null; audio_path: string | null; media_kind: string }>(
    `SELECT teacher_id, file_path, audio_path, media_kind FROM uploads WHERE id = $1`,
    [videoId],
  )
  assert.equal(videoRow.rows[0].teacher_id, teacherId)
  assert.equal(videoRow.rows[0].media_kind, 'video')
  assert.equal(videoRow.rows[0].file_path, null)
  assert.ok(videoRow.rows[0].audio_path?.endsWith('.m4a'))
  await assert.rejects(stat(path.join(process.env.DATA_DIR, 'uploads', videoId, 'original.mp4')))
  const seen = await call(teacher, 'GET', '/api/uploads')
  assert.equal((seen.data.uploads as Array<{ id: string }>).some((row) => row.id === videoId), true)

  const outsider = await call(otherRep, 'POST', '/api/uploads/init', JSON.stringify({ ...initBody, filename: 'x.wav', byteSize: 1000 }), { 'content-type': 'application/json' })
  assert.equal(outsider.status, 403)
  const intoOther = await call(rep, 'POST', '/api/uploads/init', JSON.stringify({ ...initBody, teacherId: otherTeacherId, filename: 'y.wav', byteSize: 1000 }), { 'content-type': 'application/json' })
  assert.equal(intoOther.status, 403)
  const adminUpload = await call(admin, 'POST', '/api/uploads/init', JSON.stringify(initBody), { 'content-type': 'application/json' })
  assert.equal(adminUpload.status, 403)
  const teacherCross = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({ ...initBody, teacherId: otherTeacherId }), { 'content-type': 'application/json' })
  assert.equal(teacherCross.status, 403)
  const own = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'own.wav', byteSize: wavBytes.length, contentType: 'audio/wav',
    lessonDate: '2026-10-27', className: '본인 반', sport: 'soccer', languageMode: 'korean',
  }), { 'content-type': 'application/json' })
  assert.equal(own.status, 201)
  assert.equal((await call(otherRep, 'GET', `/api/uploads/${uploadId}`)).status, 404)
  assert.equal((await call(admin, 'GET', `/api/uploads/${uploadId}`)).status, 200)
})
