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

function list(values: string[]) {
  return values.filter(Boolean).join('; ') || 'none'
}

function generationPrompt(input: ImageInput) {
  const memory = input.memory
  return `Create a polished children's storybook illustration from this creative brief.
Main subject: ${memory.mainSubject}.
Character appearance and props: ${memory.characterDescription}.
Scene: ${memory.sceneDescription}.
Required visible facts: ${list(memory.confirmedFacts)}.
Required additions: ${list(memory.childRequestedAdditions)}.
Visual preferences: ${list(memory.childPreferences)}.
Mood and lighting: ${memory.mood}.
Make every required character and prop clearly visible. Do not add captions, letters, code, UI, signatures, or watermarks.`
}

function editPrompt(input: ImageInput) {
  const memory = input.memory
  return `Edit the provided image.
Change only this: ${input.request}.
Keep unchanged: the same ${memory.mainSubject} identity and appearance (${memory.characterDescription}), the scene (${memory.sceneDescription}), existing props, art style, composition, camera angle, and all details unrelated to the requested change.
Required facts that must remain visible: ${list(memory.confirmedFacts)}.
Do not add or alter text, captions, signatures, or watermarks.`
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

  private async run(model: string, prompt: string, input: Record<string, unknown>): Promise<TimedResult<string>> {
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
    return { data: imageUrl, model, latencyMs: elapsed(start), generationPrompt: prompt }
  }

  generateImage(input: ImageInput) {
    const prompt = generationPrompt(input)
    return this.run(this.textToImageModel, prompt, {
      prompt,
      aspect_ratio: '1:1',
      num_images: 1,
      output_format: 'png',
      safety_tolerance: '2',
    })
  }

  editImage(input: ImageInput) {
    const prompt = editPrompt(input)
    return this.run(this.editModel, prompt, {
      prompt,
      image_url: input.drawingDataUrl,
      num_images: 1,
      output_format: 'png',
      safety_tolerance: '2',
    })
  }
}
