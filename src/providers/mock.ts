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
const MOCK_OPENINGS = [
  '가운데 큰 모양과 이어진 선들이 먼저 눈에 들어오네. 어떤 장면인지 같이 펼쳐보자.',
  '여러 색이 한곳에 모여 있어서 움직이는 장면처럼 보여. 여기서는 무슨 일이 일어나고 있을까?',
  '둥근 모양과 길게 뻗은 선이 재미있게 이어져 있네. 가장 마음에 드는 부분부터 이야기해줘.',
]
let mockOpeningIndex = 0

const unique = (items: string[]) => [...new Set(items.filter(Boolean))]

async function imageHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${[...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

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
  if (
    inputUnderstanding.intent === 'ANSWER'
    && /^(?:응|네|아니|싫어|몰라|모르겠어)[!.~\s]*$/.test(text)
  ) {
    return memory
  }
  const next = {
    ...memory,
    understoodInputs: [...memory.understoodInputs, inputUnderstanding],
  }
  if (
    inputUnderstanding.intent === 'COMMAND'
    && /그려\s*줘|그려줘|만들어\s*줘|만들어줘|이제\s*해\s*보자/.test(text)
  ) {
    return next
  }
  if (/^(?:아니|근데\s*사실)/.test(text)) {
    const superseded = memory.confirmedFacts.filter((fact) => (
      (/우주/.test(text) && /친구.*만나|만나러|가는\s*중/.test(fact))
      || (/웃/.test(text) && /화|화났/.test(fact))
    ))
    next.confirmedFacts = memory.confirmedFacts.filter((fact) => !superseded.includes(fact))
    next.supersededIdeas = unique([...memory.supersededIdeas, ...superseded])
  }
  const rejection = /싫|빼|없애|안 해|하지 마/.test(text)

  if (rejection) {
    const lastSuggestion = text.includes('날개') ? '날개 추가' : `AI가 제안한 아이디어: ${text}`
    next.rejectedIdeas = unique([...memory.rejectedIdeas, lastSuggestion])
    return next
  }

  next.mainSubject = inferSubject(inputUnderstanding.meaning, memory.mainSubject)
  next.confirmedFacts = unique([...(next.confirmedFacts || memory.confirmedFacts), inputUnderstanding.meaning])
  if (/돼지/.test(text)) next.characterDescription = '아이 그림의 특징을 유지한 돼지'
  if (/우주선/.test(text)) next.characterDescription = '달에서 장사하는 우주선'
  if (/로봇/.test(text) || /장난감/.test(text)) next.characterDescription = '감정이 표정에 드러나는 로봇'
  if (/숲/.test(text)) next.sceneDescription = '나무가 이어진 숲길'
  if (/달/.test(text)) next.sceneDescription = '달 표면의 아이스크림 가게'
  if (/친구한테|친구.*만나/.test(text)) next.sceneDescription = '친구를 만나러 가는 길'
  if (/우주/.test(text)) next.sceneDescription = '우주로 가는 길'
  if (/가방|선물|케이크|숲|밤/.test(text)) next.childRequestedAdditions = unique([...memory.childRequestedAdditions, text])

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
  const rejected = /싫|빼|없애|안 해|하지 마/.test(text)
  const unsure = /모르|글쎄|음\.\.\.|몰라/.test(text)
  const changedDecision = /^(?:아니|근데\s*사실)/.test(text)
  const createRequested = /그려\s*줘|그려줘|만들어\s*줘|만들어줘|이제\s*해\s*보자/.test(text)
  let reaction = ''
  let connection = ''
  let suggestion = ''
  let question = ''
  let focus = ''

  if (intent === 'SOCIAL') {
    reaction = '나도 같이 만들어서 재밌었어 😊'
  } else if (intent === 'META_FEEDBACK') {
    reaction = '맞아, 방금 대화가 조금 어색했네. 같은 말을 반복하지 않고 자연스럽게 이어가볼게.'
  } else if (createRequested) {
    reaction = '좋아. 지금까지 말한 걸 그림으로 같이 펼쳐보자.'
  } else if (intent === 'ANSWER' && /색/.test(context.previousAIQuestion)) {
    if (/파란색/.test(text)) reaction = '파란색 좋다. 그럼 이 부분을 파란색으로 해보자.'
    else if (/노란색/.test(text)) reaction = '노란색이구나. 밝고 따뜻한 느낌이 떠오르네.'
    else reaction = `${text}이구나. 방금 이야기한 부분에 그 색을 이어볼게.`
  } else if (intent === 'ANSWER' && /^(응|네)[!.~\s]*$/.test(text)) {
    reaction = '응, 좋아. 그렇게 이어가보자.'
  } else if (intent === 'ANSWER' && /^아니[!.~\s]*$/.test(text)) {
    reaction = '알겠어. 그건 정하지 않고 다른 생각을 이어가보자.'
  } else if (rejected) {
    reaction = '좋아, 그 생각은 빼자. 네가 정한 모습이 더 중요해.'
  } else if (unsure) {
    reaction = '아직 딱 떠오르지 않는구나.'
    suggestion = '케이크나 풍선을 떠올려도 좋고, 완전히 다른 생각을 골라도 좋아.'
  } else if (changedDecision && /우주/.test(text)) {
    reaction = '오, 계획이 바뀌었네. 이번에는 우주로 가는 거구나.'
  } else if (changedDecision && /웃/.test(text)) {
    reaction = '아, 화난 게 아니라 사실 웃고 있는 거구나. 지금 말해준 표정으로 바꿔서 기억할게.'
  } else if (/선물/.test(text)) {
    reaction = '선물을 가져가는구나.'
    const giftVisible = context.drawingAnalysis.visualFeatures.some((feature) => /선물/.test(feature))
      || context.drawingAnalysis.objects.some((object) => /선물/.test(object.label))
    connection = giftVisible ? '그림에 보이는 선물과 지금 이야기가 이어지네.' : '아직 그림에는 선물이 안 보이는데, 같이 넣어볼 수 있겠다.'
  } else if (/케이크/.test(text)) {
    reaction = '선물은 케이크구나. 들고 가는 모습이 더 또렷해졌어.'
  } else if (/화났|화가\s*났/.test(text)) {
    reaction = '얘가 화가 난 거구나. 그림의 표정은 다르게 보일 수도 있지만 네가 알려준 마음을 기억할게.'
  } else if (/친구.*당근.*먹/.test(text)) {
    reaction = '친구가 당근을 먹어서 화가 났던 거구나. 앞에서 말한 마음이랑 이어지네.'
  } else if (/친구.*만나/.test(text)) {
    reaction = `${memory.mainSubject || '이 친구'}가 친구를 만나러 가는 중이구나.`
  } else if (context.inputUnderstanding.needsClarification) {
    reaction = '그 말이 이름인지, 지금 일어나는 일인지 조금 헷갈렸어.'
    question = '한 번만 더 짧게 들려줄래?'
    focus = 'identity'
  } else {
    reaction = memory.mainSubject
      ? `응, ${memory.mainSubject} 이야기와 자연스럽게 이어지네.`
      : '응, 지금 말해준 걸 이어서 생각해볼게.'
  }

  const conversationalIntent = intent === 'SOCIAL' || intent === 'META_FEEDBACK'
  const visibleFeature = context.drawingAnalysis.visualFeatures[0]
  if (
    !conversationalIntent
    && visibleFeature
    && ![reaction, connection, suggestion, question].join(' ').includes(visibleFeature)
  ) {
    connection = [connection, `그림에서 보인 ${visibleFeature}도 지금 이야기와 이어지네.`].filter(Boolean).join(' ')
  }
  const readyToVisualize = !conversationalIntent && createRequested
  if (question && focus && memory.questionFocuses.slice(-3).includes(focus)) {
    question = ''
    focus = ''
  }
  const nextMemory = {
    ...memory,
    askedQuestions: question ? unique([...memory.askedQuestions, question]) : memory.askedQuestions,
    questionFocuses: focus ? [...memory.questionFocuses, focus].slice(-10) : memory.questionFocuses,
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
    debug: { responseSource: 'mock-rule-provider', model: 'hardcoded-heuristics' },
  }
}

export class MockAIProvider implements AIProvider {
  async analyzeDrawing(imageDataUrl: string): Promise<DrawingAnalysis> {
    await wait(900)
    const openingMessage = MOCK_OPENINGS[mockOpeningIndex % MOCK_OPENINGS.length]
    mockOpeningIndex += 1
    return {
      likelySubjects: [],
      visualFeatures: ['가운데의 크고 선명한 형태', '아래쪽의 둥근 모양', '여러 색이 이어진 선'],
      expressions: [],
      objects: [],
      scene: 'Mock provider는 실제 장면을 판별하지 않음',
      observations: [
        { description: '가운데에 크고 선명한 형태', confidence: 'high' },
        { description: '아래쪽의 둥근 모양들', confidence: 'medium' },
        { description: '여러 색이 이어진 배경', confidence: 'medium' },
      ],
      uncertainties: ['가운데 친구가 누구인지', '둥근 모양이 무엇인지', '어떤 일이 벌어지는 장면인지'],
      openingMessage,
      imageHash: await imageHash(imageDataUrl),
      visionProvider: 'mock:hardcoded-observations',
      analysisSource: 'mock',
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
