import 'dotenv/config'
import express from 'express'
import { z } from 'zod'
import {
  childIntentSchema,
  creativeMemorySchema,
  drawingAnalysisSchema,
  providerKindSchema,
  UnsupportedCapabilityError,
} from './contracts.js'
import { getCloudProvider } from './providers/index.js'
import { buildImagePlan, createGeneratedImageId } from './imagePlan.js'

const app = express()
const port = Number(process.env.API_PORT || 43128)

app.use(express.json({ limit: '30mb' }))

const providerRequestSchema = z.object({
  provider: providerKindSchema.exclude(['mock']),
})

const analyzeRequestSchema = providerRequestSchema.extend({
  imageDataUrl: z.string().startsWith('data:image/'),
})

const respondRequestSchema = providerRequestSchema.extend({
  context: z.object({
    childMessage: z.string().min(1).max(1000),
    rawChildInput: z.string().min(1).max(1000),
    normalizedChildInput: z.string().min(1).max(1000),
    inputUnderstanding: z.object({
      raw: z.string(),
      normalized: z.string(),
      meaning: z.string(),
      intent: childIntentSchema,
      confidence: z.enum(['high', 'medium', 'low']),
      needsClarification: z.boolean(),
    }),
    memory: creativeMemorySchema,
    turnCount: z.number().int().nonnegative(),
    drawingAnalysis: drawingAnalysisSchema,
    conversationHistory: z.array(z.object({
      speaker: z.enum(['ai', 'child']),
      text: z.string(),
    })).max(50),
    previousAIQuestion: z.string(),
    previousQuestions: z.array(z.string()),
  }),
})

const memoryRequestSchema = providerRequestSchema.extend({
  memory: creativeMemorySchema,
})

const imageMemoryRequestSchema = providerRequestSchema.extend({
  memory: creativeMemorySchema,
})

const generateImageRequestSchema = imageMemoryRequestSchema.extend({
  drawingDataUrl: z.string().startsWith('data:image/'),
})

const editImageRequestSchema = imageMemoryRequestSchema.extend({
  drawingDataUrl: z.string().refine(
    (value) => value.startsWith('data:image/') || /^https:\/\//.test(value),
    '편집할 이미지는 data URL 또는 HTTPS URL이어야 합니다.',
  ),
  request: z.string().min(1).max(1000),
  previousImageId: z.string().min(1),
})

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function questionSimilarity(left: string, right: string) {
  const tokens = (value: string) => new Set(value.replace(/[?!.,]/g, '').split(/\s+/).filter((word) => word.length > 1))
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((token) => b.has(token)).length
  return intersection / Math.max(a.size, b.size)
}

function hasMechanicalUnderstanding(parts: string[]) {
  return /(?:라는|이라고)\s*뜻으로 이해했어/.test(parts.join(' '))
}

function normalizeQuestionFocus(focus: string, question: string) {
  const aliases: Record<string, string> = {
    reason: 'goal',
    ability: 'action',
    event: 'action',
    'world-detail': 'place',
    reaction: 'emotion',
  }
  const normalized = aliases[focus] || focus
  const taxonomy = new Set([
    'identity', 'color', 'place', 'action', 'emotion', 'relationship',
    'object', 'goal', 'problem', 'change', 'consent',
  ])
  if (taxonomy.has(normalized)) return normalized
  if (/색/.test(question)) return 'color'
  if (/누구를\s*만나|친구|함께/.test(question)) return 'relationship'
  if (/누구|이름/.test(question)) return 'identity'
  if (/어디|장소|곳/.test(question)) return 'place'
  if (/무엇을?\s*(?:들|가져)|뭘\s*(?:들|가져)/.test(question)) return 'object'
  if (/기분|마음|느낌|표정/.test(question)) return 'emotion'
  if (/문제|어려|곤란/.test(question)) return 'problem'
  if (/왜|목표|하려|하고 싶/.test(question)) return 'goal'
  if (/바뀌|달라|변하|추가|빼/.test(question)) return 'change'
  if (/뭐\s*하|무엇을\s*하|어떻게|움직|가(?:는|고)/.test(question)) return 'action'
  return ''
}

app.get('/api/providers', (_request, response) => {
  response.json({
    openai: { configured: Boolean(process.env.OPENAI_API_KEY) },
    anthropic: { configured: Boolean(process.env.ANTHROPIC_API_KEY) },
    fal: { configured: Boolean(process.env.FAL_KEY) },
    mock: { configured: true },
  })
})

app.post('/api/analyze-drawing', async (request, response, next) => {
  try {
    const body = analyzeRequestSchema.parse(request.body)
    const result = await getCloudProvider(body.provider).analyzeDrawing(body.imageDataUrl)
    response.json({ ...result.data, provider: body.provider, model: result.model, latency_ms: result.latencyMs })
  } catch (error) {
    next(error)
  }
})

app.post('/api/respond-to-child', async (request, response, next) => {
  try {
    const body = respondRequestSchema.parse(request.body)
    const intent = body.context.inputUnderstanding.intent
    if (intent === 'SOCIAL' || intent === 'META_FEEDBACK') {
      const reaction = intent === 'SOCIAL'
        ? '나도 같이 만들어서 재밌었어 😊'
        : '맞아, 방금 대화가 조금 어색했네. 같은 말을 반복하지 않고 자연스럽게 이어가볼게.'
      response.json({
        reaction,
        connection: '',
        suggestion: '',
        question: '',
        memory: body.context.memory,
        ready_to_visualize: false,
        provider: 'intent-rules',
        model: 'local-intent-rules',
        latency_ms: 0,
      })
      return
    }
    const provider = getCloudProvider(body.provider)
    let result = await provider.respondToChild(body.context)
    const similarQuestion = body.context.previousQuestions.find(
      (question) => result.data.question && questionSimilarity(question, result.data.question) >= .55,
    )
    const mechanicalResponse = hasMechanicalUnderstanding([
      result.data.reaction,
      result.data.connection,
      result.data.suggestion,
      result.data.question,
    ])
    const recentFocuses = body.context.memory.questionFocuses.slice(-3)
    const initialFocus = normalizeQuestionFocus(result.data.question_focus, result.data.question)
    const repeatedFocus = Boolean(result.data.question && initialFocus && recentFocuses.includes(initialFocus))
    if (similarQuestion || mechanicalResponse || repeatedFocus) {
      const instructions = [
        similarQuestion
          ? `새 질문 "${result.data.question}"은 이전 질문 "${similarQuestion}"과 너무 비슷하므로 생략하거나 실제 문맥에 필요한 전혀 다른 방향으로 바꿔라.`
          : '',
        mechanicalResponse
          ? '"~라는 뜻으로 이해했어", "~이라고 이해했어" 같은 내부 해석 문구를 제거하고 직전 대화에 자연스럽게 반응하라.'
          : '',
        repeatedFocus
          ? `질문 focus "${initialFocus}"는 최근 3개 focus ${JSON.stringify(recentFocuses)}와 겹친다. 질문을 생략하거나 실제 문맥에 필요한 다른 focus로 바꿔라.`
          : '',
      ].filter(Boolean).join(' ')
      result = await provider.respondToChild({
        ...body.context,
        retryInstruction: instructions,
      })
    }
    const responseFocus = normalizeQuestionFocus(result.data.question_focus, result.data.question)
    const focusStillRepeated = Boolean(responseFocus && recentFocuses.includes(responseFocus))
    const responseQuestion = intent === 'ANSWER' || focusStillRepeated ? '' : result.data.question
    const updates = result.data.memory_updates
    const previous = body.context.memory
    const memory = {
      mainSubject: updates.main_subject || previous.mainSubject,
      confirmedFacts: unique([...previous.confirmedFacts, ...updates.confirmed_facts]),
      rejectedIdeas: unique([...previous.rejectedIdeas, ...updates.rejected_ideas]),
      childPreferences: unique([...previous.childPreferences, ...updates.preferences]),
      mood: updates.mood || previous.mood,
      askedQuestions: unique([...previous.askedQuestions, responseQuestion]),
      behaviors: unique([...previous.behaviors, ...updates.behaviors]),
      movementIdeas: unique([...previous.movementIdeas, ...updates.movement_ideas]),
      worldRules: unique([...previous.worldRules, ...updates.world_rules]),
      understoodInputs: [...previous.understoodInputs, {
        ...body.context.inputUnderstanding,
      }],
      questionFocuses: responseQuestion && responseFocus
        ? [...previous.questionFocuses, responseFocus].slice(-10)
        : previous.questionFocuses,
      sceneDescription: updates.scene_description || previous.sceneDescription,
      characterDescription: updates.character_description || previous.characterDescription,
      childRequestedAdditions: unique([...previous.childRequestedAdditions, ...updates.child_requested_additions]),
    }
    response.json({
      reaction: result.data.reaction,
      connection: result.data.connection,
      suggestion: result.data.suggestion,
      question: responseQuestion,
      memory_updates: result.data.memory_updates,
      memory,
      ready_to_visualize: result.data.ready_to_visualize,
      provider: body.provider,
      model: result.model,
      latency_ms: result.latencyMs,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/summarize-memory', async (request, response, next) => {
  try {
    const body = memoryRequestSchema.parse(request.body)
    const result = await getCloudProvider(body.provider).summarizeMemory(body.memory)
    response.json({ memory: result.data, provider: body.provider, model: result.model, latency_ms: result.latencyMs })
  } catch (error) {
    next(error)
  }
})

app.post('/api/generate-image', async (request, response, next) => {
  try {
    const body = generateImageRequestSchema.parse(request.body)
    const { keep, change, generationPrompt } = buildImagePlan(body.memory)
    const result = await getCloudProvider(body.provider).generateImage({ ...body, generationPrompt, keep, change })
    response.json({
      imageUrl: result.data,
      imageId: createGeneratedImageId(body.provider),
      provider: body.provider,
      isMock: false,
      model: result.model,
      latency_ms: result.latencyMs,
      debug: { generationRequest: result.generationPrompt || generationPrompt, keep, change },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/edit-image', async (request, response, next) => {
  try {
    const body = editImageRequestSchema.parse(request.body)
    const { keep, change, generationPrompt } = buildImagePlan(body.memory, body.request)
    const result = await getCloudProvider(body.provider).editImage({ ...body, generationPrompt, keep, change })
    response.json({
      imageUrl: result.data,
      imageId: createGeneratedImageId(body.provider),
      provider: body.provider,
      isMock: false,
      model: result.model,
      latency_ms: result.latencyMs,
      debug: {
        generationRequest: result.generationPrompt || generationPrompt,
        keep,
        change,
        previousImageId: body.previousImageId,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = error instanceof UnsupportedCapabilityError ? 501
    : error instanceof z.ZodError ? 400
      : error instanceof Error && error.message.includes('설정되지 않았습니다') ? 503
        : 500
  const message = error instanceof Error ? error.message : '서버에서 요청을 처리하지 못했습니다.'
  if (status === 500) console.error(error)
  response.status(status).json({ error: message })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`iMakers AI API listening on http://0.0.0.0:${port}`)
})
