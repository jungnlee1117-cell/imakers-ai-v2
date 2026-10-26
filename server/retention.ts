import { adminPool } from './db.js'
import { removeUploadFiles } from './files.js'

export async function runRetention(now = new Date()) {
  const expired = await adminPool().query<{ id: string }>(
    `DELETE FROM uploads WHERE expires_at IS NOT NULL AND expires_at < $1 RETURNING id`,
    [now],
  )
  for (const row of expired.rows) {
    await removeUploadFiles(row.id)
  }
  return expired.rowCount ?? 0
}
