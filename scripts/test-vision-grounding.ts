import { chromium } from 'playwright'

const apiBase = process.env.TEST_API_BASE || 'http://127.0.0.1:43130/api'

const drawings = [
  {
    id: 'pig',
    svg: `<g fill="none" stroke="#d94764" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="320" cy="245" rx="150" ry="115"/><circle cx="245" cy="175" r="92"/>
      <ellipse cx="205" cy="195" rx="58" ry="40"/><circle cx="187" cy="193" r="5" fill="#d94764"/><circle cx="220" cy="193" r="5" fill="#d94764"/>
      <path d="M185 112l-24-48 55 25M282 105l35-43 10 60M185 245q-55 45-15 100M245 348v65M350 348v65M408 235q70-45 65 20q-4 35-35 8q-22-20 5-38"/>
      <circle cx="228" cy="153" r="5" fill="#d94764"/><path d="M230 225q28 22 55-3"/>
    </g>`,
  },
  {
    id: 'rabbit',
    svg: `<g fill="none" stroke="#7256b5" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="320" cy="290" rx="115" ry="105"/><circle cx="320" cy="175" r="88"/>
      <ellipse cx="275" cy="68" rx="30" ry="92"/><ellipse cx="365" cy="68" rx="30" ry="92"/>
      <circle cx="290" cy="165" r="6" fill="#7256b5"/><circle cx="350" cy="165" r="6" fill="#7256b5"/>
      <path d="M320 185l-12 12h24zM305 207q15 18 30 0M280 193l-100-18M280 210l-105 20M360 193l100-18M360 210l105 20M260 370l-40 55M380 370l40 55"/>
      <circle cx="430" cy="320" r="42"/>
    </g>`,
  },
  {
    id: 'car',
    svg: `<g fill="none" stroke="#2376c9" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <path d="M120 285h405v85H92v-52q0-33 28-33z"/><path d="M185 285l65-95h150l82 95"/>
      <path d="M265 205v75M392 205v75"/><circle cx="190" cy="375" r="52"/><circle cx="445" cy="375" r="52"/>
      <circle cx="190" cy="375" r="16"/><circle cx="445" cy="375" r="16"/><path d="M115 318h45M470 318h45"/>
    </g>`,
  },
  {
    id: 'spaceship',
    svg: `<g fill="none" stroke="#e15c2f" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <path d="M320 65q95 100 72 270l-72 78-72-78q-23-170 72-270z"/>
      <circle cx="320" cy="205" r="42"/><circle cx="320" cy="205" r="20"/>
      <path d="M250 285l-105 100 120-25M390 285l105 100-120-25M290 410l30 55 30-55"/>
      <path d="M85 90l12 25 28 4-20 19 5 28-25-13-25 13 5-28-20-19 28-4zM510 105l8 18 20 3-14 14 3 20-17-9-18 9 4-20-15-14 20-3z"/>
    </g>`,
  },
  {
    id: 'abstract-monster',
    svg: `<g fill="none" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
      <path stroke="#298a73" d="M170 330q-70-120 35-185q35-100 115-30q95-75 125 35q90 55 20 165q-50 85-145 35q-95 70-150-20z"/>
      <circle stroke="#cc3d68" cx="240" cy="210" r="30"/><circle stroke="#7c55bd" cx="365" cy="180" r="52"/>
      <path stroke="#e39b25" d="M210 285q45-40 85 8q40 45 98-12M185 170l-65-48M438 180l72-70M205 350l-55 80M385 350l35 90"/>
      <path stroke="#298a73" d="M302 115q10-65 45-80M447 270q85 10 75 65"/>
    </g>`,
  },
]

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
const results = []

try {
  for (const drawing of drawings) {
    await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#fffdf7"/>${drawing.svg}</svg>`)
    const png = await page.screenshot({ type: 'png' })
    const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`
    const response = await fetch(`${apiBase}/analyze-drawing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', imageDataUrl }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(`${drawing.id}: ${JSON.stringify(payload)}`)
    results.push({
      id: drawing.id,
      imageHash: payload.imageHash,
      visionProvider: payload.visionProvider,
      likelySubjects: payload.likelySubjects,
      visualFeatures: payload.visualFeatures,
      expressions: payload.expressions,
      objects: payload.objects,
      scene: payload.scene,
      uncertainties: payload.uncertainties,
      openingMessage: payload.openingMessage,
      latency_ms: payload.latency_ms,
    })
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify(results, null, 2))
