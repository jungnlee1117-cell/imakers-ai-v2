import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  coachResponseSchema,
  drawingAnalysisSchema,
  memorySummarySchema,
  UnsupportedCapabilityError,
  type CloudAIProvider,
  type CreativeMemory,
  type ImageInput,
  type RespondInput,
} from '../contracts.js'
import {
  coachSystemPrompt,
  coachUserPrompt,
  DRAWING_ANALYSIS_PROMPT,
  MEMORY_PROMPT,
} from '../prompts.js'

function elapsed(start: number) {
  return Math.round(performance.now() - start)
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s)
  if (!match) throw new Error('Claude가 지원하는 이미지 형식이 아닙니다.')
  return { mediaType: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: match[2] }
}

export class AnthropicAdapter implements CloudAIProvider {
  readonly name = 'anthropic' as const
  readonly textModel: string
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
    this.textModel = process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-4-20250514'
  }

  private async structured<T>(
    schema: z.ZodType<T>,
    toolName: string,
    description: string,
    system: string,
    content: Anthropic.MessageCreateParams['messages'][number]['content'],
  ): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number } }> {
    const response = await this.client.messages.create({
      model: this.textModel,
      max_tokens: 1200,
      system,
      tools: [{
        name: toolName,
        description,
        input_schema: z.toJSONSchema(schema) as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content }],
    })
    const toolUse = response.content.find((block) => block.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude 응답을 구조화하지 못했습니다.')
    return {
      data: schema.parse(toolUse.input),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }

  async analyzeDrawing(imageDataUrl: string) {
    const start = performance.now()
    const image = parseDataUrl(imageDataUrl)
    const result = await this.structured(
      drawingAnalysisSchema,
      'submit_drawing_analysis',
      '조심스러운 그림 관찰과 첫 질문을 제출합니다.',
      DRAWING_ANALYSIS_PROMPT,
      [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: '이 그림을 조심스럽게 관찰하고 첫 대화를 시작해줘.' },
      ],
    )
    return { data: result.data, model: this.textModel, latencyMs: elapsed(start), usage: result.usage }
  }

  async respondToChild(input: RespondInput) {
    const start = performance.now()
    const result = await this.structured(
      coachResponseSchema,
      'submit_coach_response',
      '어린이에게 보낼 구조화된 코치 응답과 기억 업데이트를 제출합니다.',
      coachSystemPrompt(input.memory),
      coachUserPrompt(input),
    )
    return { data: result.data, model: this.textModel, latencyMs: elapsed(start), usage: result.usage }
  }

  async summarizeMemory(memory: CreativeMemory) {
    const start = performance.now()
    const result = await this.structured(
      memorySummarySchema,
      'submit_creative_memory',
      '중복을 정리한 Creative Memory를 제출합니다.',
      MEMORY_PROMPT,
      JSON.stringify(memory),
    )
    return { data: result.data, model: this.textModel, latencyMs: elapsed(start), usage: result.usage }
  }

  async generateImage(_input: ImageInput): Promise<never> {
    throw new UnsupportedCapabilityError('Anthropic은 이미지 생성 API를 제공하지 않습니다. 대화 비교 후 OpenAI 이미지 provider를 선택하세요.')
  }

  async editImage(_input: ImageInput): Promise<never> {
    throw new UnsupportedCapabilityError('Anthropic은 이미지 편집 API를 제공하지 않습니다. 대화 비교 후 OpenAI 이미지 provider를 선택하세요.')
  }
}
