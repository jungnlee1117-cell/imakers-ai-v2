import { LOCAL_BAND_ID } from '../limits.js'
import { localBandProcessor } from './band.js'
import type { LessonProcessor } from './types.js'

let override: LessonProcessor | null = null

export function setLessonProcessorForTests(processor: LessonProcessor | null) {
  override = processor
}

export function getLessonProcessor(): LessonProcessor {
  if (override) return override
  const id = process.env.PROCESSOR_ID || LOCAL_BAND_ID
  if (id !== LOCAL_BAND_ID) {
    throw new Error(`처리기 ${id}는 아직 연결되지 않았습니다. 음성은 외부로 보내지 않습니다.`)
  }
  // 기본 경로는 process.py run 을 호출하지 않는다. 명령 포장은 process-steps.ts 에 있다.
  return localBandProcessor
}
