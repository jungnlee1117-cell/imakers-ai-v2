import type { CreativeMemory, DrawingAnalysis } from '../types/creative'
import type {
  AIProvider,
  AIResponse,
  ChildResponseContext,
  EditImageInput,
  GenerateImageInput,
  ImageProvider,
} from './types'

const wait = (ms = 450) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

const unique = (items: string[]) => [...new Set(items.filter(Boolean))]

function inferSubject(meaning: string, current: string) {
  for (const subject of ['돼지', '우주선', '로봇', '공룡 자동차', '공룡', '고래', '펭귄']) {
    if (meaning.includes(subject)) return subject
  }
  return current
}

function updateMemory(context: ChildResponseContext): CreativeMemory {
  const { inputUnderstanding, memory } = context
  if (inputUnderstanding.intent === 'SOCIAL' || inputUnderstanding.intent === 'META_FEEDBACK') {
    return memory
  }
  const text = inputUnderstanding.normalized
  const next = {
    ...memory,
    understoodInputs: [...memory.understoodInputs, inputUnderstanding],
  }
  const rejection = /싫|아니|빼|없애|안 해|하지 마/.test(text)

  if (rejection) {
    const lastSuggestion = text.includes('날개') ? '날개 추가' : `AI가 제안한 아이디어: ${text}`
    next.rejectedIdeas = unique([...memory.rejectedIdeas, lastSuggestion])
    return next
  }

  next.mainSubject = inferSubject(inputUnderstanding.meaning, memory.mainSubject)
  next.confirmedFacts = unique([...memory.confirmedFacts, inputUnderstanding.meaning])
  if (/돼지/.test(text)) next.characterDescription = '아이 그림의 특징을 유지한 돼지'
  if (/우주선/.test(text)) next.characterDescription = '달에서 장사하는 우주선'
  if (/로봇/.test(text) || /장난감/.test(text)) next.characterDescription = '감정이 표정에 드러나는 로봇'
  if (/숲/.test(text)) next.sceneDescription = '나무가 이어진 숲길'
  if (/달/.test(text)) next.sceneDescription = '달 표면의 아이스크림 가게'
  if (/친구한테/.test(text)) next.sceneDescription = '친구를 만나러 가는 길'
  if (/가방|선물|숲|밤/.test(text)) next.childRequestedAdditions = unique([...memory.childRequestedAdditions, text])

  if (/크게|큰 |밝|따뜻|귀여|신나/.test(text)) {
    next.childPreferences = unique([...memory.childPreferences, text.replace(/[.!?]/g, '')])
  }
  if (/밤|어둡/.test(text)) next.mood = '신비로운 밤 분위기'
  if (/밝|낮|햇빛/.test(text)) next.mood = '밝고 따뜻한 분위기'
  if (/달리|뛰|점프|날|움직|흔들|돌아|회전/.test(text)) {
    next.movementIdeas = unique([...memory.movementIdeas, text.replace(/[.!?]/g, '')])
  }
  if (/무서워|좋아해|보면|때마다/.test(text)) {
    next.behaviors = unique([...memory.behaviors, text.replace(/[.!?]/g, '')])
  }
  if (/되면|가까이|생기|바뀌|에서는/.test(text)) {
    next.worldRules = unique([...memory.worldRules, text.replace(/[.!?]/g, '')])
  }
  return next
}

function makeResponse(context: ChildResponseContext, memory: CreativeMemory): AIResponse {
  const text = context.normalizedChildInput
  const intent = context.inputUnderstanding.intent
  const rejected = /싫|아니|빼|없애|안 해|하지 마/.test(text)
  const unsure = /모르|글쎄|음\.\.\.|몰라/.test(text)
  let reaction = ''
  let connection = ''
  let suggestion = ''
  let question = ''
  let focus = ''

  if (intent === 'SOCIAL') {
    reaction = '나도 같이 만들어서 재밌었어 😊'
  } else if (intent === 'META_FEEDBACK') {
    reaction = '맞아, 방금 대화가 조금 어색했네. 같은 말을 반복하지 않고 자연스럽게 이어가볼게.'
  } else if (intent === 'ANSWER' && /색/.test(context.previousAIQuestion)) {
    if (/파란색/.test(text)) reaction = '파란색 좋다. 그럼 이 부분을 파란색으로 해보자.'
    else if (/노란색/.test(text)) reaction = '노란색이구나. 밝고 따뜻한 느낌이 떠오르네.'
    else reaction = `${text}이구나. 방금 이야기한 부분에 그 색을 이어볼게.`
  } else if (intent === 'ANSWER' && /^(응|네)[!.~\s]*$/.test(text)) {
    reaction = '응, 좋아. 그렇게 이어가보자.'
  } else if (rejected) {
    reaction = '좋아, 그 생각은 빼자. 네가 정한 모습이 더 중요해.'
  } else if (context.inputUnderstanding.needsClarification) {
    const name = text.match(/^([가-힣]{2,4})[이가]\s/)?.[1] || '그 말'
    reaction = `${name}가 중요한 친구인 것 같네.`
    question = `${name}는 네가 만든 친구 이름이야?`
    focus = 'identity'
  } else if (unsure) {
    reaction = '아직 딱 떠오르지 않는구나.'
    suggestion = '표정이 달라지거나, 누군가 먼저 말을 거는 장면을 생각해볼 수 있어. 완전히 다른 생각도 좋아.'
  } else if (/돼지.*친구|친구.*돼지/.test(context.inputUnderstanding.meaning)) {
    reaction = '아, 이 돼지는 친구를 만나러 가는 중이구나.'
    connection = '친구를 향해 가는 마음이 돼지 표정에도 담겨 있을 것 같아.'
    question = '친구를 만나면 제일 먼저 뭐라고 말하고 싶을까?'
    focus = 'relationship'
  } else if (/우주선.*달.*아이스크림/.test(context.inputUnderstanding.meaning)) {
    reaction = '달에서 아이스크림을 파는 우주선이라니, 가게와 탈것이 하나인 거네.'
    suggestion = '달에서는 녹지 않고 반짝이는 아이스크림도 어울릴 것 같아.'
    question = '달 손님들이 가장 좋아하는 맛은 어떤 맛일까?'
    focus = 'world-detail'
  } else if (/장난감.*가져|화가 난/.test(context.inputUnderstanding.meaning)) {
    reaction = '친구가 장난감을 가져가서 속상하고 화가 난 마음이구나.'
    connection = `${memory.mainSubject || '그림 속 친구'}의 표정이 왜 그렇게 보였는지 이제 알 것 같아.`
    question = `${memory.mainSubject || '이 친구'}는 친구에게 자기 마음을 어떻게 알려주고 싶을까?`
    focus = 'emotion'
  } else if (/밤|숲|가방|선물/.test(text)) {
    reaction = `${context.inputUnderstanding.meaning}이라는 장면이 더 또렷해졌어.`
    connection = memory.mainSubject ? `${memory.mainSubject}의 모습과 지금 말한 배경이 이어진다.` : ''
    question = /선물/.test(text) ? '선물을 받은 친구는 어떤 표정을 지을까?' : ''
    focus = question ? 'reaction' : ''
  } else {
    reaction = memory.mainSubject
      ? `좋아, 그 생각을 ${memory.mainSubject}의 장면에 자연스럽게 이어가볼게.`
      : '좋아, 그 생각을 그림에 자연스럽게 이어가볼게.'
    connection = memory.mainSubject ? `아까 이야기한 ${memory.mainSubject}와도 이어지네.` : ''
  }

  const conversationalIntent = intent === 'SOCIAL' || intent === 'META_FEEDBACK'
  const readyToVisualize = !conversationalIntent && (context.turnCount >= 3 || memory.confirmedFacts.length >= 4)
  if (readyToVisualize && !question) {
    question = '지금까지 말해준 모습을 그림으로 같이 펼쳐볼까?'
    focus = 'consent'
  }
  const nextMemory = {
    ...memory,
    askedQuestions: question ? unique([...memory.askedQuestions, question]) : memory.askedQuestions,
    questionFocuses: focus ? unique([...memory.questionFocuses, focus]) : memory.questionFocuses,
  }
  const parts = [reaction, connection, suggestion, question].filter(Boolean)
  return {
    text: parts.join(' '),
    reaction,
    connection,
    suggestion,
    question,
    elements: [
      ...(reaction ? ['REACT' as const] : []),
      ...(connection ? ['CONNECT' as const] : []),
      ...(suggestion ? ['SUGGEST' as const] : []),
      ...(question ? ['EXPAND' as const] : []),
    ],
    memory: nextMemory,
    readyToVisualize,
  }
}

export class MockAIProvider implements AIProvider {
  async analyzeDrawing(_imageDataUrl: string): Promise<DrawingAnalysis> {
    await wait(900)
    return {
      observations: [
        { description: '가운데에 크고 선명한 형태', confidence: 'high' },
        { description: '아래쪽의 둥근 모양들', confidence: 'medium' },
        { description: '여러 색이 이어진 배경', confidence: 'medium' },
      ],
      uncertain: ['가운데 친구가 누구인지', '둥근 모양이 무엇인지', '어떤 일이 벌어지는 장면인지'],
      openingMessage:
        '가운데 있는 큰 친구가 제일 먼저 눈에 들어오네. 아래에는 동그란 모양도 보여. 내가 생각한 것과 다를 수 있으니까 궁금해—네가 만든 이 친구는 누구야?',
    }
  }

  async respondToChild(context: ChildResponseContext): Promise<AIResponse> {
    await wait()
    const memory = updateMemory(context)
    const response = makeResponse(context, memory)
    return response
  }

  async summarizeCreativeMemory(memory: CreativeMemory): Promise<CreativeMemory> {
    return memory
  }
}

export class MockImageProvider implements ImageProvider {
  async generateFromDrawing(input: GenerateImageInput) {
    await wait(1200)
    return {
      imageUrl: input.drawingDataUrl,
      imageId: `mock-${crypto.randomUUID()}`,
      provider: 'mock',
      isMock: true,
      debug: {
        generationRequest: 'Mock provider: 실제 이미지 생성 요청을 보내지 않았습니다.',
        keep: [input.memory.mainSubject || '원본 그림'],
        change: input.memory.confirmedFacts,
      },
    }
  }

  async editImage(input: EditImageInput) {
    await wait(1100)
    return {
      imageUrl: input.sourceImageUrl,
      imageId: `mock-${crypto.randomUUID()}`,
      provider: 'mock',
      isMock: true,
      debug: {
        generationRequest: `Mock edit: ${input.request}`,
        keep: [input.memory.mainSubject || '원본 그림', ...input.memory.confirmedFacts],
        change: [input.request],
        previousImageId: input.previousImageId,
      },
    }
  }
}
