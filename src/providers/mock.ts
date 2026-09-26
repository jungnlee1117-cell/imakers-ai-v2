import type { CreativeMemory, DrawingAnalysis } from '../types/creative'
import type {
  AIProvider,
  AIResponse,
  ChildResponseContext,
  EditImageInput,
  GenerateImageInput,
  ImageProvider,
} from './types'

const wait = (ms = 650) => new Promise((resolve) => window.setTimeout(resolve, ms))

const unique = (items: string[]) => [...new Set(items.filter(Boolean))]

function updateMemory(context: ChildResponseContext): CreativeMemory {
  const { childMessage, memory, turnCount } = context
  const text = childMessage.trim()
  const next = { ...memory }
  const rejection = /싫|아니|빼|없애|안 해|하지 마/.test(text)

  if (rejection) {
    const lastSuggestion = text.includes('날개') ? '날개 추가' : `AI가 제안한 아이디어: ${text}`
    next.rejectedIdeas = unique([...memory.rejectedIdeas, lastSuggestion])
    return next
  }

  if (turnCount <= 1 && text.length < 22) next.mainSubject = text.replace(/[.!?]/g, '')
  else next.confirmedFacts = unique([...memory.confirmedFacts, text.replace(/[.!?]/g, '')])

  if (/크게|큰 |밝|따뜻|귀여|신나/.test(text)) {
    next.childPreferences = unique([...memory.childPreferences, text.replace(/[.!?]/g, '')])
  }
  if (/밤|어둡/.test(text)) next.mood = '신비로운 밤 분위기'
  if (/밝|낮|햇빛/.test(text)) next.mood = '밝고 따뜻한 분위기'
  return next
}

function makeResponse(context: ChildResponseContext, memory: CreativeMemory): AIResponse {
  const text = context.childMessage.trim()
  const rejected = /싫|아니|빼|없애|안 해|하지 마/.test(text)
  const unsure = /모르|글쎄|음\.\.\.|몰라/.test(text)
  const subject = memory.mainSubject || '이 친구'

  if (rejected) {
    return {
      text: `좋아, 그 생각은 빼자. 네가 정한 모습이 더 중요해. 그럼 ${subject}에게 꼭 남기고 싶은 건 뭐야?`,
      elements: ['REACT', 'CONNECT'],
      memory,
      readyToVisualize: context.turnCount >= 3,
    }
  }
  if (unsure) {
    return {
      text: `아직 떠오르지 않는구나. 내 생각 두 개만 놓아볼게. 길에서 반짝이는 흔적을 발견하거나, 누군가 도움을 청하는 건 어때? 아니면 완전히 다른 생각도 좋아.`,
      elements: ['SUPPORT', 'SUGGEST'],
      memory,
      readyToVisualize: false,
    }
  }
  if (context.turnCount === 0) {
    return {
      text: `아, ${text}(이)구나! 그래서 그림 속 모양들이 서로 이어져 있었구나. ${subject}는 지금 어디로 가고 있어?`,
      elements: ['REACT', 'CONNECT'],
      memory,
      readyToVisualize: false,
    }
  }
  if (context.turnCount === 1) {
    return {
      text: `${text}라서 서두르고 있는 거구나. 아까 말한 ${subject}의 모습과 잘 이어진다. 가는 길에 어떤 곳을 지나면 재미있을까?`,
      elements: ['REACT', 'CONNECT', 'EXPAND'],
      memory,
      readyToVisualize: false,
    }
  }
  if (context.turnCount === 2) {
    return {
      text: `${text}, 그 장면이 눈앞에 보이는 것 같아. 그곳을 지나려면 ${subject}만의 특별한 방법이 필요하겠네. 어떤 방법을 떠올렸어?`,
      elements: ['REACT', 'CONNECT', 'EXPAND'],
      memory,
      readyToVisualize: false,
    }
  }
  return {
    text: `그 방법은 네 이야기에서만 나올 수 있겠다. 지금까지 말해준 ${subject}의 모습이 꽤 또렷해졌어. 네가 말해준 모습을 같이 만들어볼까?`,
    elements: ['REACT', 'CONNECT'],
    memory,
    readyToVisualize: true,
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
    const question = response.text.match(/[^.!?]*\?/)?.[0]?.trim()
    if (question) {
      response.memory = {
        ...response.memory,
        askedQuestions: unique([...response.memory.askedQuestions, question]),
      }
    }
    return response
  }

  async summarizeCreativeMemory(memory: CreativeMemory): Promise<CreativeMemory> {
    return memory
  }
}

export class MockImageProvider implements ImageProvider {
  async generateFromDrawing(input: GenerateImageInput): Promise<string> {
    await wait(1200)
    return input.drawingDataUrl
  }

  async editImage(input: EditImageInput): Promise<string> {
    await wait(1100)
    return input.sourceImageUrl
  }
}
