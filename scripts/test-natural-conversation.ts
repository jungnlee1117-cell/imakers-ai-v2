import { chromium, type Page } from 'playwright'
import type { CreativeMemory, DrawingAnalysis } from '../server/contracts.js'

const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:43130/api'
const EMPTY_MEMORY: CreativeMemory = {
  mainSubject: '',
  confirmedFacts: [],
  rejectedIdeas: [],
  supersededIdeas: [],
  childPreferences: [],
  mood: '밝고 따뜻한 분위기',
  askedQuestions: [],
  behaviors: [],
  movementIdeas: [],
  worldRules: [],
  understoodInputs: [],
  questionFocuses: [],
  sceneDescription: '',
  characterDescription: '',
  childRequestedAdditions: [],
}

const svgs = {
  pig: `<g fill="none" stroke="#d94764" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="320" cy="245" rx="150" ry="115"/><circle cx="245" cy="175" r="92"/>
    <circle cx="205" cy="140" r="6" fill="#d94764"/><circle cx="275" cy="140" r="6" fill="#d94764"/>
    <ellipse cx="240" cy="200" rx="78" ry="54"/><circle cx="210" cy="200" r="9" fill="#d94764"/><circle cx="270" cy="200" r="9" fill="#d94764"/>
    <path d="M185 112l-24-48 55 25M282 105l35-43 10 60M245 348v65M350 348v65M408 235q70-45 65 20q-4 35-35 8q-22-20 5-38M215 248q28 22 58-2"/>
  </g>`,
  rabbit: `<g fill="none" stroke="#7256b5" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="320" cy="290" rx="115" ry="105"/><circle cx="320" cy="175" r="88"/>
    <ellipse cx="275" cy="68" rx="30" ry="92"/><ellipse cx="365" cy="68" rx="30" ry="92"/>
    <circle cx="290" cy="165" r="6" fill="#7256b5"/><circle cx="350" cy="165" r="6" fill="#7256b5"/>
    <path d="M320 185l-12 12h24zM305 207q15 18 30 0M280 193l-100-18M280 210l-105 20M360 193l100-18M360 210l105 20M260 370l-40 55M380 370l40 55"/>
    <circle cx="430" cy="320" r="42"/>
  </g>`,
  abstract: `<g fill="none" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <path stroke="#298a73" d="M170 330q-70-120 35-185q35-100 115-30q95-75 125 35q90 55 20 165q-50 85-145 35q-95 70-150-20z"/>
    <circle stroke="#cc3d68" cx="240" cy="210" r="30"/><circle stroke="#7c55bd" cx="365" cy="180" r="52"/>
    <path stroke="#e39b25" d="M210 285q45-40 85 8q40 45 98-12M185 170l-65-48M438 180l72-70M205 350l-55 80M385 350l35 90"/>
    <path stroke="#298a73" d="M302 115q10-65 45-80M447 270q85 10 75 65"/>
  </g>`,
}

interface TurnResult {
  child: string
  ai: string
  question: string
  readyToCreate: boolean
  memory: CreativeMemory
  source: string
}

interface ConversationResponse {
  reaction: string
  connection: string
  suggestion: string
  question: string
  memory: CreativeMemory
  ready_to_visualize: boolean
  provider: string
  model: string
}

function inferQuestionFocus(text: string) {
  const question = [...text.split(/(?<=[.!?？])\s*/)].reverse().find((part) => /[?？]/.test(part)) || ''
  if (/색/.test(question)) return 'color'
  if (/누구|친구/.test(question)) return 'relationship'
  if (/어디|곳/.test(question)) return 'place'
  if (/어떻게|뭐\s*하|무엇/.test(question)) return 'action'
  return ''
}

function understand(raw: string, previousAIResponse: string) {
  const normalized = raw.trim().replace(/\s+/g, ' ')
  const intent = /고마워|안녕/.test(normalized)
    ? 'SOCIAL'
    : /^(?:몰라|모르겠어|응|아니)[.!?\s]*$/.test(normalized)
      ? 'ANSWER'
      : /^(?:아니|근데\s*사실)[,\s]+.+/.test(normalized)
        ? 'CREATIVE_CONTENT'
        : previousAIResponse && normalized.length <= 20
          ? 'ANSWER'
          : 'CREATIVE_CONTENT'
  return {
    raw,
    normalized,
    meaning: normalized,
    intent,
    confidence: 'high' as const,
    needsClarification: false,
  }
}

async function render(page: Page, svg: string) {
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#fffdf7"/>${svg}</svg>`)
  const png = await page.screenshot({ type: 'png' })
  return `data:image/png;base64,${png.toString('base64')}`
}

async function post<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', ...body }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`)
  return payload as T
}

async function analyze(imageDataUrl: string) {
  return post<DrawingAnalysis>('/analyze-drawing', { imageDataUrl })
}

async function runScript(imageDataUrl: string, analysis: DrawingAnalysis, childLines: string[]) {
  let memory = structuredClone(EMPTY_MEMORY)
  let readyToCreate = false
  const history: Array<{ speaker: 'ai' | 'child'; text: string }> = [
    { speaker: 'ai', text: analysis.openingMessage },
  ]
  const turns: TurnResult[] = []

  for (const childMessage of childLines) {
    const previousAIResponse = [...history].reverse().find((turn) => turn.speaker === 'ai')?.text || ''
    const previousFocus = inferQuestionFocus(previousAIResponse)
    if (previousFocus && memory.questionFocuses.at(-1) !== previousFocus) {
      memory = { ...memory, questionFocuses: [...memory.questionFocuses, previousFocus].slice(-10) }
    }
    const understanding = understand(childMessage, previousAIResponse)
    const payload: ConversationResponse = await post<ConversationResponse>('/respond-to-child', {
      context: {
        childMessage,
        drawingImageDataUrl: imageDataUrl,
        creationState: readyToCreate ? 'ready-to-create' : 'exploring',
        rawChildInput: childMessage,
        normalizedChildInput: understanding.normalized,
        inputUnderstanding: understanding,
        memory,
        turnCount: history.filter((turn) => turn.speaker === 'child').length,
        drawingAnalysis: analysis,
        conversationHistory: history,
        previousAIQuestion: previousAIResponse,
        previousQuestions: memory.askedQuestions,
      },
    })
    const ai = [payload.reaction, payload.connection, payload.suggestion, payload.question].filter(Boolean).join(' ')
    memory = payload.memory
    readyToCreate = payload.ready_to_visualize
    history.push({ speaker: 'child', text: childMessage }, { speaker: 'ai', text: ai })
    turns.push({
      child: childMessage,
      ai,
      question: payload.question,
      readyToCreate,
      memory: structuredClone(memory),
      source: `${payload.provider}:${payload.model}`,
    })
  }
  return turns
}

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 640, height: 480 } })

try {
  const pigImage = await render(page, svgs.pig)
  const pigAnalysis = await analyze(pigImage)
  const rabbitImage = await render(page, svgs.rabbit)
  const rabbitAnalysis = await analyze(rabbitImage)
  const abstractImage = await render(page, svgs.abstract)
  const abstractAnalysis = await analyze(abstractImage)

  const result = {
    scriptA: {
      opening: pigAnalysis.openingMessage,
      turns: await runScript(pigImage, pigAnalysis, [
        '친구 만나러 가.',
        '선물 있어.',
        '케이크.',
        '아니, 우주로 갈래.',
        '몰라.',
        '고마워.',
      ]),
    },
    scriptB: {
      opening: rabbitAnalysis.openingMessage,
      turns: await runScript(rabbitImage, rabbitAnalysis, [
        '얘 화났어.',
        '친구가 당근 먹었어.',
        '근데 사실 웃고 있어.',
      ]),
    },
    scriptC: {
      opening: abstractAnalysis.openingMessage,
      subjects: abstractAnalysis.likelySubjects,
      uncertainties: abstractAnalysis.uncertainties,
      turns: await runScript(abstractImage, abstractAnalysis, ['얘는 아직 이름 없어.']),
    },
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
