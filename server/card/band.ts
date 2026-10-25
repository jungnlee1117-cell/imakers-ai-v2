import { readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskCardText, maskChildNames } from './mask.js'
import { assertValidCard } from './validate.js'
import type { CardDocument, LessonProcessor, ProcessorInput, ProcessorOutput, TranscriptLineOut } from './types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixedCard = JSON.parse(readFileSync(join(here, '../../process/card_example_B_v1_1.json'), 'utf8')) as CardDocument
const fixedLines = JSON.parse(readFileSync(join(here, '../../process/transcript_lines_b.json'), 'utf8')) as Array<{
  start_sec: number
  text: string
  trusted: boolean
}>

function planLines(planText: string) {
  return planText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 1)
    .slice(0, 40)
}

/**
 * 지금 기본 경로. process.py run 의 API를 호출하거나 흉내 내지 않고,
 * 스키마를 통과한 card_example_B_v1_1.json 을 고정 출력으로 돌려준다.
 * 날짜·반·종목·언어·출처와, 이 앱에 올린 계획안 텍스트만 입력에 맞춘다.
 */
export const localBandProcessor: LessonProcessor = {
  id: 'local-band',
  async process(input: ProcessorInput): Promise<ProcessorOutput> {
    await stat(input.audioPath)
    const card = structuredClone(fixedCard)
    card.lesson = {
      ...card.lesson,
      date: input.lessonDate,
      class_name: input.className,
      sport: input.sport,
      language_mode: input.languageMode,
      source: input.source,
    }
    if (input.languageMode !== 'english') {
      delete card.english_phrases
      card.metrics = card.metrics.filter((metric) => metric.id !== 'gr')
      if (card.area_reviews) card.area_reviews = card.area_reviews.filter((review) => review.area !== 'english')
    }
    const planned = input.planText ? planLines(input.planText) : []
    card.plan_adherence = planned.length
      ? {
          status: 'done',
          planned,
          actual: [],
          missing: [],
          note: '계획안은 이 앱에 올린 텍스트입니다. 고정 결과는 수업 소리와 대조하지 않습니다.',
        }
      : { status: 'not_linked' }
    const masked = maskCardText(card)
    assertValidCard(masked)
    const transcript_lines: TranscriptLineOut[] = fixedLines.map((line) => ({
      start_sec: line.start_sec,
      text: maskChildNames(line.text),
      trusted: line.trusted,
    }))
    return { card: masked, transcript_lines }
  },
}

export const LOCAL_BAND_NOTICE = '이 카드는 처리 묶음이 스키마를 통과시킨 수업 B 고정 결과입니다. 올린 소리를 분석하지 않았고, 전사 API도 호출하지 않습니다. 계획안이 있으면 이 앱에 올린 텍스트만 붙입니다. 시간의 흐름은 그 고정 결과 기준입니다.'
