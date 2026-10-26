import type { PoolClient } from 'pg'
import { GTS_ORG_ID, GTS_REPRESENTATIVE_EMAIL } from './limits.js'

export function isDesignatedGtsRepresentative(email: string) {
  return email.trim().toLowerCase() === GTS_REPRESENTATIVE_EMAIL
}

export async function ensureGtsOrganization(client: PoolClient) {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO organizations (id, name, slug, billing_tier, join_policy, retention_days)
     VALUES ($1, 'GTS', 'gts', 'free', 'invite_or_approval', 365)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [GTS_ORG_ID],
  )
  if (inserted.rows[0]) return inserted.rows[0].id
  const found = await client.query<{ id: string }>(`SELECT id FROM organizations WHERE slug = 'gts'`)
  if (!found.rows[0]) throw new Error('GTS 소속을 만들지 못했습니다.')
  return found.rows[0].id
}

/** 소속이 있으면 그 역할을 대표로 올리고, 없으면 GTS 대표로 연결한다. */
export async function placeDesignatedRepresentative(client: PoolClient, userId: string) {
  const existing = await client.query(`SELECT 1 FROM memberships WHERE user_id = $1 FOR UPDATE`, [userId])
  if (!existing.rowCount) {
    const organizationId = await ensureGtsOrganization(client)
    await client.query(
      `INSERT INTO memberships (user_id, organization_id, role, status)
       VALUES ($1, $2, 'representative', 'active')
       ON CONFLICT (user_id, organization_id) DO UPDATE
       SET role = 'representative', status = 'active'`,
      [userId, organizationId],
    )
    return organizationId
  }
  await client.query(
    `UPDATE memberships SET role = 'representative', status = 'active' WHERE user_id = $1`,
    [userId],
  )
  const current = await client.query<{ organization_id: string }>(
    `SELECT organization_id FROM memberships
     WHERE user_id = $1 AND status = 'active'
     ORDER BY created_at LIMIT 1`,
    [userId],
  )
  return current.rows[0].organization_id
}
