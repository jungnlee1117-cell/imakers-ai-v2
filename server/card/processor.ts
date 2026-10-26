import { LOCAL_BAND_ID } from '../limits.js'
import { localBandProcessor } from './band.js'
import { PROCESS_RUN_ID, processRunProcessor } from './run.js'
import type { LessonProcessor } from './types.js'

let override: LessonProcessor | null = null

export function setLessonProcessorForTests(processor: LessonProcessor | null) {
  override = processor
}

export function getLessonProcessor(): LessonProcessor {
  if (override) return override
  const id = process.env.PROCESSOR_ID || LOCAL_BAND_ID
  // process-run 은 전사를 이 컴퓨터에서 하고, 전사 텍스트만 Anthropic API로 보낸다. 소리는 보내지 않는다.
  if (id === PROCESS_RUN_ID) return processRunProcessor
  if (id !== LOCAL_BAND_ID) {
    throw new Error(`처리기 ${id}는 아직 연결되지 않았습니다. 음성은 외부로 보내지 않습니다.`)
  }
  return localBandProcessor
}
