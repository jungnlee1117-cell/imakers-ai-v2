export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const data = text ? JSON.parse(text) as { error?: string; code?: string } : {}
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.()
    throw new ApiError(data.error || '요청이 실패했습니다.', response.status, data.code)
  }
  return data as T
}

export type Session = {
  user: { id: string; email: string; displayName: string }
  organization: {
    id: string
    name: string
    slug: string
    billingTier: 'free' | 'paid'
    joinPolicy: string
    retentionDays: number
  } | null
  role: 'teacher' | 'admin' | 'representative' | 'pending' | null
  memberships: Array<{
    organizationId: string
    organizationName: string
    role: string
    status: string
    billingTier: 'free' | 'paid'
  }>
  consent: { version: string; acceptedAt: string } | null
}

export type UploadRow = {
  id: string
  lessonDate: string
  className: string
  sport: string
  languageMode: string
  status: string
  failureReason: string | null
  byteSize: number
  mediaKind: string
  expiresAt: string | null
  createdAt: string
  durationSeconds: number | null
  filename: string
}

export type TranscriptLine = {
  id: string
  start_sec: number
  text: string
  trusted: boolean
  teacher_check: 'unconfirmed' | 'confirmed' | 'rejected'
}

export type CardDocument = {
  schema_version: '1.0'
  lesson: {
    date: string
    class_name: string
    sport: string
    language_mode: 'english' | 'korean' | 'mixed'
    duration_sec: number
    source: 'video' | 'audio'
  }
  flow: {
    lead: string
    note: string
    segments: Array<{ start_sec: number; end_sec: number; label: string; kind: 'main' | 'normal' | 'control' }>
  }
  english_phrases?: {
    note: string
    items: Array<{ at_sec: number; heard: string; suggested: string; reason: string; type: 'error' | 'tip' | 'check' }>
  }
  interaction: {
    good: Array<{ title: string; at_sec: number[]; text: string }>
    improve: Array<{ title: string; at_sec: number[]; text: string }>
  }
  plan_adherence?: {
    status: 'not_linked' | 'done'
    planned?: string[]
    actual?: string[]
    missing?: string[]
    note?: string
  }
  metrics: Array<{
    id: string
    label: string
    value: number
    unit: string
    better: 'up' | 'down'
    tolerance: number
    sub?: string
    compare: boolean
  }>
  excluded_lines: Array<{ at_sec: number; reason: string }>
  practice: Array<{ id: string; say: string; why: string; is_task: boolean }>
  skill_events: Array<{ skill_id: string; expression: string; at_sec: number }>
}

export function go(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`
}
