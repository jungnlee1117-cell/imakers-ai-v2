import assert from 'node:assert/strict'
import test from 'node:test'
import { childInputNormalizer } from '../src/ai/childInputNormalizer'
import { MockAIProvider } from '../src/providers/mock'
import type { ChildResponseContext } from '../src/providers/types'
import { EMPTY_MEMORY, type CreativeMemory } from '../src/types/creative'
import { buildImagePlan, createGeneratedImageId } from '../server/imagePlan'

const analysis = {
  observations: [{ description: '가운데 둥근 얼굴 모양', confidence: 'medium' as const }],
  uncertain: ['누구의 얼굴인지', '어떤 감정인지'],
  openingMessage: '가운데 둥근 얼굴이 보여. 내가 다르게 봤을 수도 있어. 이 친구는 누구야?',
}

function context(raw: string, memory: CreativeMemory = structuredClone(EMPTY_MEMORY)): ChildResponseContext {
  const understanding = childInputNormalizer.normalize(raw, memory)
  return {
    childMessage: raw,
    rawChildInput: raw,
    normalizedChildInput: understanding.normalized,
    inputUnderstanding: understanding,
    memory,
    turnCount: memory.understoodInputs.length,
    drawingAnalysis: analysis,
    conversationHistory: [{ speaker: 'ai', text: analysis.openingMessage }],
    previousAIQuestion: memory.askedQuestions.at(-1) || '',
    previousQuestions: memory.askedQuestions,
  }
}

test('scenario A: typo is normalized and meaning is stored without correction feedback', async () => {
  const input = context('친쿵나테 가는 돼지야')
  assert.equal(input.normalizedChildInput, '친구한테 가는 돼지야')
  assert.equal(input.inputUnderstanding.meaning, '돼지가 친구를 만나러 가는 중')

  const response = await new MockAIProvider().respondToChild(input)
  assert.doesNotMatch(response.text, /친쿵나테/)
  assert.match(response.text, /친구.*만나러/)
  assert.equal(response.memory.understoodInputs[0].normalized, '친구한테 가는 돼지야')
  assert.equal(response.memory.understoodInputs[0].meaning, '돼지가 친구를 만나러 가는 중')
})

test('scenario B: moon ice-cream spaceship gets a project-specific question', async () => {
  const provider = new MockAIProvider()
  const pig = await provider.respondToChild(context('친쿵나테 가는 돼지야'))
  const spaceship = await provider.respondToChild(context('달에서 아이스크림 파는 우주선'))
  assert.match(spaceship.text, /달|아이스크림|우주선/)
  assert.notEqual(spaceship.question, pig.question)
  assert.doesNotMatch(spaceship.text, /특별한 방법|어떤 방법을 떠올렸어|어떤 곳을 지나/)
})

test('scenario C: angry robot stays in emotion and relationship context', async () => {
  const memory = structuredClone(EMPTY_MEMORY)
  memory.mainSubject = '화난 로봇'
  const response = await new MockAIProvider().respondToChild(context('친구가 내 장난감을 가져갔어', memory))
  assert.match(response.text, /속상|화가|마음|친구/)
  assert.doesNotMatch(response.text, /어디|장소|지나/)
})

const imageMemory: CreativeMemory = {
  ...structuredClone(EMPTY_MEMORY),
  mainSubject: '돼지',
  characterDescription: '둥근 얼굴의 돼지가 빨간 가방을 메고 있음',
  sceneDescription: '친구에게 가기 위해 지나가는 초록 숲',
  confirmedFacts: ['친구에게 선물을 주러 감', '빨간 가방을 메고 있음'],
  childRequestedAdditions: ['초록 숲', '빨간 가방'],
}

test('scenario D: generation request contains pig, forest and red bag', () => {
  const plan = buildImagePlan(imageMemory)
  assert.match(plan.generationPrompt, /돼지/)
  assert.match(plan.generationPrompt, /숲/)
  assert.match(plan.generationPrompt, /빨간 가방/)
})

test('scenario E: night edit keeps character and creates a new image id', () => {
  const plan = buildImagePlan(imageMemory, '밤으로 바꿔줘')
  assert.ok(plan.keep.some((item) => item.includes('돼지')))
  assert.deepEqual(plan.change, ['밤으로 바꿔줘'])
  assert.notEqual(createGeneratedImageId(), createGeneratedImageId())
})

test('scenario F: size edit is isolated and version ids cannot be reused', () => {
  const plan = buildImagePlan(imageMemory, '돼지를 크게 해줘')
  assert.deepEqual(plan.change, ['돼지를 크게 해줘'])
  assert.ok(plan.keep.some((item) => item.includes('숲')))
  assert.ok(plan.keep.some((item) => item.includes('빨간 가방')))
  assert.notEqual(createGeneratedImageId(), createGeneratedImageId())
})
