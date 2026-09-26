import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { childInputNormalizer, inferQuestionFocus } from '../src/ai/childInputNormalizer'
import { MotionEntry } from '../src/components/MotionEntry'
import { MockAIProvider } from '../src/providers/mock'
import type { ChildResponseContext } from '../src/providers/types'
import { EMPTY_MEMORY, type CreativeMemory } from '../src/types/creative'
import { buildImagePlan, createGeneratedImageId } from '../server/imagePlan'

const analysis = {
  likelySubjects: [{ label: '둥근 얼굴의 친구', confidence: 0.62 }],
  visualFeatures: ['가운데의 둥근 얼굴', '아래쪽의 동그란 모양'],
  expressions: ['표정은 명확하지 않음'],
  objects: [],
  scene: '배경이 거의 없는 단순한 그림',
  observations: [{ description: '가운데 둥근 얼굴 모양', confidence: 'medium' as const }],
  uncertainties: ['누구의 얼굴인지', '어떤 감정인지'],
  openingMessage: '가운데 둥근 얼굴이 보여. 내가 다르게 봤을 수도 있어. 이 친구는 누구야?',
  imageHash: 'sha256:test-drawing',
  visionProvider: 'test:fixture',
  analysisSource: 'mock' as const,
}

function context(
  raw: string,
  memory: CreativeMemory = structuredClone(EMPTY_MEMORY),
  previousAIQuestion = analysis.openingMessage,
): ChildResponseContext {
  const understanding = childInputNormalizer.normalize(raw, memory, previousAIQuestion)
  return {
    childMessage: raw,
    rawChildInput: raw,
    normalizedChildInput: understanding.normalized,
    inputUnderstanding: understanding,
    memory,
    turnCount: memory.understoodInputs.length,
    drawingAnalysis: analysis,
    conversationHistory: [{ speaker: 'ai', text: previousAIQuestion }],
    previousAIQuestion,
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

test('real flow 1: a short blue answer follows the previous color question naturally', async () => {
  const input = context('파랑색', structuredClone(EMPTY_MEMORY), '어떤 색이면 좋을까?')
  assert.equal(input.inputUnderstanding.intent, 'ANSWER')
  assert.equal(input.inputUnderstanding.normalized, '파란색')

  const response = await new MockAIProvider().respondToChild(input)
  assert.match(response.text, /파란색/)
  assert.doesNotMatch(response.text, /(?:라는|이라고)\s*뜻으로 이해했어/)
  assert.equal(response.question, '')
})

test('real flow 2: thanks is social and does not modify creative memory', async () => {
  const memory = structuredClone(EMPTY_MEMORY)
  memory.mainSubject = '토끼'
  const response = await new MockAIProvider().respondToChild(context('고마워', memory, ''))

  assert.equal(childInputNormalizer.normalize('고마워', memory).intent, 'SOCIAL')
  assert.match(response.text, /같이|재밌|계속/)
  assert.doesNotMatch(response.text, /뜻으로 이해했어/)
  assert.deepEqual(response.memory, memory)
  assert.equal(response.question, '')
})

test('real flow 3: conversation criticism is meta feedback, not story content', async () => {
  const memory = structuredClone(EMPTY_MEMORY)
  memory.mainSubject = '토끼'
  const input = context('대화가 자연스럽지 않아', memory, '이 친구는 누구야?')
  assert.equal(input.inputUnderstanding.intent, 'META_FEEDBACK')
  assert.equal(input.inputUnderstanding.needsClarification, false)

  const response = await new MockAIProvider().respondToChild(input)
  assert.match(response.text, /어색|자연스럽/)
  assert.doesNotMatch(response.text, /친구 이름|대화라는 친구/)
  assert.deepEqual(response.memory, memory)
})

test('real flow 4: a short yellow answer responds in the prior color context', async () => {
  const response = await new MockAIProvider().respondToChild(
    context('노랑색', structuredClone(EMPTY_MEMORY), '어떤 색으로 할까?'),
  )
  assert.match(response.text, /노란색/)
  assert.match(response.text, /밝|따뜻|색/)
  assert.doesNotMatch(response.text, /뜻으로 이해했어/)
  assert.equal(response.question, '')
})

test('short negative answer is not stored as a rejected creative idea', async () => {
  const memory = structuredClone(EMPTY_MEMORY)
  memory.mainSubject = '토끼'
  const response = await new MockAIProvider().respondToChild(
    context('아니', memory, '토끼에게 날개를 달아볼까?'),
  )
  assert.equal(childInputNormalizer.normalize('아니', memory, '토끼에게 날개를 달아볼까?').intent, 'ANSWER')
  assert.deepEqual(response.memory, memory)
  assert.equal(response.question, '')
  assert.doesNotMatch(response.text, /뜻으로 이해했어/)
})

test('question focus uses the last actual question and avoids a recent repeat', async () => {
  assert.equal(inferQuestionFocus('파란색 좋다. 이 돼지는 어디로 가는 중이야?'), 'place')
  const memory = structuredClone(EMPTY_MEMORY)
  memory.questionFocuses = ['color', 'emotion', 'identity']
  const response = await new MockAIProvider().respondToChild(context('민지가 달려', memory, ''))
  assert.equal(response.question, '')
  assert.deepEqual(response.memory.questionFocuses, memory.questionFocuses)
})

test('mock opening messages vary and do not force identity confirmation', async () => {
  const provider = new MockAIProvider()
  const openings = await Promise.all([
    provider.analyzeDrawing('data:image/png;base64,a'),
    provider.analyzeDrawing('data:image/png;base64,a'),
    provider.analyzeDrawing('data:image/png;base64,a'),
  ])
  const messages = openings.map((item) => item.openingMessage)
  assert.equal(new Set(messages).size, 3)
  for (const message of messages) {
    assert.doesNotMatch(message, /내가 다르게 봤을 수도|이 친구는 누구야/)
  }
})

test('visual context is structured and changes with a new image version', async () => {
  const provider = new MockAIProvider()
  const first = await provider.analyzeDrawing('data:image/png;base64,first')
  const second = await provider.analyzeDrawing('data:image/png;base64,second')
  assert.notEqual(first.imageHash, second.imageHash)
  assert.equal(first.analysisSource, 'mock')
  assert.match(first.visionProvider, /mock/)
  assert.ok(first.visualFeatures.length > 0)
  assert.ok(Array.isArray(first.likelySubjects))
  assert.ok(Array.isArray(first.objects))
  assert.ok(Array.isArray(first.uncertainties))
})

test('real flow 5: unreleased motion UI exposes no mock segmentation objects', () => {
  const html = renderToStaticMarkup(createElement(MotionEntry))
  assert.match(html, /움직임 기능 준비 중/)
  assert.doesNotMatch(html, /하늘과 구름|배경의 특별한 곳|대상 번호/)
  assert.doesNotMatch(html, /움직여보기/)
})
