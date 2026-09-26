import OpenAI, { toFile } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  coachResponseSchema,
  drawingAnalysisSchema,
  memorySummarySchema,
  type CloudAIProvider,
  type CreativeMemory,
  type ImageInput,
  type RespondInput,
  type TimedResult,
} from '../contracts.js'
import {
  coachSystemPrompt,
  coachUserPrompt,
  DRAWING_ANALYSIS_PROMPT,
  imagePrompt,
  MEMORY_PROMPT,
} from '../prompts.js'

function elapsed(start: number) {
  return Math.round(performance.now() - start)
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (!match) throw new Error('올바른 이미지 데이터가 아닙니다.')
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') }
}

export class OpenAIAdapter implements CloudAIProvider {
  readonly name = 'openai' as const
  readonly textModel: string
  private readonly imageModel: string
  private readonly client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
    this.textModel = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini'
    this.imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5'
  }

  async analyzeDrawing(imageDataUrl: string) {
    const start = performance.now()
    const response = await this.client.responses.parse({
      model: this.textModel,
      input: [
        { role: 'system', content: DRAWING_ANALYSIS_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '이 그림을 조심스럽게 관찰하고 첫 대화를 시작해줘.' },
            { type: 'input_image', image_url: imageDataUrl, detail: 'auto' },
          ],
        },
      ],
      text: { format: zodTextFormat(drawingAnalysisSchema, 'drawing_analysis') },
    })
    if (!response.output_parsed) throw new Error('그림 관찰 결과를 구조화하지 못했습니다.')
    return {
      data: response.output_parsed,
      model: this.textModel,
      latencyMs: elapsed(start),
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined,
    }
  }

  async respondToChild(input: RespondInput) {
    const start = performance.now()
    const response = await this.client.responses.parse({
      model: this.textModel,
      input: [
        { role: 'system', content: coachSystemPrompt(input.memory) },
        { role: 'user', content: coachUserPrompt(input) },
      ],
      text: { format: zodTextFormat(coachResponseSchema, 'coach_response') },
    })
    if (!response.output_parsed) throw new Error('대화 결과를 구조화하지 못했습니다.')
    return {
      data: response.output_parsed,
      model: this.textModel,
      latencyMs: elapsed(start),
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined,
    }
  }

  async summarizeMemory(memory: CreativeMemory) {
    const start = performance.now()
    const response = await this.client.responses.parse({
      model: this.textModel,
      input: [
        { role: 'system', content: MEMORY_PROMPT },
        { role: 'user', content: JSON.stringify(memory) },
      ],
      text: { format: zodTextFormat(memorySummarySchema, 'creative_memory') },
    })
    if (!response.output_parsed) throw new Error('Creative Memory를 정리하지 못했습니다.')
    return {
      data: response.output_parsed,
      model: this.textModel,
      latencyMs: elapsed(start),
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined,
    }
  }

  private async renderImage(input: ImageInput): Promise<TimedResult<string>> {
    const start = performance.now()
    const { mime, buffer } = parseDataUrl(input.drawingDataUrl)
    const image = await toFile(buffer, 'child-drawing.png', { type: mime })
    const response = await this.client.images.edit({
      model: this.imageModel,
      image,
      prompt: imagePrompt(input.memory, input.request),
      size: '1024x1024',
    })
    const result = response.data?.[0]
    const imageUrl = result?.b64_json
      ? `data:image/png;base64,${result.b64_json}`
      : result?.url
    if (!imageUrl) throw new Error('생성된 이미지가 없습니다.')
    return { data: imageUrl, model: this.imageModel, latencyMs: elapsed(start) }
  }

  generateImage(input: ImageInput) {
    return this.renderImage(input)
  }

  editImage(input: ImageInput) {
    return this.renderImage(input)
  }
}
