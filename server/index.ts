import 'dotenv/config'
import express from 'express'
import { z } from 'zod'
import {
  creativeMemorySchema,
  drawingAnalysisSchema,
  providerKindSchema,
  UnsupportedCapabilityError,
} from './contracts.js'
import { getCloudProvider } from './providers/index.js'

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
    memory: creativeMemorySchema,
    turnCount: z.number().int().nonnegative(),
    drawingAnalysis: drawingAnalysisSchema,
    conversationHistory: z.array(z.object({
      speaker: z.enum(['ai', 'child']),
      text: z.string(),
    })).max(50),
  }),
})

const memoryRequestSchema = providerRequestSchema.extend({
  memory: creativeMemorySchema,
})

const imageRequestSchema = providerRequestSchema.extend({
  drawingDataUrl: z.string().startsWith('data:image/'),
  memory: creativeMemorySchema,
  request: z.string().max(1000).optional(),
})

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

app.get('/api/providers', (_request, response) => {
  response.json({
    openai: { configured: Boolean(process.env.OPENAI_API_KEY) },
    anthropic: { configured: Boolean(process.env.ANTHROPIC_API_KEY) },
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
    const result = await getCloudProvider(body.provider).respondToChild(body.context)
    const updates = result.data.memory_updates
    const previous = body.context.memory
    const memory = {
      mainSubject: updates.main_subject || previous.mainSubject,
      confirmedFacts: unique([...previous.confirmedFacts, ...updates.confirmed_facts]),
      rejectedIdeas: unique([...previous.rejectedIdeas, ...updates.rejected_ideas]),
      childPreferences: unique([...previous.childPreferences, ...updates.preferences]),
      mood: updates.mood || previous.mood,
      askedQuestions: unique([...previous.askedQuestions, result.data.question]),
      behaviors: unique([...previous.behaviors, ...updates.behaviors]),
      movementIdeas: unique([...previous.movementIdeas, ...updates.movement_ideas]),
      worldRules: unique([...previous.worldRules, ...updates.world_rules]),
    }
    response.json({
      reaction: result.data.reaction,
      connection: result.data.connection,
      suggestion: result.data.suggestion,
      question: result.data.question,
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
    const body = imageRequestSchema.parse(request.body)
    const result = await getCloudProvider(body.provider).generateImage(body)
    response.json({ imageUrl: result.data, provider: body.provider, model: result.model, latency_ms: result.latencyMs })
  } catch (error) {
    next(error)
  }
})

app.post('/api/edit-image', async (request, response, next) => {
  try {
    const body = imageRequestSchema.parse(request.body)
    const result = await getCloudProvider(body.provider).editImage(body)
    response.json({ imageUrl: result.data, provider: body.provider, model: result.model, latency_ms: result.latencyMs })
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
