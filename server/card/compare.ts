import type { CardDocument } from './types.js'

export type ChangeBucket = 'improved' | 'weakened' | 'similar'

export type ChangeItem = {
  id: string
  label: string
  before: number
  after: number
  unit: string
  bucket: ChangeBucket
  bucketLabel: '좋아졌어요' | '약해졌어요' | '비슷해요'
}

const labels = {
  improved: '좋아졌어요',
  weakened: '약해졌어요',
  similar: '비슷해요',
} as const

export function compareCards(current: CardDocument, previous: CardDocument) {
  const notes: string[] = []
  if (current.lesson.class_name !== previous.lesson.class_name) {
    notes.push('반이 달라 비교 신뢰도가 낮습니다.')
  }
  if (current.lesson.sport !== previous.lesson.sport) {
    notes.push('종목이 달라 비교 신뢰도가 낮습니다.')
  }
  const currentLabels = current.flow.segments.map((segment) => segment.label).join('\n')
  const previousLabels = previous.flow.segments.map((segment) => segment.label).join('\n')
  if (currentLabels !== previousLabels) {
    notes.push('활동이 달라 비교 신뢰도가 낮습니다.')
  }

  const previousById = new Map(previous.metrics.map((metric) => [metric.id, metric]))
  const items: ChangeItem[] = []
  for (const metric of current.metrics) {
    if (!metric.compare) continue
    const before = previousById.get(metric.id)
    if (!before?.compare) continue
    const delta = metric.value - before.value
    let bucket: ChangeBucket = 'similar'
    if (Math.abs(delta) > metric.tolerance) {
      const increased = delta > 0
      const improved = metric.better === 'up' ? increased : !increased
      bucket = improved ? 'improved' : 'weakened'
    }
    items.push({
      id: metric.id,
      label: metric.label,
      before: before.value,
      after: metric.value,
      unit: metric.unit,
      bucket,
      bucketLabel: labels[bucket],
    })
  }
  return { notes, items }
}
