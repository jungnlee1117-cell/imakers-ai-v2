export type StudioStep = 'start' | 'draw' | 'conversation' | 'visualize' | 'motion'

export type ResponseElement = 'REACT' | 'CONNECT' | 'EXPAND' | 'SUGGEST' | 'SUPPORT'

export type UnderstandingConfidence = 'high' | 'medium' | 'low'
export type ChildIntent = 'CREATIVE_CONTENT' | 'ANSWER' | 'SOCIAL' | 'META_FEEDBACK' | 'COMMAND'
export type QuestionFocus =
  | 'identity'
  | 'color'
  | 'place'
  | 'action'
  | 'emotion'
  | 'relationship'
  | 'object'
  | 'goal'
  | 'problem'
  | 'change'
  | 'consent'

export interface UnderstoodInput {
  raw: string
  normalized: string
  meaning: string
  intent: ChildIntent
  confidence: UnderstandingConfidence
  needsClarification: boolean
}

export interface DrawingObservation {
  description: string
  confidence: 'high' | 'medium' | 'low'
}

export interface VisualEntity {
  label: string
  confidence: number
}

export interface DrawingAnalysis {
  likelySubjects: VisualEntity[]
  visualFeatures: string[]
  expressions: string[]
  objects: VisualEntity[]
  scene: string
  observations: DrawingObservation[]
  uncertainties: string[]
  openingMessage: string
  imageHash: string
  visionProvider: string
  analysisSource: 'mock' | 'vision'
}

export interface CreativeMemory {
  mainSubject: string
  confirmedFacts: string[]
  rejectedIdeas: string[]
  childPreferences: string[]
  mood: string
  askedQuestions: string[]
  behaviors: string[]
  movementIdeas: string[]
  worldRules: string[]
  understoodInputs: UnderstoodInput[]
  questionFocuses: string[]
  sceneDescription: string
  characterDescription: string
  childRequestedAdditions: string[]
}

export interface ConversationTurn {
  id: string
  speaker: 'ai' | 'child'
  text: string
  elements?: ResponseElement[]
}

export interface ImageVersion {
  id: number
  label: string
  request: string
  createdAt: string
  imageUrl: string
  imageId: string
  provider: string
  isMock: boolean
  debug?: {
    generationRequest: string
    keep: string[]
    change: string[]
    previousImageId?: string
  }
}

export const EMPTY_MEMORY: CreativeMemory = {
  mainSubject: '',
  confirmedFacts: [],
  rejectedIdeas: [],
  childPreferences: [],
  mood: '밝고 따뜻한 분위기',
  askedQuestions: [],
  behaviors: [],
  movementIdeas: [],
  worldRules: [],
  understoodInputs: [],
  questionFocuses: [],
  sceneDescription: '',
  characterDescription: '',
  childRequestedAdditions: [],
}
