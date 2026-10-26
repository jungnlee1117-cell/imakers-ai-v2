import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const processRoot = join(dirname(fileURLToPath(import.meta.url)), '../../process')

/** 나중에 그대로 바꿔 끼울 처리 구현. 앱은 이 파일의 내부를 다시 쓰지 않는다. */
export const PROCESS_PY = join(processRoot, 'process.py')

/** 전사기와 API 패키지가 깔린 가상환경. PROCESS_PYTHON 으로 바꿀 수 있다. */
const venvPython = join(processRoot, '../.venv/bin/python')

function python() {
  return process.env.PROCESS_PYTHON || (existsSync(venvPython) ? venvPython : 'python3')
}

export type FeatureArgs = {
  transcriptPath: string
  metaPath: string
  outDir: string
  planPath?: string
}

export type MergeArgs = {
  workDir: string
  analysisPath: string
  outPath: string
}

export type RunArgs = {
  audioPath: string
  metaPath: string
  outDir: string
  planPath?: string
  transcriberPath?: string
  /** 전사기에 넘길 언어. en | ko | 빈 값(자동) */
  transcribeLanguage?: string
}

function pythonArgs(command: 'features' | 'merge' | 'run', args: string[]) {
  return ['-I', PROCESS_PY, command, ...args]
}

function runProcess(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(python(), args, { stdio: ['ignore', 'pipe', 'pipe'], env })
    let stderr = ''
    child.stdout.on('data', () => undefined)
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`process.py가 실패했습니다 (${code ?? 'signal'}). ${stderr.slice(-500)}`))
    })
  })
}

/**
 * features / merge / run 을 process.py 명령 그대로 호출한다.
 * run 은 전사기와 API를 실제로 호출한다. 키가 없으면 실패하고, 성공한 척하는 결과를 만들지 않는다.
 * PROCESSOR_ID=process-run 일 때 처리기(run.ts)가 run 을 호출한다.
 */
export const processSteps = {
  features(input: FeatureArgs) {
    const args = ['--transcript', input.transcriptPath, '--meta', input.metaPath, '--out', input.outDir]
    if (input.planPath) args.push('--plan', input.planPath)
    return runProcess(pythonArgs('features', args))
  },
  merge(input: MergeArgs) {
    return runProcess(pythonArgs('merge', ['--work', input.workDir, '--analysis', input.analysisPath, '--out', input.outPath]))
  },
  run(input: RunArgs) {
    const args = ['--audio', input.audioPath, '--meta', input.metaPath, '--out', input.outDir]
    if (input.planPath) args.push('--plan', input.planPath)
    if (input.transcriberPath) args.push('--transcriber', input.transcriberPath)
    const env = { ...process.env, TRANSCRIBE_LANGUAGE: input.transcribeLanguage ?? '' }
    return runProcess(pythonArgs('run', args), env)
  },
}
