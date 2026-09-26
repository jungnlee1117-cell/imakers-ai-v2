import type { CreativeMemory, DrawingAnalysis, ResponseElement, UnderstoodInput } from '../types/creative'

export interface ChildResponseContext {
  childMessage: string
  rawChildInput: string
  normalizedChildInput: string
  inputUnderstanding: UnderstoodInput
  memory: CreativeMemory
  turnCount: number
  drawingAnalysis: DrawingAnalysis
  conversationHistory: Array<{ speaker: 'ai' | 'child'; text: string }>
  previousAIQuestion: string
  previousQuestions: string[]
}

export interface AIResponse {
  text: string
  elements: ResponseElement[]
  reaction?: string
  connection?: string
  suggestion?: string
  question?: string
  memory: CreativeMemory
  readyToVisualize: boolean
}

export interface AIProvider {
  analyzeDrawing(imageDataUrl: string): Promise<DrawingAnalysis>
  respondToChild(context: ChildResponseContext): Promise<AIResponse>
  summarizeCreativeMemory(memory: CreativeMemory): Promise<CreativeMemory>
}

export interface GenerateImageInput {
  drawingDataUrl: string
  memory: CreativeMemory
}

export interface GeneratedImageAsset {
  imageUrl: string
  imageId: string
  provider: string
  isMock: boolean
  debug: {
    generationRequest: string
    keep: string[]
    change: string[]
    previousImageId?: string
  }
}

export interface EditImageInput {
  sourceImageUrl: string
  previousImageId: string
  request: string
  memory: CreativeMemory
}

export interface ImageProvider {
  generateFromDrawing(input: GenerateImageInput): Promise<GeneratedImageAsset>
  editImage(input: EditImageInput): Promise<GeneratedImageAsset>
}

export type ProviderKind = 'mock' | 'openai' | 'anthropic' | 'local'
