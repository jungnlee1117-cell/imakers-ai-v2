import type { CreativeMemory } from './contracts.js'
import { imagePrompt } from './prompts.js'

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function buildImagePlan(memory: CreativeMemory, request?: string) {
  const keep = unique([
    memory.mainSubject,
    memory.characterDescription,
    memory.sceneDescription,
    ...memory.confirmedFacts,
    ...memory.childPreferences,
  ])
  const change = request
    ? [request]
    : unique([memory.sceneDescription, memory.mood, ...memory.childRequestedAdditions])
  return {
    generationPrompt: imagePrompt(memory, request),
    keep,
    change,
  }
}

export function createGeneratedImageId(provider = 'openai') {
  return `${provider}-${crypto.randomUUID()}`
}
