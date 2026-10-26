import 'dotenv/config'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { after, test } from 'node:test'
import type { Server } from 'node:http'

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

after(async () => {
  server?.close()
  await closePools?.()
})

test('upload, band card, practice, skills, and role boundaries', async () => {
  process.env.UPLOAD_CHUNK_BYTES = '65536'
  process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'coach-'))
  process.env.SIGNING_SECRET = 'test-signing-secret-012345'
  // .env 가 process-run 이어도 테스트는 고정 결과만 쓰고 API를 부르지 않는다
  process.env.PROCESSOR_ID = 'local-band'
  delete process.env.ANTHROPIC_API_KEY
  const db = await import('../server/db.js')
  const migrateMod = await import('../server/migrate.js')
  const appMod = await import('../server/app.js')
  const worker = await import('../server/worker.js')
  const retention = await import('../server/retention.js')
  const band = await import('../server/card/band.js')
  const processor = await import('../server/card/processor.js')
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

  const repSignup = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'rep@example.com', password: 'password1', displayName: '대표', mode: 'create_org', organizationName: '해바라기',
  }), { 'content-type': 'application/json' })
  assert.equal(repSignup.status, 201)
  const repSession = sessionCookie(repSignup.cookie)

  const invite = await call(repSession, 'POST', '/api/invites', JSON.stringify({ role: 'teacher' }), { 'content-type': 'application/json' })
  assert.equal(invite.status, 201)
  const teacherSignup = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'teacher@example.com', password: 'password1', displayName: '김선생', mode: 'invite', inviteCode: invite.data.code,
  }), { 'content-type': 'application/json' })
  assert.equal(teacherSignup.status, 201)
  const teacher = sessionCookie(teacherSignup.cookie)
  const teacherMe = await call(teacher, 'GET', '/api/me')
  const teacherId = (teacherMe.data.user as { id: string }).id

  const adminInvite = await call(repSession, 'POST', '/api/invites', JSON.stringify({ role: 'admin' }), { 'content-type': 'application/json' })
  const adminSignup = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'admin@example.com', password: 'password1', displayName: '관리자', mode: 'invite', inviteCode: adminInvite.data.code,
  }), { 'content-type': 'application/json' })
  const adminCookie = sessionCookie(adminSignup.cookie)
  const adminMe = await call(adminCookie, 'GET', '/api/me')
  const adminId = (adminMe.data.user as { id: string }).id
  const assigned = await call(repSession, 'POST', '/api/assignments', JSON.stringify({ adminId, teacherId }), { 'content-type': 'application/json' })
  assert.equal(assigned.status, 201)

  const otherAdminInvite = await call(repSession, 'POST', '/api/invites', JSON.stringify({ role: 'admin' }), { 'content-type': 'application/json' })
  const otherAdminSignup = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'admin2@example.com', password: 'password1', displayName: '다른 관리자', mode: 'invite', inviteCode: otherAdminInvite.data.code,
  }), { 'content-type': 'application/json' })
  const otherAdmin = sessionCookie(otherAdminSignup.cookie)

  const otherRep = await call(null, 'POST', '/api/auth/signup', JSON.stringify({
    email: 'other@example.com', password: 'password1', displayName: '다른 대표', mode: 'create_org', organizationName: '다른 기관',
  }), { 'content-type': 'application/json' })
  const otherCookie = sessionCookie(otherRep.cookie)

  const tooBig = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'big.mp4', byteSize: 1024 * 1024 * 1024 + 1, contentType: 'video/mp4',
    lessonDate: '2026-10-25', className: '해바라기반', sport: 'soccer', languageMode: 'english',
  }), { 'content-type': 'application/json' })
  assert.equal(tooBig.status, 403)

  const consented = await call(teacher, 'POST', '/api/consents', '{}', { 'content-type': 'application/json' })
  assert.equal(consented.status, 201)
  const stillTooBig = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'big.mp4', byteSize: 1024 * 1024 * 1024 + 1, contentType: 'video/mp4',
    lessonDate: '2026-10-25', className: '해바라기반', sport: 'soccer', languageMode: 'english',
  }), { 'content-type': 'application/json' })
  assert.equal(stillTooBig.status, 413)

  const pdf = pdfWith('Greeting circle')
  const plan = await call(teacher, 'POST', '/api/lesson-plans', pdf, {
    'content-type': 'application/pdf',
    'x-month': '2026-10',
    'x-sport': 'soccer',
    'x-language-mode': 'english',
  })
  assert.equal(plan.status, 201, JSON.stringify(plan.data))

  const wav = path.join(process.env.DATA_DIR, 'sample.wav')
  await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
  const wavBytes = await readFile(wav)
  assert.ok(wavBytes.length > 65536)
  const init = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'lesson.wav', byteSize: wavBytes.length, contentType: 'audio/wav',
    lessonDate: '2026-10-25', className: '해바라기반', sport: 'soccer', languageMode: 'english',
  }), { 'content-type': 'application/json' })
  assert.equal(init.status, 201, JSON.stringify(init.data))
  const uploadId = String(init.data.id)
  const chunkSize = Number(init.data.chunkSize)
  await call(teacher, 'PUT', `/api/uploads/${uploadId}/chunks/0`, wavBytes.subarray(0, chunkSize), { 'content-type': 'application/octet-stream' })
  const partial = await call(teacher, 'POST', `/api/uploads/${uploadId}/complete`)
  assert.equal(partial.status, 409)
  const resumed = await call(teacher, 'GET', `/api/uploads/${uploadId}`)
  const received = (resumed.data.upload as { receivedChunks: number[] }).receivedChunks
  assert.deepEqual(received, [0])
  await call(teacher, 'PUT', `/api/uploads/${uploadId}/chunks/1`, wavBytes.subarray(chunkSize), { 'content-type': 'application/octet-stream' })
  const doneUpload = await call(teacher, 'POST', `/api/uploads/${uploadId}/complete`)
  assert.equal(doneUpload.status, 200, JSON.stringify(doneUpload.data))

  const processed = await worker.processNext()
  assert.equal(processed.status, 'done')
  const cardResponse = await call(teacher, 'GET', `/api/uploads/${uploadId}`)
  const card = cardResponse.data.card as { lesson: { class_name: string }; plan_adherence: { status: string; planned?: string[] }; english_phrases?: unknown; skill_events: unknown[] }
  assert.equal(card.lesson.class_name, '해바라기반')
  assert.equal(card.plan_adherence.status, 'done')
  assert.ok(card.plan_adherence.planned?.includes('Greeting circle'))
  assert.ok(card.english_phrases)
  assert.doesNotMatch(JSON.stringify(cardResponse.data.card), /\b(Haru|Jian|Lucas)\b/)
  assert.equal(cardResponse.data.processorNotice, band.LOCAL_BAND_NOTICE)
  assert.equal(JSON.stringify(cardResponse.data).includes('audio_path'), false)
  const practice = await call(teacher, 'POST', '/api/practice', JSON.stringify({ uploadId, itemKey: 's1', checked: true }), { 'content-type': 'application/json' })
  assert.equal(practice.status, 200, JSON.stringify(practice.data))
  const today = await call(teacher, 'GET', '/api/practice')
  assert.ok((today.data.checked as string[]).includes('s1'))
  assert.ok(Number(today.data.streak) >= 1)
  const skills = await call(teacher, 'GET', '/api/skills')
  const praise = (skills.data.skills as Array<{ id: string; stage: string; expressions: string[]; newExpressions: string[] }>).find((skill) => skill.id === 'praise')
  assert.ok(praise)
  assert.equal(praise?.stage, '새싹')
  assert.ok((praise?.expressions.length ?? 0) >= 1)
  assert.ok((praise?.newExpressions.length ?? 0) >= 1)
  const line = (cardResponse.data.lines as Array<{ id: string; trusted: boolean }>).find((item) => item.trusted === false)
  assert.ok(line)
  const marked = await call(teacher, 'POST', `/api/transcript-lines/${line?.id}/check`, JSON.stringify({ teacherCheck: 'rejected' }), { 'content-type': 'application/json' })
  assert.equal(marked.status, 200)
  const afterCheck = await call(teacher, 'GET', `/api/uploads/${uploadId}`)
  assert.equal(
    (afterCheck.data.lines as Array<{ id: string; teacher_check: string }>).find((item) => item.id === line?.id)?.teacher_check,
    'rejected',
  )
  assert.equal((afterCheck.data.card as { skill_events: unknown[] }).skill_events.length, card.skill_events.length)

  const adminList = await call(adminCookie, 'GET', '/api/teachers')
  assert.ok((adminList.data.teachers as Array<{ id: string }>).some((item) => item.id === teacherId))
  const stranger = await call(otherAdmin, 'GET', `/api/uploads/${uploadId}`)
  assert.equal(stranger.status, 404)
  const outside = await call(otherCookie, 'GET', `/api/uploads/${uploadId}`)
  assert.equal(outside.status, 404)
  const teacherLog = await call(teacher, 'GET', '/api/access-log')
  assert.equal(teacherLog.status, 403)

  const audioUrl = String(cardResponse.data.audioUrl)
  const media = await fetch(`${base}${audioUrl}`, { headers: { cookie: teacher, range: 'bytes=0-10' } })
  assert.equal(media.status, 206)
  const repLog = await call(repSession, 'GET', '/api/access-log')
  assert.ok((repLog.data.entries as unknown[]).length >= 1)

  const mp4 = path.join(process.env.DATA_DIR, 'sample.mp4')
  await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', mp4])
  const videoBytes = await readFile(mp4)
  const videoInit = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'class.mp4', byteSize: videoBytes.length, contentType: 'video/mp4',
    lessonDate: '2026-10-26', className: '해바라기반', sport: 'soccer', languageMode: 'english',
  }), { 'content-type': 'application/json' })
  const videoId = String(videoInit.data.id)
  await call(teacher, 'PUT', `/api/uploads/${videoId}/chunks/0`, videoBytes, { 'content-type': 'application/octet-stream' })
  assert.equal((await call(teacher, 'POST', `/api/uploads/${videoId}/complete`)).status, 200)
  assert.equal((await worker.processNext()).status, 'done')
  const stored = await db.adminPool().query<{ file_path: string | null; audio_path: string | null }>(
    `SELECT file_path, audio_path FROM uploads WHERE id = $1`,
    [videoId],
  )
  assert.equal(stored.rows[0].file_path, null)
  assert.ok(stored.rows[0].audio_path?.endsWith('.m4a'))
  await assert.rejects(stat(path.join(process.env.DATA_DIR, 'uploads', videoId, 'original.mp4')))
  const probe = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', path.join(process.env.DATA_DIR, stored.rows[0].audio_path ?? '')])
  assert.match(probe.stdout, /16000/)

  const bad = Buffer.from('this is not a video')
  const badInit = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'bad.mp4', byteSize: bad.length, contentType: 'video/mp4',
    lessonDate: '2026-10-27', className: '해바라기반', sport: 'soccer', languageMode: 'english',
  }), { 'content-type': 'application/json' })
  const badId = String(badInit.data.id)
  await call(teacher, 'PUT', `/api/uploads/${badId}/chunks/0`, bad, { 'content-type': 'application/octet-stream' })
  assert.equal((await call(teacher, 'POST', `/api/uploads/${badId}/complete`)).status, 200)
  const failed = await worker.processNext()
  assert.equal(failed.status, 'failed')
  const notes = await call(repSession, 'GET', '/api/notifications')
  assert.ok((notes.data.notifications as Array<{ message: string }>).some((note) => note.message.includes('실패')))
  assert.equal((await call(teacher, 'POST', `/api/uploads/${badId}/retry`)).status, 200)
  const requeued = await db.adminPool().query<{ status: string }>(`SELECT status FROM uploads WHERE id = $1`, [badId])
  assert.equal(requeued.rows[0].status, 'queued')
  await db.adminPool().query(`UPDATE uploads SET status = 'failed', failure_reason = '테스트에서 대기열에서 빼 둠' WHERE id = $1`, [badId])

  const onceWav = path.join(process.env.DATA_DIR, 'once.wav')
  await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', onceWav])
  const onceBytes = await readFile(onceWav)
  const onceInit = await call(teacher, 'POST', '/api/uploads/init', JSON.stringify({
    filename: 'once.wav', byteSize: onceBytes.length, contentType: 'audio/wav',
    lessonDate: '2026-10-28', className: '해바라기반', sport: 'soccer', languageMode: 'english',
  }), { 'content-type': 'application/json' })
  assert.equal(onceInit.status, 201, JSON.stringify(onceInit.data))
  const onceId = String(onceInit.data.id)
  await call(teacher, 'PUT', `/api/uploads/${onceId}/chunks/0`, onceBytes, { 'content-type': 'application/octet-stream' })
  assert.equal((await call(teacher, 'POST', `/api/uploads/${onceId}/complete`)).status, 200)

  let processorCalls = 0
  processor.setLessonProcessorForTests({
    id: 'local-band',
    async process(input) {
      processorCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 200))
      return band.localBandProcessor.process(input)
    },
  })
  const [first, second] = await Promise.all([worker.processNext(), worker.processNext()])
  const statuses = [first.status, second.status].sort()
  assert.deepEqual(statuses, ['done', 'idle'])
  assert.equal(processorCalls, 1)
  const cards = await db.adminPool().query<{ count: number }>(`SELECT count(*)::int AS count FROM cards WHERE upload_id = $1`, [onceId])
  assert.equal(cards.rows[0].count, 1)
  const badCards = await db.adminPool().query<{ count: number }>(`SELECT count(*)::int AS count FROM cards WHERE upload_id = $1`, [badId])
  assert.equal(badCards.rows[0].count, 0)
  processor.setLessonProcessorForTests(null)

  await db.adminPool().query(`UPDATE uploads SET expires_at = now() - interval '1 day' WHERE id = $1`, [uploadId])
  const removed = await retention.runRetention()
  assert.ok(removed >= 1)
  assert.equal((await call(teacher, 'GET', `/api/uploads/${uploadId}`)).status, 404)
  await rm(process.env.DATA_DIR, { recursive: true, force: true })
})

function pdfWith(text: string) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(body.length)
    body += `${object}\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}
