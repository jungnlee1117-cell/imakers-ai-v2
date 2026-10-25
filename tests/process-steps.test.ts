import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { processSteps } from '../server/card/process-steps.js'
import { assertValidCard } from '../server/card/validate.js'

test('features and merge call process.py and do not invent a run result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'process-'))
  const transcriptPath = join(dir, 'lesson.txt')
  const metaPath = join(dir, 'meta.json')
  const planPath = join(dir, 'plan.txt')
  const workDir = join(dir, 'work')
  const analysisPath = join(dir, 'analysis.json')
  const cardPath = join(dir, 'card.json')
  await writeFile(transcriptPath, '[0:00] Good job team.\n[0:08] Can you stop? No.\n[0:20] Line up.\n')
  await writeFile(metaPath, JSON.stringify({
    date: '2026-10-25',
    class_name: '테스트',
    sport: 'soccer',
    language_mode: 'english',
    duration_sec: 20,
    source: 'audio',
    teacher_names: ['Rachel'],
  }))
  await writeFile(planPath, 'Greeting circle\n')
  await processSteps.features({ transcriptPath, metaPath, outDir: workDir, planPath })
  const prompt = await readFile(join(workDir, 'prompt.md'), 'utf8')
  assert.match(prompt, /Greeting circle/)
  await writeFile(analysisPath, JSON.stringify({
    flow: { note: '짧은 수업', segments: [{ start_sec: 0, end_sec: 20, label: '정리', kind: 'normal' }] },
    interaction: {
      good: [{ title: '칭찬', at_sec: [0], text: 'Good job.' }],
      improve: [{ title: '짧게', at_sec: [20], text: '한 번에 하나.' }],
    },
    practice: [{ id: 's1', say: 'Line up.', why: '짧게', is_task: false }],
    child_care_expressions: [],
    extra_excluded: [],
    wait_segments: 0,
    question_segments: 0,
    english_phrases: { note: '없음', items: [] },
    area_reviews: [
      {
        area: 'interaction',
        good: [{
          title: '바로 칭찬',
          text: '짧은 칭찬이 있었습니다.',
          evidence: [{ at_sec: 0, quote: 'Good job team' }],
        }],
        improve: [{
          title: '없는 인용',
          text: '전사본에 없는 말입니다.',
          evidence: [{ at_sec: 0, quote: 'purple balloons in the hallway' }],
          example: { say: 'Line up.', why: '짧게' },
        }],
      },
    ],
  }))
  await processSteps.merge({ workDir, analysisPath, outPath: cardPath })
  const card = JSON.parse(await readFile(cardPath, 'utf8')) as { schema_version: string; area_reviews: Array<{ improve: unknown[] }> }
  assertValidCard(card)
  assert.equal(card.schema_version, '1.1')
  assert.equal(card.area_reviews[0]?.improve.length, 0)
  const dropped = JSON.parse(await readFile(`${cardPath}.dropped.json`, 'utf8')) as Array<{ title: string }>
  assert.equal(dropped.some((item) => item.title === '없는 인용'), true)

  const audioPath = join(dir, 'audio.m4a')
  await writeFile(audioPath, Buffer.from('not-sent'))
  await assert.rejects(processSteps.run({ audioPath, metaPath, outDir: join(dir, 'run-out') }))
  await assert.rejects(readFile(join(dir, 'run-out', 'card.json'), 'utf8'))
})
