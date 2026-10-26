const CHILD_NAMES = ['Haru', 'Jian', 'Lucas', 'Sienna', 'Minjun', 'Sheer', 'John']
const namePattern = new RegExp(`\\b(?:${CHILD_NAMES.join('|')})\\b`, 'g')

export function maskChildNames(text: string) {
  return text.replace(namePattern, '[아이]')
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return maskChildNames(value)
  if (Array.isArray(value)) return value.map((item) => maskValue(item))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) output[key] = maskValue(child)
    return output
  }
  return value
}

/** 선생님 입력인 반 이름·종목·날짜는 가리지 않는다. 분석 문장만 가린다. */
export function maskCardText<T extends { lesson: { class_name: string; sport: string; date: string } }>(card: T): T {
  const lesson = {
    class_name: card.lesson.class_name,
    sport: card.lesson.sport,
    date: card.lesson.date,
  }
  const masked = maskValue(card) as T
  masked.lesson.class_name = lesson.class_name
  masked.lesson.sport = lesson.sport
  masked.lesson.date = lesson.date
  return masked
}
