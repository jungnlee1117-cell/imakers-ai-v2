export type StudioStep = 'start' | 'draw' | 'conversation' | 'visualize'

export type ResponseElement = 'REACT' | 'CONNECT' | 'EXPAND' | 'SUGGEST' | 'SUPPORT'

export interface DrawingObservation {
  description: string
  confidence: 'high' | 'medium' | 'low'
}

export interface DrawingAnalysis {
  observations: DrawingObservation[]
  uncertain: string[]
  openingMessage: string
}

export interface CreativeMemory {
  mainSubject: string
  confirmedFacts: string[]
  rejectedIdeas: string[]
  childPreferences: string[]
  mood: string
  askedQuestions: string[]
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
}

export const EMPTY_MEMORY: CreativeMemory = {
  mainSubject: '',
  confirmedFacts: [],
  rejectedIdeas: [],
  childPreferences: [],
  mood: '밝고 따뜻한 분위기',
  askedQuestions: [],
}
