/** 25분 수업 영상은 수백 MB가 될 수 있다. 업로드 한도는 1GiB. DB CHECK와 같다. */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

/** 청크가 너무 작으면 1GiB 파일이 청크 상한을 넘는다. 기본값은 5MiB. */
export const MAX_CHUNKS = 4096

const DEFAULT_CHUNK_BYTES = 5 * 1024 * 1024
const MIN_CHUNK_BYTES = 64 * 1024
const MAX_CHUNK_BYTES = 8 * 1024 * 1024

export function chunkSizeBytes() {
  const raw = Number(process.env.UPLOAD_CHUNK_BYTES || DEFAULT_CHUNK_BYTES)
  if (!Number.isFinite(raw)) return DEFAULT_CHUNK_BYTES
  return Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, Math.floor(raw)))
}

export const LESSON_PLAN_MAX_BYTES = 20 * 1024 * 1024
export const MEDIA_URL_TTL_SECONDS = 5 * 60
export const CONSENT_VERSION = 'placeholder-awaiting-legal-review'
export const LOCAL_BAND_ID = 'local-band'
export const GTS_ORG_ID = '11111111-1111-4111-8111-111111111111'
