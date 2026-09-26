import type { ChildIntent, CreativeMemory, QuestionFocus, UnderstoodInput } from '../types/creative'

export interface ChildInputNormalizer {
  normalize(rawText: string, memory: CreativeMemory, previousAIQuestion?: string): UnderstoodInput
}

const SAFE_CORRECTIONS: Array<[RegExp, string]> = [
  [/파랑색/g, '파란색'],
  [/노랑색/g, '노란색'],
  [/친쿵나테/g, '친구한테'],
  [/친구한태/g, '친구한테'],
  [/엄마 구하로/g, '엄마 구하러'],
  [/아이스크림을 파는대/g, '아이스크림을 파는데'],
]

const KNOWN_SUBJECTS = ['돼지', '공룡', '로봇', '우주선', '고래', '펭귄', '자동차', '엄마', '친구', '용', '거북이']

export function classifyChildIntent(text: string, previousAIQuestion = ''): ChildIntent {
  if (
    /대화.*(?:자연스럽지|어색|이상)|왜\s*(?:자꾸|계속).*(?:물어|말해|반복)|(?:똑같|같은).*(?:질문|말)|그림이\s*이상|^다시\s*해\s*줘$/.test(text)
  ) return 'META_FEEDBACK'
  if (/^(?:고마워|감사해|안녕|반가워|좋아|재밌어|잘했어)[!.~😊🙂\s]*$/u.test(text)) return 'SOCIAL'
  if (/(?:크게|작게|바꿔|해\s*줘|해줘|없애|지워|빼\s*줘|빼줘|추가해|그려줘)/.test(text)) return 'COMMAND'
  if (
    /^(?:응|네|아니|싫어|몰라|모르겠어)[!.~\s]*$/.test(text)
    || (previousAIQuestion && text.length <= 20 && !/[.!?].+/.test(text))
  ) return 'ANSWER'
  return 'CREATIVE_CONTENT'
}

export function inferQuestionFocus(text: string): QuestionFocus | '' {
  const segments = text.split(/(?<=[.!?？])\s*/).filter(Boolean)
  const question = [...segments].reverse().find((segment) => /[?？]|(?:까|니|어|지)\s*$/.test(segment.trim()))
  if (!question) return ''
  if (/색/.test(question)) return 'color'
  if (/누구를\s*만나|친구|함께|사이/.test(question)) return 'relationship'
  if (/누구|이름|정체/.test(question)) return 'identity'
  if (/어디|장소|곳/.test(question)) return 'place'
  if (/무엇을?\s*(?:들|가져)|뭘\s*(?:들|가져)|물건/.test(question)) return 'object'
  if (/기분|마음|느낌|표정/.test(question)) return 'emotion'
  if (/문제|어려|곤란|막혔/.test(question)) return 'problem'
  if (/왜|목표|하려|하고 싶/.test(question)) return 'goal'
  if (/바뀌|달라|변하|추가|빼/.test(question)) return 'change'
  if (/뭐\s*하|무엇을\s*하|어떻게|움직|가(?:는|고)|행동/.test(question)) return 'action'
  return ''
}

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
  normalize(rawText: string, memory: CreativeMemory, previousAIQuestion = ''): UnderstoodInput {
    const raw = rawText.trim().replace(/\s+/g, ' ')
    let normalized = raw
    for (const [pattern, replacement] of SAFE_CORRECTIONS) {
      normalized = normalized.replace(pattern, replacement)
    }
    const corrected = normalized !== raw
    const intent = classifyChildIntent(normalized, previousAIQuestion)
    const ambiguous = intent === 'CREATIVE_CONTENT' && hasUnknownNamePattern(normalized)
    return {
      raw,
      normalized,
      meaning: inferMeaning(normalized, memory),
      intent,
      confidence: ambiguous ? 'low' : corrected ? 'high' : 'medium',
      needsClarification: ambiguous,
    }
  }
}

export const childInputNormalizer: ChildInputNormalizer = new ContextualChildInputNormalizer()
