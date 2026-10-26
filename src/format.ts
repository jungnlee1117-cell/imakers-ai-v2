export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export function sportLabel(sport: string) {
  if (sport === 'soccer') return '축구'
  if (sport === 'jumprope') return '줄넘기'
  return sport
}

export function languageLabel(mode: string) {
  if (mode === 'english') return '영어'
  if (mode === 'korean') return '한국어'
  if (mode === 'mixed') return '섞어 말하기'
  return mode
}

export function statusLabel(status: string) {
  if (status === 'uploading') return '올리는 중'
  if (status === 'queued') return '분석 대기'
  if (status === 'processing') return '분석 중'
  if (status === 'done') return '완료'
  if (status === 'failed') return '실패'
  return status
}

export function roleLabel(role: string) {
  if (role === 'teacher') return '선생님'
  if (role === 'admin') return '관리자'
  if (role === 'representative') return '대표'
  if (role === 'pending') return '승인 대기'
  return role
}

export function billingLabel(tier: string) {
  return tier === 'free' ? '무료' : '유료'
}
