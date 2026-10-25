import path from 'node:path'

export function dataRoot() {
  return path.resolve(process.env.DATA_DIR || 'data')
}

export function resolveDataKey(key: string) {
  if (!key || key.includes('\0') || key.includes('..') || path.isAbsolute(key)) {
    throw new Error('잘못된 파일 경로입니다.')
  }
  const root = dataRoot()
  const absolute = path.resolve(root, key)
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('잘못된 파일 경로입니다.')
  }
  return absolute
}

export function extensionFor(filename: string, mediaKind: 'video' | 'audio') {
  const extension = path.extname(filename).toLowerCase()
  const video = new Set(['.mp4', '.mov', '.webm', '.mkv'])
  const audio = new Set(['.m4a', '.mp3', '.wav', '.aac', '.webm'])
  const allowed = mediaKind === 'video' ? video : audio
  if (allowed.has(extension)) return extension
  return mediaKind === 'video' ? '.mp4' : '.m4a'
}

export function safeFilename(filename: string) {
  const base = path.basename(filename).replace(/[\u0000-\u001f]/g, '').trim()
  return (base || 'lesson').slice(0, 200)
}
