import { AnthropicAdapter } from './anthropic.js'
import { FalAdapter } from './fal.js'
import { OpenAIAdapter } from './openai.js'
import type { CloudAIProvider, ProviderKind } from '../contracts.js'

export function getCloudProvider(kind: ProviderKind): CloudAIProvider {
  if (kind === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY가 서버에 설정되지 않았습니다.')
    return new OpenAIAdapter(apiKey)
  }
  if (kind === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다.')
    return new AnthropicAdapter(apiKey)
  }
  if (kind === 'fal') {
    const apiKey = process.env.FAL_KEY
    if (!apiKey) throw new Error('FAL_KEY가 서버에 설정되지 않았습니다.')
    return new FalAdapter(apiKey)
  }
  throw new Error('Mock provider는 브라우저에서 실행됩니다.')
}
