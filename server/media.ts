import { createHmac, timingSafeEqual } from 'node:crypto'
import { MEDIA_URL_TTL_SECONDS } from './limits.js'

function secret() {
  const value = process.env.SIGNING_SECRET
  if (!value || value.length < 16) throw new Error('SIGNING_SECRET는 16자 이상이어야 합니다.')
  return value
}

export function signMediaUrl(uploadId: string, userId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + MEDIA_URL_TTL_SECONDS
  const payload = `${uploadId}.${userId}.${exp}`
  const sig = createHmac('sha256', secret()).update(payload).digest('hex')
  return { exp, sig, url: `/api/media/${uploadId}?exp=${exp}&uid=${userId}&sig=${sig}` }
}

export function verifyMediaSignature(uploadId: string, userId: string, exp: number, sig: string, now = Date.now()) {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false
  const payload = `${uploadId}.${userId}.${exp}`
  const expected = createHmac('sha256', secret()).update(payload).digest('hex')
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
