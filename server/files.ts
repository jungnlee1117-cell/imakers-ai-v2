import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveDataKey } from './paths.js'

export async function writeChunk(uploadId: string, index: number, body: Buffer) {
  const dir = resolveDataKey(`uploads/${uploadId}/chunks`)
  await mkdir(dir, { recursive: true })
  const partial = path.join(dir, `${index}.partial`)
  await writeFile(partial, body)
  await rename(partial, path.join(dir, String(index)))
}

export async function assembleUpload(uploadId: string, expected: number, extension: string) {
  const key = `uploads/${uploadId}/original${extension}`
  const target = resolveDataKey(key)
  await mkdir(path.dirname(target), { recursive: true })
  const handle = await open(target, 'w')
  try {
    for (let index = 0; index < expected; index += 1) {
      const chunkPath = resolveDataKey(`uploads/${uploadId}/chunks/${index}`)
      const chunk = await readFile(chunkPath)
      await handle.write(chunk)
    }
  } finally {
    await handle.close()
  }
  return key
}

export async function removeUploadFiles(uploadId: string) {
  await rm(resolveDataKey(`uploads/${uploadId}`), { recursive: true, force: true })
}

export async function removeChunks(uploadId: string) {
  await rm(resolveDataKey(`uploads/${uploadId}/chunks`), { recursive: true, force: true })
}

export function openReadStream(key: string, range?: { start: number; end: number }) {
  return createReadStream(resolveDataKey(key), range)
}

export async function fileSize(key: string) {
  const info = await stat(resolveDataKey(key))
  return info.size
}

export async function writeLessonPlan(id: string, body: Buffer) {
  const key = `lesson-plans/${id}.pdf`
  const target = resolveDataKey(key)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, body)
  return key
}

export function extractPdfText(body: Buffer) {
  const raw = body.toString('latin1')
  const parts: string[] = []
  const pattern = /\((?:\\[()\\]|[^\\)])*\)\s*Tj/g
  for (const match of raw.matchAll(pattern)) {
    const inner = match[0].replace(/\)\s*Tj$/, '').slice(1)
    const text = inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .trim()
    if (text) parts.push(text)
  }
  const text = parts.join('\n').slice(0, 200_000)
  if (!text) return { text: '', note: '글자를 읽지 못했습니다. 스캔된 PDF일 수 있습니다.' }
  return { text, note: null as string | null }
}
