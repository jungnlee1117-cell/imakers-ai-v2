import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { adminPool } from './db.js'
import { extractAudio, probeDuration } from './ffmpeg.js'
import { removeChunks } from './files.js'
import { resolveDataKey } from './paths.js'
import { getLessonProcessor } from './card/processor.js'
import { mergeSkillEvents } from './card/skills.js'
import type { CardDocument, SkillId } from './card/types.js'
import { assertValidCard } from './card/validate.js'

const SKILLS: SkillId[] = ['praise', 'rule_as_question', 'child_care']

type Claimed = {
  id: string
  organization_id: string
  teacher_id: string
  lesson_date: string
  class_name: string
  sport: string
  language_mode: 'english' | 'korean' | 'mixed'
  media_kind: 'video' | 'audio'
  file_path: string | null
  audio_path: string | null
  worker_token: string
}

async function claim(): Promise<Claimed | null> {
  const token = randomUUID()
  const result = await adminPool().query<Claimed>(`
    WITH next AS (
      SELECT id FROM uploads
      WHERE status = 'queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE uploads u
    SET status = 'processing',
        worker_token = $1,
        processing_started_at = now(),
        failure_reason = NULL,
        updated_at = now()
    FROM next
    WHERE u.id = next.id
    RETURNING u.id, u.organization_id, u.teacher_id, u.lesson_date::text, u.class_name, u.sport,
              u.language_mode, u.media_kind, u.file_path, u.audio_path, u.worker_token
  `, [token])
  return result.rows[0] ?? null
}

async function notify(organizationId: string, userIds: string[], kind: string, uploadId: string, message: string) {
  if (!userIds.length) return
  await adminPool().query(
    `INSERT INTO notifications (organization_id, user_id, kind, upload_id, message)
     SELECT $1, unnest($2::uuid[]), $3, $4, $5`,
    [organizationId, userIds, kind, uploadId, message],
  )
}

async function representativeIds(organizationId: string) {
  const result = await adminPool().query<{ user_id: string }>(
    `SELECT user_id FROM memberships
     WHERE organization_id = $1 AND role = 'representative' AND status = 'active'`,
    [organizationId],
  )
  return result.rows.map((row) => row.user_id)
}

async function fail(upload: Claimed, reason: string) {
  const updated = await adminPool().query(
    `UPDATE uploads
     SET status = 'failed', failure_reason = $2, worker_token = NULL, updated_at = now()
     WHERE id = $1 AND worker_token = $3 AND status = 'processing'`,
    [upload.id, reason.slice(0, 500), upload.worker_token],
  )
  if (!updated.rowCount) return
  const reps = await representativeIds(upload.organization_id)
  await notify(
    upload.organization_id,
    reps,
    'processing_failed',
    upload.id,
    `${upload.class_name} 수업 처리가 실패했습니다. ${reason}`.slice(0, 500),
  )
}

async function ensureAudio(upload: Claimed) {
  if (upload.audio_path) return upload.audio_path
  if (!upload.file_path) throw new Error('파일이 없습니다.')
  const input = resolveDataKey(upload.file_path)
  if (upload.media_kind === 'video') {
    const key = `uploads/${upload.id}/audio.m4a`
    await extractAudio(input, resolveDataKey(key))
    const saved = await adminPool().query(
      `UPDATE uploads SET audio_path = $2, updated_at = now()
       WHERE id = $1 AND worker_token = $3 AND status = 'processing'`,
      [upload.id, key, upload.worker_token],
    )
    if (!saved.rowCount) throw new Error('처리 권한이 넘어갔습니다.')
    await rm(input, { force: true })
    await removeChunks(upload.id)
    await adminPool().query(
      `UPDATE uploads SET file_path = NULL, updated_at = now() WHERE id = $1 AND worker_token = $2`,
      [upload.id, upload.worker_token],
    )
    return key
  }
  await adminPool().query(
    `UPDATE uploads SET audio_path = file_path, file_path = NULL, updated_at = now()
     WHERE id = $1 AND worker_token = $2 AND status = 'processing'`,
    [upload.id, upload.worker_token],
  )
  return upload.file_path
}

async function planText(upload: Claimed) {
  const month = upload.lesson_date.slice(0, 7) + '-01'
  const result = await adminPool().query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM lesson_plans
     WHERE organization_id = $1 AND teacher_id = $2 AND sport = $3 AND language_mode = $4 AND month = $5::date
     ORDER BY created_at DESC LIMIT 1`,
    [upload.organization_id, upload.teacher_id, upload.sport, upload.language_mode, month],
  )
  const text = result.rows[0]?.extracted_text?.trim()
  return text || null
}

async function saveResult(upload: Claimed, card: CardDocument, lines: { start_sec: number; text: string; trusted: boolean }[], adapterId: string, duration: number | null) {
  const client = await adminPool().connect()
  try {
    await client.query('BEGIN')
    const still = await client.query(
      `SELECT 1 FROM uploads WHERE id = $1 AND worker_token = $2 AND status = 'processing' FOR UPDATE`,
      [upload.id, upload.worker_token],
    )
    if (!still.rowCount) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(`DELETE FROM transcript_lines WHERE upload_id = $1`, [upload.id])
    await client.query(`DELETE FROM cards WHERE upload_id = $1`, [upload.id])
    for (const line of lines) {
      await client.query(
        `INSERT INTO transcript_lines (upload_id, organization_id, teacher_id, start_sec, text, trusted)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [upload.id, upload.organization_id, upload.teacher_id, line.start_sec, line.text, line.trusted],
      )
    }
    await client.query(
      `INSERT INTO cards (upload_id, organization_id, teacher_id, document) VALUES ($1, $2, $3, $4::jsonb)`,
      [upload.id, upload.organization_id, upload.teacher_id, JSON.stringify(card)],
    )
    for (const skillId of SKILLS) {
      const current = await client.query<{ expressions: string[] }>(
        `SELECT expressions FROM skill_progress WHERE organization_id = $1 AND teacher_id = $2 AND skill_id = $3`,
        [upload.organization_id, upload.teacher_id, skillId],
      )
      const merged = mergeSkillEvents(current.rows[0]?.expressions ?? [], card.skill_events, skillId)
      await client.query(
        `INSERT INTO skill_progress (organization_id, teacher_id, skill_id, expressions, latest_new, first_upload_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (organization_id, teacher_id, skill_id) DO UPDATE
         SET expressions = (
           SELECT COALESCE(array_agg(DISTINCT item), '{}')
           FROM unnest(skill_progress.expressions || EXCLUDED.expressions) AS item
         ),
         latest_new = EXCLUDED.latest_new,
         first_upload_id = COALESCE(skill_progress.first_upload_id, EXCLUDED.first_upload_id),
         updated_at = now()`,
        [upload.organization_id, upload.teacher_id, skillId, merged.all, merged.added, upload.id],
      )
    }
    await client.query(
      `UPDATE uploads
       SET status = 'done', transcript_adapter = $2, duration_seconds = COALESCE($3, duration_seconds),
           failure_reason = NULL, worker_token = NULL, updated_at = now()
       WHERE id = $1 AND worker_token = $4 AND status = 'processing'`,
      [upload.id, adapterId, duration, upload.worker_token],
    )
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function processNext(): Promise<{ status: 'idle' } | { status: 'done'; uploadId: string } | { status: 'failed'; uploadId: string; reason: string }> {
  const upload = await claim()
  if (!upload) return { status: 'idle' }
  try {
    const audioKey = await ensureAudio(upload)
    const duration = await probeDuration(resolveDataKey(audioKey))
    const processor = getLessonProcessor()
    const output = await processor.process({
      audioPath: resolveDataKey(audioKey),
      sport: upload.sport,
      languageMode: upload.language_mode,
      planText: await planText(upload),
      lessonDate: upload.lesson_date,
      className: upload.class_name,
      source: upload.media_kind,
    })
    assertValidCard(output.card)
    const saved = await saveResult(upload, output.card, output.transcript_lines, processor.id, duration)
    if (!saved) return { status: 'idle' }
    await notify(upload.organization_id, [upload.teacher_id], 'card_ready', upload.id, '수업 카드가 준비되었습니다.')
    return { status: 'done', uploadId: upload.id }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '처리를 끝내지 못했습니다.'
    await fail(upload, reason)
    return { status: 'failed', uploadId: upload.id, reason }
  }
}

export async function sweepStuck() {
  const stuck = await adminPool().query<{ id: string; organization_id: string; class_name: string }>(
    `UPDATE uploads
     SET status = 'failed',
         failure_reason = '처리가 중간에 멈췄습니다. 다시 시도해 주세요.',
         worker_token = NULL,
         updated_at = now()
     WHERE status = 'processing' AND processing_started_at < now() - interval '30 minutes'
     RETURNING id, organization_id, class_name`,
  )
  for (const upload of stuck.rows) {
    const reps = await representativeIds(upload.organization_id)
    await notify(upload.organization_id, reps, 'processing_failed', upload.id, `${upload.class_name} 수업 처리가 중간에 멈췄습니다.`)
  }
}
