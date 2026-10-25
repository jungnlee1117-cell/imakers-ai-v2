import type { SkillEvent, SkillId } from './types.js'

export function skillStage(count: number): '새싹' | '나무' | '숲' {
  if (count >= 10) return '숲'
  if (count >= 5) return '나무'
  return '새싹'
}

export function mergeSkillEvents(existing: string[], events: SkillEvent[], skillId: SkillId) {
  const seen = new Set(existing)
  const added: string[] = []
  const all = [...existing]
  for (const event of events) {
    if (event.skill_id !== skillId) continue
    const expression = event.expression.trim()
    if (!expression || seen.has(expression)) continue
    seen.add(expression)
    all.push(expression)
    added.push(expression)
  }
  return { all, added }
}
