import { z } from 'zod'

export const providerKindSchema = z.enum(['openai', 'anthropic', 'fal', 'mock'])
export const childIntentSchema = z.enum(['CREATIVE_CONTENT', 'ANSWER', 'SOCIAL', 'META_FEEDBACK', 'COMMAND'])

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
  understoodInputs: z.array(z.object({
    raw: z.string(),
    normalized: z.string(),
    meaning: z.string(),
    intent: childIntentSchema.default('CREATIVE_CONTENT'),
    confidence: z.enum(['high', 'medium', 'low']),
    needsClarification: z.boolean(),
  })).default([]),
  questionFocuses: z.array(z.string()).default([]),
  sceneDescription: z.string().default(''),
  characterDescription: z.string().default(''),
  childRequestedAdditions: z.array(z.string()).default([]),
})

export const drawingAnalysisSchema = z.object({
  likelySubjects: z.array(z.object({
    label: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  visualFeatures: z.array(z.string()),
  expressions: z.array(z.string()),
  objects: z.array(z.object({
    label: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  scene: z.string(),
  observations: z.array(z.object({
    description: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
  })),
  uncertainties: z.array(z.string()),
  openingMessage: z.string(),
  imageHash: z.string().optional().default(''),
  visionProvider: z.string().optional().default(''),
  analysisSource: z.enum(['mock', 'vision']).optional().default('vision'),
})

export const coachResponseSchema = z.object({
  reaction: z.string(),
  connection: z.string(),
  suggestion: z.string(),
  question: z.string().default(''),
  question_focus: z.string().default(''),
  input_understanding: z.object({
    raw: z.string(),
    normalized: z.string(),
    meaning: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
    needs_clarification: z.boolean(),
  }),
  memory_updates: z.object({
    main_subject: z.string().optional().default(''),
    confirmed_facts: z.array(z.string()),
    rejected_ideas: z.array(z.string()),
    preferences: z.array(z.string()),
    behaviors: z.array(z.string()),
    movement_ideas: z.array(z.string()),
    world_rules: z.array(z.string()),
    scene_description: z.string().default(''),
    character_description: z.string().default(''),
    child_requested_additions: z.array(z.string()).default([]),
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
  rawChildInput?: string
  normalizedChildInput?: string
  inputUnderstanding?: {
    raw: string
    normalized: string
    meaning: string
    intent: z.infer<typeof childIntentSchema>
    confidence: 'high' | 'medium' | 'low'
    needsClarification: boolean
  }
  memory: CreativeMemory
  drawingAnalysis: DrawingAnalysis
  conversationHistory: ConversationItem[]
  turnCount: number
  previousAIQuestion?: string
  previousQuestions?: string[]
  retryInstruction?: string
}

export interface ImageInput {
  drawingDataUrl: string
  memory: CreativeMemory
  request?: string
  previousImageId?: string
  generationPrompt?: string
  keep?: string[]
  change?: string[]
}

export interface TimedResult<T> {
  data: T
  model: string
  latencyMs: number
  generationPrompt?: string
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
