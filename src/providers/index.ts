import { MockAIProvider, MockImageProvider } from './mock'
import type {
  AIProvider,
  AIResponse,
  ChildResponseContext,
  EditImageInput,
  GenerateImageInput,
  ImageProvider,
  ProviderKind,
  GeneratedImageAsset,
} from './types'
import type { CreativeMemory, DrawingAnalysis } from '../types/creative'

interface StructuredCoachResponse {
  reaction: string
  connection: string
  suggestion: string
  question: string
  memory: CreativeMemory
  ready_to_visualize: boolean
  provider?: string
  model?: string
}

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
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: '' })) as { error?: string }
      throw new Error(data.error || 'AI 서비스에 연결하지 못했어요.')
    }
    return response.json() as Promise<T>
  }

  analyzeDrawing(imageDataUrl: string) {
    return this.post<DrawingAnalysis>('/analyze-drawing', { imageDataUrl })
  }

  async respondToChild(context: ChildResponseContext): Promise<AIResponse> {
    const data = await this.post<StructuredCoachResponse>('/respond-to-child', { context })
    const pieces = [data.reaction, data.connection, data.suggestion, data.question].filter(Boolean)
    return {
      ...data,
      text: pieces.join(' '),
      elements: [
        ...(data.reaction ? ['REACT' as const] : []),
        ...(data.connection ? ['CONNECT' as const] : []),
        ...(data.suggestion ? ['SUGGEST' as const] : []),
        ...(data.question ? ['EXPAND' as const] : []),
      ],
      readyToVisualize: data.ready_to_visualize,
      debug: {
        responseSource: data.provider || this.kind,
        model: data.model,
      },
    }
  }

  async summarizeCreativeMemory(memory: CreativeMemory) {
    const data = await this.post<{ memory: CreativeMemory }>('/summarize-memory', { memory })
    return data.memory
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
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: '' })) as { error?: string }
      throw new Error(data.error || '이미지를 만드는 중 문제가 생겼어요.')
    }
    return response.json() as Promise<GeneratedImageAsset>
  }

  generateFromDrawing(input: GenerateImageInput) {
    return this.post('/generate-image', { ...input })
  }

  editImage(input: EditImageInput) {
    return this.post('/edit-image', {
      drawingDataUrl: input.sourceImageUrl,
      previousImageId: input.previousImageId,
      request: input.request,
      memory: input.memory,
    })
  }
}

const apiBase = import.meta.env.VITE_AI_API_BASE || '/api'
export type ImageProviderKind = 'mock' | 'openai' | 'fal'

export function createProviderClients(kind: ProviderKind, imageKind: ImageProviderKind): {
  aiProvider: AIProvider
  imageProvider: ImageProvider
} {
  return {
    aiProvider: kind === 'mock' ? new MockAIProvider() : new RemoteAIProvider(kind, apiBase),
    imageProvider: imageKind === 'mock' ? new MockImageProvider() : new RemoteImageProvider(imageKind, apiBase),
  }
}

export type { AIProvider, ImageProvider, ProviderKind } from './types'
