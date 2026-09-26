import type { CreativeMemory, UnderstoodInput } from '../types/creative'

export interface ChildInputNormalizer {
  normalize(rawText: string, memory: CreativeMemory): UnderstoodInput
}

const SAFE_CORRECTIONS: Array<[RegExp, string]> = [
  [/친쿵나테/g, '친구한테'],
  [/친구한태/g, '친구한테'],
  [/엄마 구하로/g, '엄마 구하러'],
  [/아이스크림을 파는대/g, '아이스크림을 파는데'],
]

const KNOWN_SUBJECTS = ['돼지', '공룡', '로봇', '우주선', '고래', '펭귄', '자동차', '엄마', '친구', '용', '거북이']

function inferMeaning(text: string, memory: CreativeMemory) {
  const friendTrip = text.match(/친구한테\s*가는\s*(.+?)(?:이야|야)?$/)
  if (friendTrip) return `${friendTrip[1].replace(/(?:이야|야)$/, '')}가 친구를 만나러 가는 중`
  if (/달에서.*아이스크림.*우주선|아이스크림.*파는.*우주선/.test(text)) {
    return '우주선이 달에서 아이스크림을 파는 중'
  }
  if (/친구.*장난감.*가져/.test(text)) {
    return `${memory.mainSubject || '그림 속 주인공'}이 친구가 장난감을 가져가서 화가 난 상황`
  }
  if (/밤/.test(text)) return `장면의 시간대가 밤임: ${text}`
  return text
}

function hasUnknownNamePattern(text: string) {
  const match = text.match(/^([가-힣]{2,4})[이가]\s/)
  if (!match) return false
  return !KNOWN_SUBJECTS.includes(match[1])
}

export class ContextualChildInputNormalizer implements ChildInputNormalizer {
  normalize(rawText: string, memory: CreativeMemory): UnderstoodInput {
    const raw = rawText.trim().replace(/\s+/g, ' ')
    let normalized = raw
    for (const [pattern, replacement] of SAFE_CORRECTIONS) {
      normalized = normalized.replace(pattern, replacement)
    }
    const corrected = normalized !== raw
    const ambiguous = hasUnknownNamePattern(normalized)
    return {
      raw,
      normalized,
      meaning: inferMeaning(normalized, memory),
      confidence: ambiguous ? 'low' : corrected ? 'high' : 'medium',
      needsClarification: ambiguous,
    }
  }
}

export const childInputNormalizer: ChildInputNormalizer = new ContextualChildInputNormalizer()
