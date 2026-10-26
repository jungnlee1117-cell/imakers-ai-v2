import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskCardText, maskChildNames } from './mask.js'
import { processSteps } from './process-steps.js'
import { assertValidCard } from './validate.js'
import type { CardDocument, LanguageMode, LessonProcessor, ProcessorInput, ProcessorOutput, TranscriptLineOut } from './types.js'

export const PROCESS_RUN_ID = 'process-run'

const here = dirname(fileURLToPath(import.meta.url))
const TRANSCRIBER = join(here, '../../scripts/transcribe_sherpa.py')

const LANGUAGE: Record<LanguageMode, string> = { english: 'en', korean: 'ko', mixed: '' }

/**
 * process.py run 을 그대로 호출한다. 전사는 이 컴퓨터의 sherpa-onnx Whisper small,
 * 분석은 Anthropic API. 어느 단계든 실패하면 오류를 던지고, 워커가 업로드를 failed 로 남긴다.
 * 작업 폴더(전사 원문 포함)는 끝나면 지운다. 증거 검사에서 버린 항목(run.dropped.json)과
 * 토큰 사용량(run.usage.json)만 소리 옆에 남기고, 보관 기간이 지나면 소리와 함께 지운다.
 */
export const processRunProcessor: LessonProcessor = {
  id: PROCESS_RUN_ID,
  async process(input: ProcessorInput): Promise<ProcessorOutput> {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.')
    if (!input.durationSec) throw new Error('소리 길이를 읽지 못했습니다.')
    const dir = await mkdtemp(join(tmpdir(), 'class-coach-run-'))
    const started = Date.now()
    try {
      const metaPath = join(dir, 'meta.json')
      const outDir = join(dir, 'work')
      await writeFile(metaPath, JSON.stringify({
        date: input.lessonDate,
        class_name: input.className,
        sport: input.sport,
        language_mode: input.languageMode,
        duration_sec: Math.round(input.durationSec),
        source: input.source,
        teacher_names: input.teacherName ? input.teacherName.split(/\s+/).filter(Boolean) : [],
      }))
      let planPath: string | undefined
      if (input.planText) {
        planPath = join(dir, 'plan.txt')
        await writeFile(planPath, input.planText)
      }
      try {
        await processSteps.run({
          audioPath: input.audioPath,
          metaPath,
          outDir,
          planPath,
          transcriberPath: TRANSCRIBER,
          transcribeLanguage: LANGUAGE[input.languageMode],
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(message.replaceAll(dir, '[작업]').replaceAll(input.audioPath, '[소리]'))
      }
      const card = JSON.parse(await readFile(join(outDir, 'card.json'), 'utf8')) as CardDocument
      // process.py 는 버린 항목이 있을 때만 파일을 쓴다. 없으면 빈 목록으로 남긴다.
      const dropped = await readFile(join(outDir, 'card.json.dropped.json'), 'utf8').catch(() => '[]\n')
      await writeFile(join(dirname(input.audioPath), 'run.dropped.json'), dropped)
      const lines = JSON.parse(await readFile(join(outDir, 'transcript_lines.json'), 'utf8')) as TranscriptLineOut[]
      const masked = maskCardText(card)
      assertValidCard(masked)
      const transcript_lines = lines.map((line) => ({
        start_sec: line.start_sec,
        text: maskChildNames(line.text),
        trusted: line.trusted,
      }))
      return { card: masked, transcript_lines }
    } finally {
      // 걸린 시간과 토큰 수만 남긴다. 키나 전사 내용은 찍지 않는다.
      const usage = await readFile(join(dir, 'work', 'usage.json'), 'utf8').catch(() => null)
      if (usage) await copyFile(join(dir, 'work', 'usage.json'), join(dirname(input.audioPath), 'run.usage.json'))
      console.log(`[process-run] ${Math.round((Date.now() - started) / 1000)}s usage=${usage ? JSON.stringify(JSON.parse(usage)) : 'none'}`)
      await rm(dir, { recursive: true, force: true })
    }
  },
}
