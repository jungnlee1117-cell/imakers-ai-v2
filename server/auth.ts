import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const SESSION_COOKIE = 'cc_session'

export function sessionCookieName() {
  return SESSION_COOKIE
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const actual = (await scryptAsync(password, salt, 64)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

let dummyHash: string | null = null

export async function dummyPasswordHash() {
  if (!dummyHash) dummyHash = await hashPassword('timing-placeholder')
  return dummyHash
}

export function readCookie(header: string | undefined, name = SESSION_COOKIE) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function writeSessionCookie(sessionId: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

export function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
}

export function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return base || 'org'
}

export function isReservedOrgName(name: string) {
  return name.trim().toLowerCase() === 'gts'
}
