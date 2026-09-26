import {
  UnsupportedCapabilityError,
  type CloudAIProvider,
  type CreativeMemory,
  type ImageInput,
  type RespondInput,
  type TimedResult,
} from '../contracts.js'

const DEFAULT_TEXT_TO_IMAGE_MODEL = 'fal-ai/flux-pro/kontext/text-to-image'
const DEFAULT_EDIT_MODEL = 'fal-ai/flux-pro/kontext'

interface FalImage {
  url: string
  content_type?: string
  width?: number
  height?: number
}

interface FalImageResponse {
  images?: FalImage[]
}

function elapsed(start: number) {
  return Math.round(performance.now() - start)
}

export class FalAdapter implements CloudAIProvider {
  readonly name = 'fal' as const
  readonly textModel = 'unsupported'
  private readonly apiKey: string
  private readonly textToImageModel: string
  private readonly editModel: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
    this.textToImageModel = process.env.FAL_TEXT_TO_IMAGE_MODEL || DEFAULT_TEXT_TO_IMAGE_MODEL
    this.editModel = process.env.FAL_EDIT_MODEL || DEFAULT_EDIT_MODEL
  }

  private unsupported(): never {
    throw new UnsupportedCapabilityError('FAL provider는 이미지 생성과 편집에만 사용됩니다.')
  }

  analyzeDrawing(_imageDataUrl: string) {
    return this.unsupported()
  }

  respondToChild(_input: RespondInput) {
    return this.unsupported()
  }

  summarizeMemory(_memory: CreativeMemory) {
    return this.unsupported()
  }

  private async run(model: string, input: Record<string, unknown>): Promise<TimedResult<string>> {
    const start = performance.now()
    const response = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000),
    })
    const payload = await response.json().catch(() => null) as FalImageResponse | { detail?: string } | null
    if (!response.ok) {
      const detail = payload && 'detail' in payload ? payload.detail : ''
      throw new Error(`FAL 이미지 요청 실패 (${response.status})${detail ? `: ${detail}` : ''}`)
    }
    const imageUrl = payload && 'images' in payload ? payload.images?.[0]?.url : undefined
    if (!imageUrl) throw new Error('FAL 응답에 생성된 이미지가 없습니다.')
    return { data: imageUrl, model, latencyMs: elapsed(start) }
  }

  generateImage(input: ImageInput) {
    return this.run(this.textToImageModel, {
      prompt: input.generationPrompt,
      aspect_ratio: '1:1',
      num_images: 1,
      output_format: 'png',
      safety_tolerance: '2',
    })
  }

  editImage(input: ImageInput) {
    return this.run(this.editModel, {
      prompt: input.generationPrompt,
      image_url: input.drawingDataUrl,
      num_images: 1,
      output_format: 'png',
      safety_tolerance: '2',
    })
  }
}
