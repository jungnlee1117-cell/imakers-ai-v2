import type { RespondInput } from '../server/contracts.js'

const analysis = {
  observations: [
    { description: '가운데 큰 초록색 형태', confidence: 'high' as const },
    { description: '아래쪽의 둥근 모양 네 개', confidence: 'medium' as const },
    { description: '배경의 파란색 영역', confidence: 'medium' as const },
  ],
  uncertain: ['초록색 형태가 누구인지', '둥근 모양이 바퀴인지', '파란색이 물인지 하늘인지'],
  openingMessage: '가운데 큰 초록색 모양이 먼저 보이네. 내가 다르게 봤을 수도 있어. 이 친구는 누구야?',
}

const emptyMemory = {
  mainSubject: '',
  confirmedFacts: [],
  rejectedIdeas: [],
  childPreferences: [],
  mood: '밝고 따뜻한 분위기',
  askedQuestions: ['이 친구는 누구야?'],
  behaviors: [],
  movementIdeas: [],
  worldRules: [],
  understoodInputs: [],
  questionFocuses: [],
  sceneDescription: '',
  characterDescription: '',
  childRequestedAdditions: [],
}

export interface ProviderScenario {
  id: string
  title: string
  purpose: string
  input: RespondInput
}

export const providerScenarios: ProviderScenario[] = [
  {
    id: 'dinosaur-car',
    title: '공룡 자동차',
    purpose: '그림 단서와 아이의 독창적인 명명을 연결하는지',
    input: { childMessage: '공룡 자동차야', memory: emptyMemory, drawingAnalysis: analysis, turnCount: 0, conversationHistory: [{ speaker: 'ai', text: analysis.openingMessage }] },
  },
  {
    id: 'underwater-block-world',
    title: '마인크래프트 같은 물속 세계',
    purpose: '상표 모방보다 아이가 말한 세계의 특징을 확장하는지',
    input: { childMessage: '마인크래프트 같은 네모난 물속 세계야', memory: { ...emptyMemory, mainSubject: '물속 세계' }, drawingAnalysis: analysis, turnCount: 1, conversationHistory: [{ speaker: 'child', text: '여기는 물속이야' }] },
  },
  {
    id: 'flying-whale-house',
    title: '날아다니는 고래 집',
    purpose: '복합 아이디어를 임의로 분리하거나 정정하지 않는지',
    input: { childMessage: '고래 등에 집이 있고 하늘을 날아', memory: { ...emptyMemory, mainSubject: '날아다니는 고래 집' }, drawingAnalysis: analysis, turnCount: 1, conversationHistory: [{ speaker: 'child', text: '고래 집이야' }] },
  },
  {
    id: 'robot-football',
    title: '로봇 축구',
    purpose: '행동 장면을 구체적으로 연결하면서 질문 하나만 하는지',
    input: { childMessage: '로봇들이 축구 결승전을 하고 있어', memory: { ...emptyMemory, mainSubject: '축구 로봇' }, drawingAnalysis: analysis, turnCount: 2, conversationHistory: [{ speaker: 'child', text: '로봇이야' }, { speaker: 'ai', text: '이 로봇은 지금 무엇을 하고 있어?' }] },
  },
  {
    id: 'time-eating-dinosaur',
    title: '시간 먹는 공룡',
    purpose: '추상적 설정을 아이 대신 정의하지 않고 확장하는지',
    input: { childMessage: '시간을 먹으면 모두가 천천히 움직여', memory: { ...emptyMemory, mainSubject: '시간 먹는 공룡', confirmedFacts: ['시간을 먹는다'] }, drawingAnalysis: analysis, turnCount: 2, conversationHistory: [{ speaker: 'child', text: '시간을 먹는 공룡이야' }] },
  },
  {
    id: 'ice-road-penguin',
    title: '얼음 길 만드는 펭귄',
    purpose: '앞서 확정한 능력을 다음 장면과 연결하는지',
    input: { childMessage: '발로 얼음 길을 만들어서 친구들을 데려가', memory: { ...emptyMemory, mainSubject: '얼음 길 펭귄', confirmedFacts: ['발로 얼음 길을 만든다'] }, drawingAnalysis: analysis, turnCount: 2, conversationHistory: [{ speaker: 'child', text: '펭귄이 길을 만들 수 있어' }] },
  },
  {
    id: 'unsure',
    title: '모르겠어',
    purpose: '압박하지 않고 선택지 두 개와 열린 선택권을 주는지',
    input: { childMessage: '모르겠어', memory: { ...emptyMemory, mainSubject: '초록 친구' }, drawingAnalysis: analysis, turnCount: 1, conversationHistory: [{ speaker: 'ai', text: '어디로 가고 있어?' }] },
  },
  {
    id: 'reject-suggestion',
    title: 'AI 제안 거절',
    purpose: '거절을 존중하고 rejected_ideas에 정확히 저장하는지',
    input: { childMessage: '날개는 싫어. 넣지 마', memory: { ...emptyMemory, mainSubject: '공룡 자동차' }, drawingAnalysis: analysis, turnCount: 2, conversationHistory: [{ speaker: 'ai', text: '날개를 달아보는 건 어때?' }] },
  },
  {
    id: 'change-idea',
    title: '아이디어 중간 변경',
    purpose: '기존 설정을 강요하지 않고 아이의 변경을 새 사실로 다루는지',
    input: { childMessage: '아니, 이제 엄마를 구하러 가는 게 아니라 별을 찾으러 가', memory: { ...emptyMemory, mainSubject: '공룡 자동차', confirmedFacts: ['엄마를 구하러 간다'] }, drawingAnalysis: analysis, turnCount: 3, conversationHistory: [{ speaker: 'child', text: '엄마를 구하러 가' }] },
  },
  {
    id: 'drawing-intent-mismatch',
    title: '그림 설명과 실제 의도가 다른 경우',
    purpose: '시각 관찰보다 아이가 확인한 의미를 우선하는지',
    input: { childMessage: '그건 바퀴가 아니라 달이 네 개 떠 있는 거야', memory: emptyMemory, drawingAnalysis: analysis, turnCount: 1, conversationHistory: [{ speaker: 'ai', text: '아래 둥근 모양은 바퀴처럼 보이기도 해. 무엇이야?' }] },
  },
]
