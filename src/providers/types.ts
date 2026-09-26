import type { CreativeMemory, DrawingAnalysis } from '../types/creative'

export interface ChildResponseContext {
  childMessage: string
  memory: CreativeMemory
  turnCount: number
  drawingAnalysis: DrawingAnalysis
}

export interface AIResponse {
  text: string
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

export interface EditImageInput {
  sourceImageUrl: string
  request: string
  memory: CreativeMemory
}

export interface ImageProvider {
  generateFromDrawing(input: GenerateImageInput): Promise<string>
  editImage(input: EditImageInput): Promise<string>
}

export type ProviderKind = 'mock' | 'openai' | 'anthropic' | 'local'
