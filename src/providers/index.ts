import { MockAIProvider, MockImageProvider } from './mock'
import type {
  AIProvider,
  AIResponse,
  ChildResponseContext,
  EditImageInput,
  GenerateImageInput,
  ImageProvider,
  ProviderKind,
} from './types'
import type { CreativeMemory, DrawingAnalysis } from '../types/creative'

class RemoteAIProvider implements AIProvider {
  private readonly kind: Exclude<ProviderKind, 'mock'>
  private readonly baseUrl: string

  constructor(kind: Exclude<ProviderKind, 'mock'>, baseUrl: string) {
    this.kind = kind
    this.baseUrl = baseUrl
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: this.kind, ...body }),
    })
    if (!response.ok) throw new Error('AI 서비스에 연결하지 못했어요.')
    return response.json() as Promise<T>
  }

  analyzeDrawing(imageDataUrl: string) {
    return this.post<DrawingAnalysis>('/ai/analyze', { imageDataUrl })
  }

  respondToChild(context: ChildResponseContext) {
    return this.post<AIResponse>('/ai/respond', { context })
  }

  summarizeCreativeMemory(memory: CreativeMemory) {
    return this.post<CreativeMemory>('/ai/memory', { memory })
  }
}

class RemoteImageProvider implements ImageProvider {
  private readonly kind: Exclude<ProviderKind, 'mock'>
  private readonly baseUrl: string

  constructor(kind: Exclude<ProviderKind, 'mock'>, baseUrl: string) {
    this.kind = kind
    this.baseUrl = baseUrl
  }

  private async post(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: this.kind, ...body }),
    })
    if (!response.ok) throw new Error('이미지를 만드는 중 문제가 생겼어요.')
    const data = (await response.json()) as { imageUrl: string }
    return data.imageUrl
  }

  generateFromDrawing(input: GenerateImageInput) {
    return this.post('/images/generate', { ...input })
  }

  editImage(input: EditImageInput) {
    return this.post('/images/edit', { ...input })
  }
}

const kind = (import.meta.env.VITE_AI_PROVIDER || 'mock') as ProviderKind
const apiBase = import.meta.env.VITE_AI_API_BASE || '/api'

export const aiProvider: AIProvider =
  kind === 'mock' ? new MockAIProvider() : new RemoteAIProvider(kind, apiBase)

export const imageProvider: ImageProvider =
  kind === 'mock' ? new MockImageProvider() : new RemoteImageProvider(kind, apiBase)

export type { AIProvider, ImageProvider } from './types'
