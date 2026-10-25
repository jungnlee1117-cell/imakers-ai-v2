import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminPool } from './db.js'

const migrationId = '001_init'
const sqlPath = join(dirname(fileURLToPath(import.meta.url)), '../db/migrations/001_init.sql')

async function ensureRole() {
  const admin = adminPool()
  const existing = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'class_coach_app'`)
  if (existing.rowCount) {
    await admin.query(`ALTER ROLE class_coach_app WITH LOGIN PASSWORD 'class_coach_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`)
    return
  }
  await admin.query(`CREATE ROLE class_coach_app LOGIN PASSWORD 'class_coach_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`)
}

export async function migrate() {
  const admin = adminPool()
  await admin.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const applied = await admin.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [migrationId])
  if (applied.rowCount) return
  await ensureRole()
  const sql = readFileSync(sqlPath, 'utf8')
  const client = await admin.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirect) {
  migrate().then(() => {
    console.log('migrated')
    return adminPool().end()
  }).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
