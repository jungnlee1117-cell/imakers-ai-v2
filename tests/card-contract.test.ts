import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { localBandProcessor } from '../server/card/band.js'
import { compareCards } from '../server/card/compare.js'
import { getLessonProcessor, setLessonProcessorForTests } from '../server/card/processor.js'
import { mergeSkillEvents, skillStage } from '../server/card/skills.js'
import type { CardDocument } from '../server/card/types.js'
import { assertValidCard } from '../server/card/validate.js'

const example = JSON.parse(readFileSync(new URL('../contracts/card_example_B.json', import.meta.url), 'utf8')) as CardDocument
const processSchema = readFileSync(new URL('../process/card_schema.json', import.meta.url), 'utf8')
const contractSchema = readFileSync(new URL('../contracts/card_schema.json', import.meta.url), 'utf8')

test('the published example satisfies the card schema', () => {
  assert.equal(processSchema, contractSchema)
  assertValidCard(example)
  assertValidCard(JSON.parse(readFileSync(new URL('../process/card_b_auto.json', import.meta.url), 'utf8')))
})

test('the local band returns one schema-valid card and does not send audio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'band-'))
  const audioPath = join(dir, 'audio.m4a')
  await writeFile(audioPath, Buffer.from('not-read'))
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error('network')
  }
  try {
    const output = await localBandProcessor.process({
      audioPath,
      sport: 'soccer',
      languageMode: 'english',
      planText: null,
      lessonDate: '2026-10-25',
      className: '해바라기반',
      source: 'audio',
    })
    assertValidCard(output.card)
    assert.equal(output.card.lesson.class_name, '해바라기반')
    assert.equal(output.card.lesson.date, '2026-10-25')
    assert.equal(output.card.lesson.language_mode, 'english')
    assert.deepEqual(output.card.plan_adherence, { status: 'not_linked' })
    assert.equal(output.card.schema_version, '1.0')
    assert.equal(output.card.lesson.duration_sec, 1527)
    assert.equal(output.card.metrics.find((metric) => metric.id === 'praise')?.value, 4)
    assert.equal(output.card.metrics.find((metric) => metric.id === 'rule')?.label, '규칙을 질문으로 물은 횟수')
    assert.ok(output.transcript_lines.length > 100)
    assert.deepEqual(Object.keys(output.transcript_lines[0] ?? {}).sort(), ['start_sec', 'text', 'trusted'])
    const packed = JSON.stringify(output)
    assert.doesNotMatch(packed, /not-read/)
    assert.doesNotMatch(packed, /\b(Haru|Jian|Lucas|Sienna|Sheer|John)\b/)
    assert.match(packed, /\[아이\]/)
    assert.ok(output.transcript_lines.some((line) => line.trusted === false))
    assert.ok(output.card.english_phrases)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('english phrases are omitted unless the language mode is english, and a plan is only linked when text exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'band-'))
  const audioPath = join(dir, 'audio.m4a')
  await writeFile(audioPath, Buffer.from('x'))
  const korean = await localBandProcessor.process({
    audioPath,
    sport: 'jumprope',
    languageMode: 'korean',
    planText: '1. Greeting circle\n2. Picture talk',
    lessonDate: '2026-10-01',
    className: 'A',
    source: 'video',
  })
  assertValidCard(korean.card)
  assert.equal('english_phrases' in korean.card, false)
  assert.equal(korean.card.plan_adherence?.status, 'done')
  if (korean.card.plan_adherence?.status === 'done') {
    assert.deepEqual(korean.card.plan_adherence.planned, ['Greeting circle', 'Picture talk'])
    assert.deepEqual(korean.card.plan_adherence.actual, [])
  }
})

test('comparison uses each metric tolerance and skips compare false', () => {
  const current = structuredClone(example)
  const previous = structuredClone(example)
  previous.lesson.class_name = '다른 반'
  previous.metrics = previous.metrics.map((metric) => {
    if (metric.id === 'move') return { ...metric, value: 60 }
    if (metric.id === 'praise') return { ...metric, value: 4 }
    if (metric.id === 'gr') return { ...metric, value: 2 }
    return metric
  })
  const result = compareCards(current, previous)
  const byId = new Map(result.items.map((item) => [item.id, item.bucketLabel]))
  assert.equal(byId.get('move'), '비슷해요')
  assert.equal(byId.get('praise'), '좋아졌어요')
  assert.equal(byId.get('gr'), '좋아졌어요')
  assert.equal(byId.has('wait'), false)
  assert.ok(result.notes.some((note) => note.includes('반이 달라')))
})

test('accumulated expressions never shrink and stages follow the contract counts', () => {
  const first = mergeSkillEvents([], [{ skill_id: 'praise', expression: 'Excellent!', at_sec: 1 }], 'praise')
  const second = mergeSkillEvents(first.all, [{ skill_id: 'praise', expression: 'Excellent!', at_sec: 2 }], 'praise')
  assert.deepEqual(second.all, ['Excellent!'])
  assert.deepEqual(second.added, [])
  assert.equal(skillStage(0), '새싹')
  assert.equal(skillStage(4), '새싹')
  assert.equal(skillStage(5), '나무')
  assert.equal(skillStage(9), '나무')
  assert.equal(skillStage(10), '숲')
})

test('an unknown processor is refused instead of sending audio away', () => {
  const previous = process.env.PROCESSOR_ID
  setLessonProcessorForTests(null)
  process.env.PROCESSOR_ID = 'remote-whisper'
  try {
    assert.throws(() => getLessonProcessor(), /외부로 보내지 않습니다/)
  } finally {
    if (previous === undefined) delete process.env.PROCESSOR_ID
    else process.env.PROCESSOR_ID = previous
  }
})
