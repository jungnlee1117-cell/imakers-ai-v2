import type { Express, NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { adminPool, withUser, type AppRole } from './db.js'
import { hashPassword, verifyPassword } from './auth.js'

type AuthLike = { sessionId: string; userId: string; organizationId: string; role: AppRole }

type Helpers = {
  asyncRoute: (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => void
  loadAuth: (req: Request, res: Response) => Promise<AuthLike>
  requireActive: (auth: AuthLike) => AuthLike
  ctx: (auth: AuthLike) => { userId: string; organizationId: string; role: AppRole }
  HttpError: new (status: number, message: string, code?: string) => Error
}

export function registerAccountRoutes(app: Express, h: Helpers) {
  const { asyncRoute, loadAuth, requireActive, ctx, HttpError } = h

  // 비밀번호 변경: 현재 비밀번호 확인 → 새 비밀번호 저장 → 다른 기기 세션은 끊는다.
  app.post('/api/auth/password', asyncRoute(async (req, res) => {
    const auth = await loadAuth(req, res)
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }).parse(req.body)
    const found = await adminPool().query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [auth.userId])
    const stored = found.rows[0]?.password_hash
    if (!stored || !(await verifyPassword(body.currentPassword, stored))) {
      throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.', 'wrong_password')
    }
    await adminPool().query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [auth.userId, await hashPassword(body.newPassword)])
    await adminPool().query(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [auth.userId, auth.sessionId])
    res.json({ ok: true })
  }))

  // 선생님 권한 설정(대표만): 선생님 ↔ 관리자
  app.post('/api/memberships/:userId/role', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'representative') throw new HttpError(403, '대표만 권한을 바꿀 수 있습니다.', 'forbidden')
    const body = z.object({ role: z.enum(['teacher', 'admin']) }).parse(req.body)
    const updated = await withUser(ctx(auth), (client) => client.query(
      `UPDATE memberships SET role = $3
       WHERE user_id = $1 AND organization_id = $2 AND role <> 'representative'`,
      [req.params.userId, auth.organizationId, body.role],
    ))
    if (!updated.rowCount) throw new HttpError(404, '바꿀 수 있는 회원을 찾지 못했습니다.', 'not_found')
    if (body.role === 'teacher') {
      await withUser(ctx(auth), (client) => client.query(
        `DELETE FROM teacher_assignments WHERE admin_id = $1`, [req.params.userId],
      ))
    }
    res.json({ ok: true })
  }))

  // 가입 대기 중인 사람은 users 행 보안규칙 때문에 /api/members 에서 이름이 안 보인다.
  // 대표만 쓸 수 있는 목록으로, 같은 기관 사람만 돌려준다.
  app.get('/api/team', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    if (auth.role !== 'representative') throw new HttpError(403, '대표만 볼 수 있습니다.', 'forbidden')
    const rows = await adminPool().query<{ user_id: string; role: string; status: string; display_name: string; email: string }>(
      `SELECT m.user_id, m.role, m.status, u.display_name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.status <> 'rejected'
       ORDER BY (m.status = 'pending') DESC, u.display_name`,
      [auth.organizationId],
    )
    res.json({
      members: rows.rows.map((row) => ({ userId: row.user_id, role: row.role, status: row.status, displayName: row.display_name, email: row.email })),
    })
  }))

  // 수업 목록: 선생님은 내 것만, 대표는 모두(선생님 이름 포함). RLS가 범위를 정한다.
  app.get('/api/lessons', asyncRoute(async (req, res) => {
    const auth = requireActive(await loadAuth(req, res))
    const rows = await withUser(ctx(auth), (client) => client.query(
      `SELECT up.id, up.lesson_date::text, up.class_name, up.sport, up.language_mode, up.status,
              up.failure_reason, up.created_at, up.teacher_id, u.display_name AS teacher_name
       FROM uploads up JOIN users u ON u.id = up.teacher_id
       ORDER BY up.lesson_date DESC, up.created_at DESC`,
    ))
    res.json({
      lessons: rows.rows.map((row) => ({
        id: row.id,
        lessonDate: row.lesson_date,
        className: row.class_name,
        sport: row.sport,
        languageMode: row.language_mode,
        status: row.status,
        failureReason: row.failure_reason,
        createdAt: row.created_at,
        teacherId: row.teacher_id,
        teacherName: row.teacher_name,
      })),
    })
  }))
}
