import { z } from 'zod'

export const providerKindSchema = z.enum(['openai', 'anthropic', 'mock'])

export const creativeMemorySchema = z.object({
  mainSubject: z.string().default(''),
  confirmedFacts: z.array(z.string()).default([]),
  rejectedIdeas: z.array(z.string()).default([]),
  childPreferences: z.array(z.string()).default([]),
  mood: z.string().default('밝고 따뜻한 분위기'),
  askedQuestions: z.array(z.string()).default([]),
  behaviors: z.array(z.string()).default([]),
  movementIdeas: z.array(z.string()).default([]),
  worldRules: z.array(z.string()).default([]),
})

export const drawingAnalysisSchema = z.object({
  observations: z.array(z.object({
    description: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
  })),
  uncertain: z.array(z.string()),
  openingMessage: z.string(),
})

export const coachResponseSchema = z.object({
  reaction: z.string(),
  connection: z.string(),
  suggestion: z.string(),
  question: z.string(),
  memory_updates: z.object({
    main_subject: z.string().optional().default(''),
    confirmed_facts: z.array(z.string()),
    rejected_ideas: z.array(z.string()),
    preferences: z.array(z.string()),
    behaviors: z.array(z.string()),
    movement_ideas: z.array(z.string()),
    world_rules: z.array(z.string()),
    mood: z.string().optional().default(''),
  }),
  ready_to_visualize: z.boolean(),
})

export const memorySummarySchema = creativeMemorySchema

export type ProviderKind = z.infer<typeof providerKindSchema>
export type CreativeMemory = z.infer<typeof creativeMemorySchema>
export type DrawingAnalysis = z.infer<typeof drawingAnalysisSchema>
export type CoachResponse = z.infer<typeof coachResponseSchema>

export interface ConversationItem {
  speaker: 'ai' | 'child'
  text: string
}

export interface RespondInput {
  childMessage: string
  memory: CreativeMemory
  drawingAnalysis: DrawingAnalysis
  conversationHistory: ConversationItem[]
  turnCount: number
}

export interface ImageInput {
  drawingDataUrl: string
  memory: CreativeMemory
  request?: string
}

export interface TimedResult<T> {
  data: T
  model: string
  latencyMs: number
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface CloudAIProvider {
  readonly name: Exclude<ProviderKind, 'mock'>
  readonly textModel: string
  analyzeDrawing(imageDataUrl: string): Promise<TimedResult<DrawingAnalysis>>
  respondToChild(input: RespondInput): Promise<TimedResult<CoachResponse>>
  summarizeMemory(memory: CreativeMemory): Promise<TimedResult<CreativeMemory>>
  generateImage(input: ImageInput): Promise<TimedResult<string>>
  editImage(input: ImageInput): Promise<TimedResult<string>>
}

export class UnsupportedCapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedCapabilityError'
  }
}
