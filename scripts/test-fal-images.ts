import { mkdir, writeFile } from 'node:fs/promises'
import type { CreativeMemory } from '../server/contracts.js'

interface ImageAsset {
  imageUrl: string
  imageId: string
  provider: string
  isMock: boolean
  model: string
  latency_ms: number
  debug: {
    keep: string[]
    change: string[]
    previousImageId?: string
  }
}

const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:43128/api'
const outputDirectory = process.env.TEST_OUTPUT_DIR || '/tmp/fal-real-image-test'
const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg=='

const baseMemory: CreativeMemory = {
  mainSubject: 'a friendly round pink pig',
  confirmedFacts: ['the pig is on a forest path', 'the pig is wearing a clearly visible red backpack', 'the pig is holding a clearly visible wrapped gift for a friend'],
  rejectedIdeas: [],
  supersededIdeas: [],
  childPreferences: ['a polished children’s storybook illustration with a clear main character and props'],
  mood: 'bright daytime with a warm and cheerful atmosphere',
  askedQuestions: [],
  behaviors: [],
  movementIdeas: [],
  worldRules: [],
  understoodInputs: [],
  questionFocuses: [],
  sceneDescription: 'a lush forest path surrounded by trees, flowers, and grass',
  characterDescription: 'a friendly round pink pig wearing a red backpack and holding a wrapped gift for a friend',
  childRequestedAdditions: ['forest', 'red backpack', 'wrapped gift for a friend'],
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`)
  return payload as ImageAsset
}

async function saveImage(asset: ImageAsset, fileName: string) {
  const response = await fetch(asset.imageUrl)
  if (!response.ok) throw new Error(`Image download failed (${response.status})`)
  const filePath = `${outputDirectory}/${fileName}`
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()))
  return filePath
}

async function main() {
  await mkdir(outputDirectory, { recursive: true })

  const generated = await post('/generate-image', {
    provider: 'fal',
    drawingDataUrl: transparentPixel,
    memory: baseMemory,
  })
  const nightMemory = { ...baseMemory, mood: 'a gentle magical nighttime atmosphere' }
  const night = await post('/edit-image', {
    provider: 'fal',
    drawingDataUrl: generated.imageUrl,
    previousImageId: generated.imageId,
    request: '밤으로 바꿔줘',
    memory: nightMemory,
  })
  const largerPig = await post('/edit-image', {
    provider: 'fal',
    drawingDataUrl: night.imageUrl,
    previousImageId: night.imageId,
    request: '돼지를 더 크게 해줘',
    memory: nightMemory,
  })

  const assets = [
    { step: '01-generated', asset: generated, file: await saveImage(generated, '01-generated.png') },
    { step: '02-night', asset: night, file: await saveImage(night, '02-night.png') },
    { step: '03-larger-pig', asset: largerPig, file: await saveImage(largerPig, '03-larger-pig.png') },
  ]

  const ids = assets.map(({ asset }) => asset.imageId)
  const urls = assets.map(({ asset }) => asset.imageUrl)
  if (assets.some(({ asset }) => asset.provider !== 'fal' || asset.isMock)) {
    throw new Error('A response was not a real FAL asset.')
  }
  if (new Set(ids).size !== assets.length || new Set(urls).size !== assets.length) {
    throw new Error('Each step must produce a unique image ID and URL.')
  }
  if (night.debug.previousImageId !== generated.imageId || largerPig.debug.previousImageId !== night.imageId) {
    throw new Error('The edit asset chain is broken.')
  }

  console.log(JSON.stringify(assets.map(({ step, asset, file }) => ({
    step,
    file,
    imageId: asset.imageId,
    imageUrl: asset.imageUrl,
    provider: asset.provider,
    isMock: asset.isMock,
    model: asset.model,
    latency_ms: asset.latency_ms,
    keep: asset.debug.keep,
    change: asset.debug.change,
    previousImageId: asset.debug.previousImageId || null,
  })), null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
