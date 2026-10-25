import 'dotenv/config'
import assert from 'node:assert/strict'
import pg from 'pg'
import { test } from 'node:test'
import { adminPool, closePools } from '../server/db.js'
import { migrate } from '../server/migrate.js'

const org1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const org2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const teacherA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const teacherC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'
const teacherB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const admin = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const rep1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const rep2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
const uploadA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const uploadC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
const uploadB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'

async function reset() {
  await adminPool().query(`
    TRUNCATE TABLE
      notifications, access_log, practice_checks, transcript_lines, skill_progress,
      cards, uploads, lesson_plans, consents, invites, teacher_assignments,
      sessions, criteria_versions, memberships, users
    RESTART IDENTITY CASCADE
  `)
  await adminPool().query(`DELETE FROM organizations WHERE slug <> 'gts'`)
}

test('row security lets a teacher read only their rows and an admin only assigned teachers', async () => {
  await migrate()
  await reset()
  const adminDb = adminPool()
  const role = await adminDb.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'class_coach_app'`)
  assert.equal(role.rows[0].rolsuper, false)
  assert.equal(role.rows[0].rolbypassrls, false)
  const forced = await adminDb.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'uploads'`)
  assert.equal(forced.rows[0].relrowsecurity, true)
  assert.equal(forced.rows[0].relforcerowsecurity, true)
  await assert.rejects(adminDb.query(
    `INSERT INTO uploads (organization_id, teacher_id, lesson_date, class_name, sport, language_mode, original_filename, byte_size, media_kind, content_type, status, chunk_size, expected_chunks)
     VALUES ($1, $2, '2026-10-01', '반', 'soccer', 'english', 'too.mp4', 1073741825, 'video', 'video/mp4', 'uploading', 5242880, 1)`,
    [org1, teacherA],
  ))

  await adminDb.query(`INSERT INTO organizations (id, name, slug, billing_tier, join_policy) VALUES
    ($1, '하나', 'one', 'paid', 'invite_only'),
    ($2, '둘', 'two', 'paid', 'invite_only')`, [org1, org2])
  for (const [id, email, name] of [
    [teacherA, 'a@example.com', '선생님 A'],
    [teacherC, 'c@example.com', '선생님 C'],
    [teacherB, 'b@example.com', '선생님 B'],
    [admin, 'admin@example.com', '관리자'],
    [rep1, 'rep1@example.com', '대표 1'],
    [rep2, 'rep2@example.com', '대표 2'],
  ] as const) {
    await adminDb.query(`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'scrypt$x$00', $3)`, [id, email, name])
  }
  await adminDb.query(`INSERT INTO memberships (user_id, organization_id, role, status) VALUES
    ($1, $3, 'teacher', 'active'),
    ($2, $3, 'teacher', 'active'),
    ($4, $3, 'admin', 'active'),
    ($5, $3, 'representative', 'active'),
    ($6, $7, 'teacher', 'active'),
    ($8, $7, 'representative', 'active')`, [teacherA, teacherC, org1, admin, rep1, teacherB, org2, rep2])
  await adminDb.query(
    `INSERT INTO teacher_assignments (organization_id, admin_id, teacher_id) VALUES ($1, $2, $3)`,
    [org1, admin, teacherA],
  )
  for (const [id, org, teacher, className] of [
    [uploadA, org1, teacherA, 'A반'],
    [uploadC, org1, teacherC, 'C반'],
    [uploadB, org2, teacherB, 'B반'],
  ] as const) {
    await adminDb.query(
      `INSERT INTO uploads (id, organization_id, teacher_id, lesson_date, class_name, sport, language_mode, original_filename, byte_size, media_kind, content_type, status, chunk_size, expected_chunks)
       VALUES ($1, $2, $3, '2026-10-01', $4, 'soccer', 'english', 'lesson.m4a', 1000, 'audio', 'audio/mp4', 'done', 5242880, 1)`,
      [id, org, teacher, className],
    )
    await adminDb.query(
      `INSERT INTO transcript_lines (upload_id, organization_id, teacher_id, start_sec, text, trusted)
       VALUES ($1, $2, $3, 1, 'hello', true)`,
      [id, org, teacher],
    )
    await adminDb.query(
      `INSERT INTO cards (upload_id, organization_id, teacher_id, document) VALUES ($1, $2, $3, '{"schema_version":"1.0"}')`,
      [id, org, teacher],
    )
  }
  await adminDb.query(
    `INSERT INTO access_log (organization_id, user_id, target_type, target_id) VALUES ($1, $2, 'recording', $3)`,
    [org1, rep1, uploadA],
  )

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    async function as(userId: string, organizationId: string, roleName: string) {
      await client.query(`SELECT set_config('app.user_id', $1, false)`, [userId])
      await client.query(`SELECT set_config('app.organization_id', $1, false)`, [organizationId])
      await client.query(`SELECT set_config('app.role', $1, false)`, [roleName])
    }
    async function column(table: string) {
      const result = await client.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)
      return result.rows.map((row) => row.id)
    }

    await as('', '', '')
    assert.deepEqual(await column('uploads'), [])

    await as(teacherA, org1, 'teacher')
    assert.deepEqual(await column('uploads'), [uploadA])
    assert.deepEqual(await column('transcript_lines'), (await client.query<{ id: string }>(`SELECT id FROM transcript_lines`)).rows.map((row) => row.id))
    const lineCount = await client.query(`SELECT count(*)::int AS count FROM transcript_lines`)
    assert.equal(lineCount.rows[0].count, 1)
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM cards`)).rows[0].count, 1)
    const hidden = await client.query(`UPDATE uploads SET received_chunks = '{1}' WHERE id = $1`, [uploadC])
    assert.equal(hidden.rowCount, 0)
    await assert.rejects(client.query(
      `UPDATE uploads SET status = 'done' WHERE id = $1`,
      [uploadA],
    ))
    await assert.rejects(client.query(
      `INSERT INTO uploads (organization_id, teacher_id, lesson_date, class_name, sport, language_mode, original_filename, byte_size, media_kind, content_type, status, chunk_size, expected_chunks)
       VALUES ($1, $2, '2026-10-02', '반', 'soccer', 'english', 'x.m4a', 10, 'audio', 'audio/mp4', 'uploading', 65536, 1)`,
      [org1, teacherC],
    ))
    await assert.rejects(client.query(`SELECT password_hash FROM users`))
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM access_log`)).rows[0].count, 0)

    await as(admin, org1, 'admin')
    assert.deepEqual(await column('uploads'), [uploadA])
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM transcript_lines`)).rows[0].count, 1)
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM cards`)).rows[0].count, 1)
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM access_log`)).rows[0].count, 0)

    await as(rep1, org1, 'representative')
    assert.deepEqual((await column('uploads')).sort(), [uploadA, uploadC].sort())
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM access_log`)).rows[0].count, 1)

    await as(rep2, org2, 'representative')
    assert.deepEqual(await column('uploads'), [uploadB])
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM transcript_lines WHERE upload_id = $1`, [uploadA])).rows[0].count, 0)

    await as(teacherB, org2, 'teacher')
    assert.deepEqual(await column('uploads'), [uploadB])

    await as(teacherA, org1, 'pending')
    assert.deepEqual(await column('uploads'), [])
  } finally {
    await client.end()
    await closePools()
  }
})
