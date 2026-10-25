import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

test('screens do not show scores, ranks, or the unreviewed consent draft', () => {
  const source = files('src').map((path) => readFileSync(path, 'utf8')).join('\n')
  assert.doesNotMatch(source, /점수|순위|leaderboard|인사평가|학부모/)
  assert.doesNotMatch(source, /이용 목적: 업로드한 수업 녹음/)
  assert.match(source, /전문가 검토/)
  assert.doesNotMatch(readFileSync('src/pages/CardPage.tsx', 'utf8'), /localBand|card_example|card_b_auto|process\.py|ffmpeg/)
})
