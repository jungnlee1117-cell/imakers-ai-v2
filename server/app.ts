import { randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { adminPool, withUser, type AppRole } from './db.js'
import {
  clearSessionCookie,
  dummyPasswordHash,
  hashPassword,
  inviteCode,
  isReservedOrgName,
  readCookie,
  slugify,
  verifyPassword,
  writeSessionCookie,
} from './auth.js'
import { LOCAL_BAND_NOTICE } from './card/band.js'
import { compareCards } from './card/compare.js'
import { skillStage } from './card/skills.js'
import type { CardDocument } from './card/types.js'
import { assembleUpload, extractPdfText, fileSize, openReadStream, removeChunks, removeUploadFiles, writeChunk, writeLessonPlan } from './files.js'
import { extensionFor, safeFilename } from './paths.js'
import { CONSENT_VERSION, GTS_ORG_ID, LESSON_PLAN_MAX_BYTES, MAX_CHUNKS, MAX_UPLOAD_BYTES, chunkSizeBytes } from './limits.js'
import { signMediaUrl, verifyMediaSignature } from './media.js'

const SESSION_SECONDS = 60 * 60 * 24 * 14

type Auth = {
  sessionId: string
  userId: string
  email: string
  displayName: string
  organizationId: string
  organizationName: string
  slug: string
  role: AppRole
  billingTier: 'free' | 'paid'
  joinPolicy: string
  retentionDays: number
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message)
  }
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next)
  }
}

function requireActive(auth: Auth) {
  if (auth.role === 'pending') throw new HttpError(403, '소속 승인을 기다리는 중입니다.', 'pending')
  return auth
}

async function loadAuth(req: Request, res: Response) {
  const sessionId = readCookie(req.headers.cookie)
  if (!sessionId) throw new HttpError(401, '로그인해 주세요.', 'auth')
  const result = await adminPool().query<{
    session_id: string
    user_id: string
    email: string
    display_name: string
    organization_id: string
    organization_name: string
    slug: string
    role: AppRole
    status: string
    billing_tier: 'free' | 'paid'
    join_policy: string
    retention_days: number
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name,
            o.id AS organization_id, o.name AS organization_name, o.slug,
            m.role, m.status, o.billing_tier, o.join_policy, o.retention_days
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id
     JOIN organizations o ON o.id = s.organization_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  )
  const row = result.rows[0]
  if (!row) throw new HttpError(401, '로그인해 주세요.', 'auth')
  const auth: Auth = {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    slug: row.slug,
    role: row.status === 'active' ? row.role : 'pending',
    billingTier: row.billing_tier,
    joinPolicy: row.join_policy,
    retentionDays: row.retention_days,
  }
  res.locals.auth = auth
  return auth
}

function ctx(auth: Auth) {
  return { userId: auth.userId, organizationId: auth.organizationId, role: auth.role }
}

async function createSession(userId: string, organizationId: string) {
  const sessionId = randomUUID()
  await adminPool().query(
    `INSERT INTO sessions (id, user_id, organization_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [sessionId, userId, organizationId, String(SESSION_SECONDS)],
  )
  return sessionId
}

const emailSchema = z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80),
  mode: z.enum(['create_org', 'invite', 'gts_request']),
  organizationName: z.string().trim().min(1).max(80).optional(),
  inviteCode: z.string().trim().min(4).max(32).optional(),
})

function mediaKindOf(contentType: string, filename: string): 'video' | 'audio' | null {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  const videoExt = new Set(['mp4', 'mov', 'webm', 'mkv'])
  const audioExt = new Set(['m4a', 'mp3', 'wav', 'aac'])
  if (contentType.startsWith('video/') || (contentType === 'application/octet-stream' && videoExt.has(extension))) return 'video'
  if (contentType.startsWith('audio/') || (contentType === 'application/octet-stream' && audioExt.has(extension))) return 'audio'
  if (videoExt.has(extension)) return 'video'
  if (audioExt.has(extension)) return 'audio'
  return null
}

async function hasConsent(auth: Auth) {
  const result = await withUser(ctx(auth), (client) => client.query(
    `SELECT 1 FROM consents WHERE user_id = $1 AND organization_id = $2 AND version = $3 LIMIT 1`,
    [auth.userId, auth.organizationId, CONSENT_VERSION],
  ))
  return Boolean(result.rowCount)
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', asyncRoute(async (_req, res) => {
    await adminPool().query('SELECT 1')
    res.json({ ok: true })
  }))

  app.get('/api/directory/organizations', asyncRoute(async (_req, res) => {
    const result = await adminPool().query(
      `SELECT id, name, slug, billing_tier, join_policy
       FROM organizations WHERE join_policy = 'invite_or_approval' ORDER BY name`,
    )
    res.json({
      organizations: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        billingTier: row.billing_tier,
        joinPolicy: row.join_policy,
      })),
    })
  }))

  app.post('/api/auth/signup', asyncRoute(async (req, res) => {
    const body = signupSchema.parse(req.body)
    const passwordHash = await hashPassword(body.password)
    const client = await adminPool().connect()
    try {
      await client.query('BEGIN')
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [body.email, passwordHash, body.displayName],
      )
      const userId = user.rows[0].id
      let organizationId = ''
      if (body.mode === 'create_org') {
        const name = body.organizationName ?? ''
        if (!name || isReservedOrgName(name)) throw new HttpError(400, 'GTS가 아닌 새 소속 이름이 필요합니다.', 'org')
        let slug = slugify(name)
        if (slug === 'gts') slug = `org-${randomUUID().slice(0, 8)}`
        const org = await client.query<{ id: string }>(
          `INSERT INTO organizations (name, slug, billing_tier, join_policy)
           VALUES ($1, $2, 'paid', 'invite_only') RETURNING id`,
          [name, slug],
        )
        organizationId = org.rows[0].id
        await client.query(
          `INSERT INTO memberships (user_id, organization_id, role, status) VALUES ($1, $2, 'representative', 'active')`,
          [userId, organizationId],
        )
      } else if (body.mode === 'invite') {
        if (!body.inviteCode) throw new HttpError(400, '초대 코드가 필요합니다.', 'invite')
        const invite = await client.query<{ id: string; organization_id: string; role: string }>(
          `SELECT id, organization_id, role FROM invites
           WHERE code = $1 AND used_by IS NULL AND expires_at > now() FOR UPDATE`,
          [body.inviteCode.toUpperCase()],
        )
        if (!invite.rows[0]) throw new HttpError(400, '초대 코드가 유효하지 않습니다.', 'invite')
        organizationId = invite.rows[0].organization_id
        await client.query(
          `INSERT INTO memberships (user_id, organization_id, role, status) VALUES ($1, $2, $3, 'active')`,
          [userId, organizationId, invite.rows[0].role],
        )
        await client.query(`UPDATE invites SET used_by = $2 WHERE id = $1`, [invite.rows[0].id, userId])
      } else {
        organizationId = GTS_ORG_ID
        await client.query(
          `INSERT INTO memberships (user_id, organization_id, role, status) VALUES ($1, $2, 'teacher', 'pending')`,
          [userId, organizationId],
        )
      }
      await client.query('COMMIT')
      const sessionId = await createSession(userId, organizationId)
      res.setHeader('Set-Cookie', writeSessionCookie(sessionId, SESSION_SECONDS))
      res.status(201).json({ ok: true })
    } catch (error) {
      await client.query('ROLLBACK')
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        throw new HttpError(409, '이미 가입한 이메일이거나 같은 이름의 소속이 있습니다.', 'conflict')
      }
      throw error
    } finally {
      client.release()
    }
  }))

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const body = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(req.body)
    const user = await adminPool().query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [body.email],
    )
    const hash = user.rows[0]?.password_hash ?? await dummyPasswordHash()
    const ok = await verifyPassword(body.password, hash)
    if (!user.rows[0] || !ok) throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.', 'auth')
    const membership = await adminPool().query<{ organization_id: string }>(
      `SELECT organization_id FROM memberships
       WHERE user_id = $1
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at
       LIMIT 1`,
      [user.rows[0].id],
    )
    if (!membership.rows[0]) throw new HttpError(403, '소속이 없습니다.', 'org')
    const sessionId = await createSession(user.rows[0].id, membership.rows[0].organization_id)
    res.setHeader('Set-Cookie', writeSessionCookie(sessionId, SESSION_SECONDS))
    res.json({ ok: true })
  }))

  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    const sessionId = readCookie(req.headers.cookie)
    if (sessionId) await adminPool().query(`DELETE FROM sessions WHERE id = $1`, [sessionId])
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.json({ ok: true })
  }))

  app.get('/api/me', asyncRoute(async (req, res) => {
    const auth = await loadAuth(req, res)
    const memberships = await adminPool().query(
      `SELECT o.id, o.name, m.role, m.status, o.billing_tier
       FROM memberships m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 ORDER BY o.name`,
      [auth.userId],
    )
    const consent = await adminPool().query<{ version: string; accepted_at: Date }>(
      `SELECT version, accepted_at FROM consents
       WHERE user_id = $1 AND organization_id = $2 AND version = $3
       ORDER BY accepted_at DESC LIMIT 1`,
      [auth.userId, auth.organizationId, CONSENT_VERSION],
    )
    res.json({
      user: { id: auth.userId, email: auth.email, displayName: auth.displayName },
      organization: {
        id: auth.organizationId,
        name: auth.organizationName,
        slug: auth.slug,
        billingTier: auth.billingTier,
        joinPolicy: auth.joinPolicy,
        retentionDays: auth.retentionDays,
      },
      role: auth.role,
      memberships: memberships.rows.map((row) => ({
        organizationId: row.id,
        organizationName: row.name,
        role: row.role,
        status: row.status,
        billingTier: row.billing_tier,
      })),
      consent: consent.rows[0]
        ? { version: consent.rows[0].version, acceptedAt: consent.rows[0].accepted_at }
        : null,
    })
  }))

  app.post('/api/session/organization', asyncRoute(async (req, res) => {
    const auth = await loadAuth(req, res)
    const body = z.object({ organizationId: z.uuid() }).parse(req.body)
    const membership = await adminPool().query(
      `SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2 AND status = 'active'`,
      [auth.userId, body.organizationId],
    )
    if (!membership.rowCount) throw new HttpError(403, '그 소속으로 들어갈 수 없습니다.', 'org')
    await adminPool().query(`UPDATE sessions SET organization_id = $2 WHERE id = $1`, [auth.sessionId, body.organizationId])
    res.json({ ok: true })
  }))

  app.post('/api/organizations', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const body = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body)
    if (isReservedOrgName(body.name)) throw new HttpError(400, 'GTS 소속은 직접 만들 수 없습니다.', 'org')
    let slug = slugify(body.name)
    if (slug === 'gts') slug = `org-${randomUUID().slice(0, 8)}`
    const client = await adminPool().connect()
    try {
      await client.query('BEGIN')
      const org = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, billing_tier, join_policy) VALUES ($1, $2, 'paid', 'invite_only') RETURNING id`,
        [body.name, slug],
      )
      await client.query(
        `INSERT INTO memberships (user_id, organization_id, role, status) VALUES ($1, $2, 'representative', 'active')`,
        [auth.userId, org.rows[0].id],
      )
      await client.query(`UPDATE sessions SET organization_id = $2 WHERE id = $1`, [auth.sessionId, org.rows[0].id])
      await client.query('COMMIT')
      res.status(201).json({ id: org.rows[0].id })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }))

  app.post('/api/organizations/gts-request', asyncRoute(async (req, res) => {
    const auth = await loadAuth(req, res)
    try {
      await withUser(ctx(auth), (client) => client.query(
        `INSERT INTO memberships (user_id, organization_id, role, status) VALUES ($1, $2, 'teacher', 'pending')`,
        [auth.userId, GTS_ORG_ID],
      ))
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        throw new HttpError(409, '이미 GTS 참여를 요청했습니다.', 'conflict')
      }
      throw error
    }
    res.status(201).json({ ok: true })
  }))

  app.get('/api/members', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT m.user_id, m.role, m.status, u.display_name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY u.display_name`,
      [auth.organizationId],
    ))
    res.json({
      members: rows.rows.map((row) => ({
        userId: row.user_id,
        role: row.role,
        status: row.status,
        displayName: row.display_name,
        email: row.email,
      })),
    })
  }))

  app.post('/api/memberships/:userId/decision', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'representative') throw new HttpError(403, '대표만 승인할 수 있습니다.', 'forbidden')
    const body = z.object({ status: z.enum(['active', 'rejected']) }).parse(req.body)
    const updated = await withUser(ctx(auth), (client) => client.query(
      `UPDATE memberships SET status = $3 WHERE user_id = $1 AND organization_id = $2`,
      [req.params.userId, auth.organizationId, body.status],
    ))
    if (!updated.rowCount) throw new HttpError(404, '회원을 찾지 못했습니다.', 'not_found')
    res.json({ ok: true })
  }))

  app.post('/api/invites', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'representative') throw new HttpError(403, '대표만 초대할 수 있습니다.', 'forbidden')
    const body = z.object({ role: z.enum(['teacher', 'admin']) }).parse(req.body)
    const code = inviteCode()
    await withUser(ctx(auth), (client) => client.query(
      `INSERT INTO invites (organization_id, code, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '14 days')`,
      [auth.organizationId, code, body.role, auth.userId],
    ))
    res.status(201).json({ code })
  }))

  app.get('/api/invites', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT code, role, expires_at FROM invites
       WHERE used_by IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    ))
    res.json({ invites: rows.rows.map((row) => ({ code: row.code, role: row.role, expiresAt: row.expires_at })) })
  }))

  app.post('/api/assignments', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const body = z.object({ adminId: z.uuid(), teacherId: z.uuid() }).parse(req.body)
    const inserted = await withUser(ctx(auth), (client) => client.query(
      `INSERT INTO teacher_assignments (organization_id, admin_id, teacher_id) VALUES ($1, $2, $3) RETURNING id`,
      [auth.organizationId, body.adminId, body.teacherId],
    ))
    res.status(201).json({ id: inserted.rows[0].id })
  }))

  app.delete('/api/assignments/:id', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const removed = await withUser(ctx(auth), (client) => client.query(
      `DELETE FROM teacher_assignments WHERE id = $1`,
      [req.params.id],
    ))
    if (!removed.rowCount) throw new HttpError(404, '담당 연결을 찾지 못했습니다.', 'not_found')
    res.json({ ok: true })
  }))

  app.get('/api/assignments', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT id, admin_id, teacher_id FROM teacher_assignments ORDER BY created_at`,
    ))
    res.json({ assignments: rows.rows.map((row) => ({ id: row.id, adminId: row.admin_id, teacherId: row.teacher_id })) })
  }))

  app.post('/api/retention', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'representative') throw new HttpError(403, '대표만 보관 기간을 바꿉니다.', 'forbidden')
    const body = z.object({ retentionDays: z.number().int().min(1).max(3650) }).parse(req.body)
    await withUser(ctx(auth), (client) => client.query(
      `UPDATE organizations SET retention_days = $2 WHERE id = $1`,
      [auth.organizationId, body.retentionDays],
    ))
    res.json({ ok: true })
  }))

  app.post('/api/consents', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    await withUser(ctx(auth), (client) => client.query(
      `INSERT INTO consents (user_id, organization_id, version) VALUES ($1, $2, $3)`,
      [auth.userId, auth.organizationId, CONSENT_VERSION],
    ))
    res.status(201).json({ version: CONSENT_VERSION })
  }))

  app.post('/api/lesson-plans', express.raw({ type: 'application/pdf', limit: LESSON_PLAN_MAX_BYTES }), asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'teacher') throw new HttpError(403, '선생님만 계획안을 올립니다.', 'forbidden')
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(req.header('x-month'))
    const sport = z.string().regex(/^[a-z0-9_-]{1,40}$/).parse(req.header('x-sport'))
    const languageMode = z.enum(['english', 'korean', 'mixed']).parse(req.header('x-language-mode'))
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'PDF 파일이 필요합니다.', 'invalid')
    const id = randomUUID()
    const key = await writeLessonPlan(id, body)
    const extracted = extractPdfText(body)
    try {
      await withUser(ctx(auth), (client) => client.query(
        `INSERT INTO lesson_plans (id, organization_id, teacher_id, month, sport, language_mode, file_path, extracted_text, extraction_note)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)`,
        [id, auth.organizationId, auth.userId, `${month}-01`, sport, languageMode, key, extracted.text || null, extracted.note],
      ))
    } catch (error) {
      await removeUploadFiles(id).catch(() => undefined)
      throw error
    }
    res.status(201).json({ id, extractionNote: extracted.note })
  }))

  app.get('/api/lesson-plans', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT id, month::text, sport, language_mode, extraction_note, created_at
       FROM lesson_plans ORDER BY month DESC, created_at DESC`,
    ))
    res.json({
      plans: rows.rows.map((row) => ({
        id: row.id,
        month: String(row.month).slice(0, 7),
        sport: row.sport,
        languageMode: row.language_mode,
        extractionNote: row.extraction_note,
        createdAt: row.created_at,
      })),
    })
  }))

  app.post('/api/uploads/init', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'teacher') throw new HttpError(403, '선생님만 녹음을 올립니다.', 'forbidden')
    if (!await hasConsent(auth)) throw new HttpError(403, '첫 업로드 전에 동의 기록이 필요합니다.', 'consent_required')
    const body = z.object({
      filename: z.string().min(1).max(200),
      byteSize: z.number().int().positive(),
      contentType: z.string().min(1).max(120),
      lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      className: z.string().trim().min(1).max(80),
      sport: z.string().regex(/^[a-z0-9_-]{1,40}$/),
      languageMode: z.enum(['english', 'korean', 'mixed']),
    }).parse(req.body)
    if (body.byteSize > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, '파일 한도는 1GiB입니다. 25분 영상(수백 MB)은 이 한도 안에 들어옵니다.', 'too_large')
    }
    const kind = mediaKindOf(body.contentType, body.filename)
    if (!kind) throw new HttpError(400, '영상 또는 음성 파일만 올릴 수 있습니다.', 'invalid')
    const chunkSize = chunkSizeBytes()
    const expected = Math.ceil(body.byteSize / chunkSize)
    if (expected > MAX_CHUNKS) {
      throw new HttpError(400, '청크가 너무 작아 1GiB까지 이어서 올릴 수 없습니다.', 'invalid')
    }
    const id = randomUUID()
    await withUser(ctx(auth), (client) => client.query(
      `INSERT INTO uploads (
         id, organization_id, teacher_id, lesson_date, class_name, sport, language_mode,
         original_filename, byte_size, media_kind, content_type, status, chunk_size, expected_chunks
       ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,'uploading',$12,$13)`,
      [id, auth.organizationId, auth.userId, body.lessonDate, body.className, body.sport, body.languageMode,
        safeFilename(body.filename), body.byteSize, kind, body.contentType, chunkSize, expected],
    ))
    res.status(201).json({ id, chunkSize, expectedChunks: expected })
  }))

  app.put('/api/uploads/:id/chunks/:index', express.raw({ type: '*/*', limit: '8mb' }), asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const index = Number(req.params.index)
    const body = req.body as Buffer
    if (!Number.isInteger(index) || index < 0 || !Buffer.isBuffer(body)) {
      throw new HttpError(400, '청크가 올바르지 않습니다.', 'invalid')
    }
    const row = await withUser(ctx(auth), async (client) => {
      const current = await client.query<{
        status: string
        chunk_size: number
        expected_chunks: number
        byte_size: string
        received_chunks: number[]
      }>(`SELECT status, chunk_size, expected_chunks, byte_size, received_chunks FROM uploads WHERE id = $1 FOR UPDATE`, [req.params.id])
      return current.rows[0]
    })
    if (!row || row.status !== 'uploading') throw new HttpError(404, '이어 올릴 업로드가 없습니다.', 'not_found')
    if (index >= row.expected_chunks) throw new HttpError(400, '청크 번호가 파일 크기를 넘습니다.', 'invalid')
    const expectedSize = index === row.expected_chunks - 1
      ? Number(row.byte_size) - row.chunk_size * (row.expected_chunks - 1)
      : row.chunk_size
    if (body.length !== expectedSize) throw new HttpError(400, '청크 크기가 맞지 않습니다.', 'invalid')
    await writeChunk(String(req.params.id), index, body)
    const received = Array.from(new Set([...(row.received_chunks ?? []), index])).sort((a, b) => a - b)
    await withUser(ctx(auth), (client) => client.query(
      `UPDATE uploads SET received_chunks = $2::int[], updated_at = now() WHERE id = $1 AND status = 'uploading'`,
      [req.params.id, received],
    ))
    res.json({ received })
  }))

  app.post('/api/uploads/:id/complete', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const row = await withUser(ctx(auth), (client) => client.query<{
      status: string
      expected_chunks: number
      received_chunks: number[]
      byte_size: string
      original_filename: string
      media_kind: 'video' | 'audio'
    }>(
      `SELECT status, expected_chunks, received_chunks, byte_size, original_filename, media_kind
       FROM uploads WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    ))
    const upload = row.rows[0]
    if (!upload || upload.status !== 'uploading') throw new HttpError(404, '올릴 파일이 없습니다.', 'not_found')
    const have = new Set(upload.received_chunks ?? [])
    for (let index = 0; index < upload.expected_chunks; index += 1) {
      if (!have.has(index)) throw new HttpError(409, '아직 도착하지 않은 조각이 있습니다.', 'incomplete')
    }
    const extension = extensionFor(upload.original_filename, upload.media_kind)
    const key = await assembleUpload(String(req.params.id), upload.expected_chunks, extension)
    const size = await fileSize(key)
    if (size !== Number(upload.byte_size)) throw new HttpError(400, '파일 크기가 처음 알려 준 값과 다릅니다.', 'invalid')
    const expires = new Date(Date.now() + auth.retentionDays * 24 * 60 * 60 * 1000)
    await withUser(ctx(auth), (client) => client.query(
      `UPDATE uploads
       SET status = 'queued', file_path = $2, expires_at = $3, failure_reason = NULL, updated_at = now()
       WHERE id = $1 AND status = 'uploading'`,
      [req.params.id, key, expires],
    ))
    await removeChunks(String(req.params.id))
    res.json({ status: 'queued' })
  }))

  app.get('/api/uploads', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT id, lesson_date::text, class_name, sport, language_mode, status, failure_reason,
              byte_size, media_kind, expires_at, created_at, duration_seconds, original_filename
       FROM uploads ORDER BY lesson_date DESC, created_at DESC`,
    ))
    res.json({ uploads: rows.rows.map(presentUpload) })
  }))

  app.get('/api/uploads/:id', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const payload = await withUser(ctx(auth), async (client) => {
      const upload = await client.query(
        `SELECT id, lesson_date::text, class_name, sport, language_mode, status, failure_reason,
                byte_size, media_kind, expires_at, created_at, duration_seconds, original_filename,
                transcript_adapter, received_chunks, expected_chunks, chunk_size
         FROM uploads WHERE id = $1`,
        [req.params.id],
      )
      if (!upload.rows[0]) return null
      const card = await client.query<{ id: string; document: CardDocument }>(
        `SELECT id, document FROM cards WHERE upload_id = $1`,
        [req.params.id],
      )
      const lines = await client.query(
        `SELECT id, start_sec, text, trusted, teacher_check FROM transcript_lines
         WHERE upload_id = $1 ORDER BY start_sec, id`,
        [req.params.id],
      )
      return { upload: upload.rows[0], card: card.rows[0] ?? null, lines: lines.rows }
    })
    if (!payload) throw new HttpError(404, '수업을 찾지 못했습니다.', 'not_found')
    if (payload.card) {
      await adminPool().query(
        `INSERT INTO access_log (organization_id, user_id, target_type, target_id)
         SELECT $1, $2, 'card', $3
         WHERE NOT EXISTS (
           SELECT 1 FROM access_log
           WHERE user_id = $2 AND target_id = $3 AND target_type = 'card'
             AND created_at > now() - interval '1 minute'
         )`,
        [auth.organizationId, auth.userId, payload.card.id],
      )
    }
    const audio = payload.upload.status === 'done'
      ? signMediaUrl(String(req.params.id), auth.userId)
      : null
    res.json({
      upload: {
        ...presentUpload(payload.upload),
        receivedChunks: payload.upload.received_chunks ?? [],
        expectedChunks: payload.upload.expected_chunks,
        chunkSize: payload.upload.chunk_size,
        processorId: payload.upload.transcript_adapter,
      },
      card: payload.card?.document ?? null,
      lines: payload.lines.map((line) => ({
        id: line.id,
        start_sec: line.start_sec,
        text: line.text,
        trusted: line.trusted,
        teacher_check: line.teacher_check,
      })),
      audioUrl: audio?.url ?? null,
      processorNotice: payload.upload.transcript_adapter === 'local-band' ? LOCAL_BAND_NOTICE : null,
    })
  }))

  app.post('/api/uploads/:id/retry', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const updated = await withUser(ctx(auth), (client) => client.query(
      `UPDATE uploads SET status = 'queued', failure_reason = NULL, updated_at = now()
       WHERE id = $1 AND status = 'failed'`,
      [req.params.id],
    ))
    if (!updated.rowCount) throw new HttpError(409, '실패한 업로드만 다시 시도할 수 있습니다.', 'conflict')
    res.json({ status: 'queued' })
  }))

  app.delete('/api/uploads/:id', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const removed = await withUser(ctx(auth), (client) => client.query(
      `DELETE FROM uploads WHERE id = $1 RETURNING class_name`,
      [req.params.id],
    ))
    if (!removed.rowCount) throw new HttpError(404, '녹음을 찾지 못했습니다.', 'not_found')
    await removeUploadFiles(String(req.params.id))
    const reps = await adminPool().query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE organization_id = $1 AND role = 'representative' AND status = 'active'`,
      [auth.organizationId],
    )
    if (reps.rows.length) {
      await adminPool().query(
        `INSERT INTO notifications (organization_id, user_id, kind, message)
         SELECT $1, unnest($2::uuid[]), 'upload_deleted', $3`,
        [auth.organizationId, reps.rows.map((row) => row.user_id), `${auth.displayName} 선생님이 녹음을 삭제했습니다.`],
      )
    }
    res.json({ ok: true })
  }))

  app.post('/api/transcript-lines/:id/check', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const body = z.object({ teacherCheck: z.enum(['confirmed', 'rejected', 'unconfirmed']) }).parse(req.body)
    const updated = await withUser(ctx(auth), (client) => client.query(
      `UPDATE transcript_lines SET teacher_check = $2 WHERE id = $1`,
      [req.params.id, body.teacherCheck],
    ))
    if (!updated.rowCount) throw new HttpError(404, '전사 줄을 찾지 못했습니다.', 'not_found')
    res.json({ ok: true })
  }))

  app.get('/api/changes', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const uploadId = z.uuid().parse(req.query.uploadId)
    const result = await withUser(ctx(auth), async (client) => {
      const current = await client.query<{ document: CardDocument; class_name: string; lesson_date: string; teacher_id: string; created_at: Date }>(
        `SELECT c.document, u.class_name, u.lesson_date::text, u.teacher_id, u.created_at
         FROM cards c JOIN uploads u ON u.id = c.upload_id WHERE u.id = $1`,
        [uploadId],
      )
      if (!current.rows[0]) return null
      const previous = await client.query<{ document: CardDocument; id: string }>(
        `SELECT c.document, u.id
         FROM cards c JOIN uploads u ON u.id = c.upload_id
         WHERE u.teacher_id = $1 AND u.status = 'done' AND u.id <> $2
           AND (u.lesson_date < $3::date OR (u.lesson_date = $3::date AND u.created_at < $4))
         ORDER BY (u.class_name = $5) DESC, u.lesson_date DESC, u.created_at DESC
         LIMIT 1`,
        [current.rows[0].teacher_id, uploadId, current.rows[0].lesson_date, current.rows[0].created_at, current.rows[0].class_name],
      )
      return { current: current.rows[0].document, previous: previous.rows[0]?.document ?? null, previousUploadId: previous.rows[0]?.id ?? null }
    })
    if (!result) throw new HttpError(404, '비교할 카드가 없습니다.', 'not_found')
    if (!result.previous) {
      res.json({ previousUploadId: null, notes: [], items: [] })
      return
    }
    res.json({ previousUploadId: result.previousUploadId, ...compareCards(result.current, result.previous) })
  }))

  app.get('/api/practice', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const requested = typeof req.query.cardUploadId === 'string' ? req.query.cardUploadId : null
    const payload = await withUser(ctx(auth), async (client) => {
      const card = requested
        ? await client.query<{ id: string; upload_id: string; document: CardDocument }>(
          `SELECT c.id, c.upload_id, c.document FROM cards c WHERE c.upload_id = $1`,
          [requested],
        )
        : await client.query<{ id: string; upload_id: string; document: CardDocument }>(
          `SELECT c.id, c.upload_id, c.document
           FROM cards c JOIN uploads u ON u.id = c.upload_id
           WHERE u.status = 'done'
           ORDER BY u.lesson_date DESC, u.created_at DESC LIMIT 1`,
        )
      if (!card.rows[0]) return null
      const today = await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text AS today`)
      const checks = await client.query<{ item_key: string }>(
        `SELECT item_key FROM practice_checks WHERE card_id = $1 AND practice_date = $2::date`,
        [card.rows[0].id, today.rows[0].today],
      )
      const dates = await client.query<{ practice_date: string }>(
        `SELECT DISTINCT practice_date::text FROM practice_checks WHERE teacher_id = $1 ORDER BY practice_date`,
        [auth.userId],
      )
      return { card: card.rows[0], today: today.rows[0].today, checks: checks.rows.map((row) => row.item_key), dates: dates.rows.map((row) => row.practice_date) }
    })
    if (!payload) {
      res.json({ card: null, today: null, checked: [], streak: 0 })
      return
    }
    res.json({
      uploadId: payload.card.upload_id,
      cardId: payload.card.id,
      practice: payload.card.document.practice,
      today: payload.today,
      checked: payload.checks,
      streak: streakFrom(payload.dates, payload.today),
    })
  }))

  app.post('/api/practice', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const body = z.object({ uploadId: z.uuid(), itemKey: z.string().min(1).max(80), checked: z.boolean() }).parse(req.body)
    await withUser(ctx(auth), async (client) => {
      const card = await client.query<{ id: string; document: CardDocument }>(
        `SELECT id, document FROM cards WHERE upload_id = $1`,
        [body.uploadId],
      )
      if (!card.rows[0]) throw new HttpError(404, '연습할 카드가 없습니다.', 'not_found')
      if (!card.rows[0].document.practice.some((item) => item.id === body.itemKey)) {
        throw new HttpError(400, '이 카드에 없는 연습입니다.', 'invalid')
      }
      if (body.checked) {
        await client.query(
          `INSERT INTO practice_checks (organization_id, teacher_id, card_id, practice_date, item_key)
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'Asia/Seoul')::date, $4)
           ON CONFLICT (teacher_id, card_id, practice_date, item_key) DO NOTHING`,
          [auth.organizationId, auth.userId, card.rows[0].id, body.itemKey],
        )
      } else {
        await client.query(
          `DELETE FROM practice_checks
           WHERE card_id = $1 AND item_key = $2 AND practice_date = (now() AT TIME ZONE 'Asia/Seoul')::date`,
          [card.rows[0].id, body.itemKey],
        )
      }
    })
    res.json({ ok: true })
  }))

  app.get('/api/skills', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query<{
      id: string
      name: string
      description: string
      expressions: string[] | null
      latest_new: string[] | null
    }>(
      `SELECT s.id, s.name, s.description, p.expressions, p.latest_new
       FROM skills s
       LEFT JOIN skill_progress p ON p.skill_id = s.id AND p.teacher_id = $1 AND p.organization_id = $2
       ORDER BY CASE s.id WHEN 'praise' THEN 1 WHEN 'rule_as_question' THEN 2 WHEN 'child_care' THEN 3 ELSE 4 END`,
      [auth.userId, auth.organizationId],
    ))
    res.json({
      skills: rows.rows.map((row) => {
        const expressions = row.expressions ?? []
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          stage: skillStage(expressions.length),
          expressions,
          newExpressions: row.latest_new ?? [],
        }
      }),
    })
  }))

  app.get('/api/teachers', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role === 'teacher') throw new HttpError(403, '선생님 목록은 대표와 관리자가 봅니다.', 'forbidden')
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT u.id, u.display_name, u.email,
              (SELECT max(up.created_at) FROM uploads up WHERE up.teacher_id = u.id AND up.status <> 'uploading') AS last_upload_at,
              (SELECT count(*) FROM uploads up
                WHERE up.teacher_id = u.id AND up.status <> 'uploading'
                  AND up.created_at > now() - interval '30 days') AS recent_count,
              (SELECT up.id FROM uploads up WHERE up.teacher_id = u.id AND up.status = 'done'
                ORDER BY up.lesson_date DESC, up.created_at DESC LIMIT 1) AS latest_done_id,
              (SELECT up.status FROM uploads up WHERE up.teacher_id = u.id
                ORDER BY up.created_at DESC LIMIT 1) AS latest_status
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.organization_id = $1
       WHERE m.role = 'teacher' AND m.status = 'active'
       ORDER BY u.display_name`,
      [auth.organizationId],
    ))
    const skills = await withUser(ctx(auth), (client) => client.query<{ teacher_id: string; skill_id: string; name: string; expressions: string[] }>(
      `SELECT p.teacher_id, p.skill_id, s.name, p.expressions
       FROM skill_progress p JOIN skills s ON s.id = p.skill_id`,
    ))
    const byTeacher = new Map<string, { id: string; name: string; stage: string }[]>()
    for (const skill of skills.rows) {
      const list = byTeacher.get(skill.teacher_id) ?? []
      list.push({ id: skill.skill_id, name: skill.name, stage: skillStage(skill.expressions.length) })
      byTeacher.set(skill.teacher_id, list)
    }
    res.json({
      teachers: rows.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        lastUploadAt: row.last_upload_at,
        uploadedWithin30Days: Number(row.recent_count) > 0,
        latestDoneUploadId: row.latest_done_id,
        latestStatus: row.latest_status,
        skills: byTeacher.get(row.id) ?? [],
      })),
    })
  }))

  app.get('/api/access-log', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'representative') throw new HttpError(403, '열람 내역은 대표만 봅니다.', 'forbidden')
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT a.id, a.created_at, a.target_type, a.target_id,
              actor.display_name AS actor_name,
              COALESCE(up.lesson_date, up2.lesson_date)::text AS lesson_date,
              COALESCE(up.class_name, up2.class_name) AS class_name,
              teacher.display_name AS teacher_name
       FROM access_log a
       LEFT JOIN users actor ON actor.id = a.user_id
       LEFT JOIN uploads up ON a.target_type = 'recording' AND up.id = a.target_id
       LEFT JOIN cards c ON a.target_type = 'card' AND c.id = a.target_id
       LEFT JOIN uploads up2 ON up2.id = c.upload_id
       LEFT JOIN users teacher ON teacher.id = COALESCE(up.teacher_id, up2.teacher_id)
       ORDER BY a.created_at DESC
       LIMIT 200`,
    ))
    res.json({
      entries: rows.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        actorName: row.actor_name,
        targetType: row.target_type,
        targetId: row.target_id,
        lessonDate: row.lesson_date,
        className: row.class_name,
        teacherName: row.teacher_name,
      })),
    })
  }))

  app.get('/api/notifications', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT id, kind, message, upload_id, read_at, created_at
       FROM notifications ORDER BY created_at DESC LIMIT 30`,
    ))
    res.json({
      notifications: rows.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        message: row.message,
        uploadId: row.upload_id,
        readAt: row.read_at,
        createdAt: row.created_at,
      })),
    })
  }))

  app.post('/api/notifications/:id/read', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    await withUser(ctx(auth), (client) => client.query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`,
      [req.params.id],
    ))
    res.json({ ok: true })
  }))

  app.get('/api/media/:id', asyncRoute(async (req, res) => {
    const auth = await loadAuth(req, res)
    const exp = Number(req.query.exp)
    const uid = String(req.query.uid ?? '')
    const sig = String(req.query.sig ?? '')
    if (uid !== auth.userId || !verifyMediaSignature(String(req.params.id), uid, exp, sig)) {
      throw new HttpError(403, '재생 주소가 만료되었거나 올바르지 않습니다.', 'media')
    }
    const upload = await withUser(ctx(auth), (client) => client.query<{ audio_path: string | null }>(
      `SELECT audio_path FROM uploads WHERE id = $1`,
      [req.params.id],
    ))
    const key = upload.rows[0]?.audio_path
    if (!key) throw new HttpError(404, '재생할 소리가 없습니다.', 'not_found')
    await adminPool().query(
      `INSERT INTO access_log (organization_id, user_id, target_type, target_id)
       SELECT $1, $2, 'recording', $3
       WHERE NOT EXISTS (
         SELECT 1 FROM access_log
         WHERE user_id = $2 AND target_id = $3 AND target_type = 'recording'
           AND created_at > now() - interval '1 minute'
       )`,
      [auth.organizationId, auth.userId, req.params.id],
    )
    const size = await fileSize(key)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', key.endsWith('.wav') ? 'audio/wav' : key.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4')
    res.setHeader('Cache-Control', 'private, max-age=0')
    const range = req.headers.range
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range)
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end()
        return
      }
      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : size - 1
      if (start >= size || end < start) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end()
        return
      }
      res.status(206)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', String(end - start + 1))
      openReadStream(key, { start, end }).pipe(res)
      return
    }
    res.setHeader('Content-Length', String(size))
    openReadStream(key).pipe(res)
  }))

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, code: error.code })
      return
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '입력값을 확인해 주세요.', code: 'invalid' })
      return
    }
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code === '42501' || (error instanceof Error && error.message.includes('row-level security'))) {
      res.status(403).json({ error: '이 기록을 다룰 권한이 없습니다.', code: 'forbidden' })
      return
    }
    if (code === 'P0001') {
      res.status(409).json({ error: '지금 상태에서는 바꿀 수 없습니다.', code: 'conflict' })
      return
    }
    if (code === '23505') {
      res.status(409).json({ error: '이미 있는 기록입니다.', code: 'conflict' })
      return
    }
    const type = typeof error === 'object' && error && 'type' in error ? String(error.type) : ''
    if (type === 'entity.too.large') {
      res.status(413).json({ error: '파일이 한도보다 큽니다.', code: 'too_large' })
      return
    }
    console.error(error)
    res.status(500).json({ error: '처리하지 못했습니다.', code: 'server' })
  })

  return app
}

function presentUpload(row: {
  id: string
  lesson_date: string
  class_name: string
  sport: string
  language_mode: string
  status: string
  failure_reason: string | null
  byte_size: string | number
  media_kind: string
  expires_at: Date | null
  created_at: Date
  duration_seconds: string | null
  original_filename: string
}) {
  return {
    id: row.id,
    lessonDate: row.lesson_date,
    className: row.class_name,
    sport: row.sport,
    languageMode: row.language_mode,
    status: row.status,
    failureReason: row.failure_reason,
    byteSize: Number(row.byte_size),
    mediaKind: row.media_kind,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    filename: row.original_filename,
  }
}

function previousDay(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function streakFrom(dates: string[], today: string) {
  const set = new Set(dates)
  let cursor = set.has(today) ? today : previousDay(today)
  let count = 0
  while (set.has(cursor)) {
    count += 1
    cursor = previousDay(cursor)
  }
  return count
}
