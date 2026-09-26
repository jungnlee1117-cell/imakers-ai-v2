import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { AnthropicAdapter } from '../server/providers/anthropic.js'
import { OpenAIAdapter } from '../server/providers/openai.js'
import type { CloudAIProvider, CoachResponse } from '../server/contracts.js'
import { providerScenarios } from './provider-scenarios.js'

interface ScenarioResult {
  scenario: string
  provider: string
  model?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  estimatedCostUsd?: number
  checks?: {
    atMostOneQuestion: boolean
    noExactRepeatedQuestion: boolean
    rejectionCaptured: boolean | null
  }
  response?: CoachResponse
  error?: string
}

const providers: CloudAIProvider[] = []
if (process.env.OPENAI_API_KEY) providers.push(new OpenAIAdapter(process.env.OPENAI_API_KEY))
if (process.env.ANTHROPIC_API_KEY) providers.push(new AnthropicAdapter(process.env.ANTHROPIC_API_KEY))

if (!providers.length) {
  console.log('비교 테스트를 건너뜁니다: OPENAI_API_KEY와 ANTHROPIC_API_KEY 중 설정된 키가 없습니다.')
  process.exit(0)
}

function normalized(value: string) {
  return value.replace(/[\s?!.,'"]/g, '').toLowerCase()
}

function estimatedCost(provider: string, inputTokens = 0, outputTokens = 0) {
  const inputRate = Number(process.env[provider === 'openai' ? 'OPENAI_INPUT_USD_PER_MTOK' : 'ANTHROPIC_INPUT_USD_PER_MTOK'] || (provider === 'openai' ? 0.4 : 3))
  const outputRate = Number(process.env[provider === 'openai' ? 'OPENAI_OUTPUT_USD_PER_MTOK' : 'ANTHROPIC_OUTPUT_USD_PER_MTOK'] || (provider === 'openai' ? 1.6 : 15))
  return Number(((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000).toFixed(6))
}

const results: ScenarioResult[] = []

for (const scenario of providerScenarios) {
  for (const provider of providers) {
    try {
      const result = await provider.respondToChild(scenario.input)
      const questionCount = (result.data.question.match(/\?/g) || []).length
      const repeated = scenario.input.memory.askedQuestions.some(
        (question) => normalized(question) === normalized(result.data.question),
      )
      const isRejectionScenario = scenario.id === 'reject-suggestion'
      const rejectionCaptured = isRejectionScenario
        ? result.data.memory_updates.rejected_ideas.some((idea) => idea.includes('날개'))
        : null
      results.push({
        scenario: scenario.id,
        provider: provider.name,
        model: result.model,
        latencyMs: result.latencyMs,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        estimatedCostUsd: estimatedCost(provider.name, result.usage?.inputTokens, result.usage?.outputTokens),
        checks: {
          atMostOneQuestion: questionCount <= 1,
          noExactRepeatedQuestion: !repeated,
          rejectionCaptured,
        },
        response: result.data,
      })
      console.log(`✓ ${provider.name.padEnd(9)} ${scenario.title} (${result.latencyMs}ms)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ scenario: scenario.id, provider: provider.name, error: message })
      console.error(`✗ ${provider.name.padEnd(9)} ${scenario.title}: ${message}`)
    }
  }
}

await writeFile(
  new URL('../provider-comparison-results.json', import.meta.url),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
)

const failed = results.filter((result) => result.error).length
console.log(`\n${results.length}개 실행, ${failed}개 실패. provider-comparison-results.json에 저장했습니다.`)
