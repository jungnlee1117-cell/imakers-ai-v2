import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dataRoot } from './paths.js'

const execFileAsync = promisify(execFile)

function tail(error: unknown) {
  const stderr = typeof error === 'object' && error && 'stderr' in error
    ? String((error as { stderr?: unknown }).stderr ?? '')
    : error instanceof Error ? error.message : ''
  return stderr.replaceAll(dataRoot(), '[저장소]').trim().split('\n').slice(-3).join(' ').slice(0, 300)
}

export async function extractAudio(input: string, output: string) {
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', output], {
      timeout: 30 * 60 * 1000,
    })
  } catch (error) {
    throw new Error(`소리 추출에 실패했습니다. ${tail(error)}`.trim())
  }
}

export async function probeDuration(file: string) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      file,
    ], { timeout: 30_000 })
    const duration = Number(String(stdout).trim())
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch {
    return null
  }
}
