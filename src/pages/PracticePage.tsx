import { useEffect, useState } from 'react'
import { api, type CardDocument } from '../api.ts'

export default function PracticePage() {
  const [practice, setPractice] = useState<CardDocument['practice']>([])
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [streak, setStreak] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await api<{
        uploadId?: string
        practice?: CardDocument['practice']
        checked: string[]
        streak: number
      }>('/api/practice')
      setError(null)
      setUploadId(data.uploadId ?? null)
      setPractice(data.practice ?? [])
      setChecked(data.checked)
      setStreak(data.streak)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '연습을 불러오지 못했습니다.')
    }
  }

  useEffect(() => { void load() }, [])

  async function toggle(itemKey: string, next: boolean) {
    if (!uploadId) return
    await api('/api/practice', { method: 'POST', body: JSON.stringify({ uploadId, itemKey, checked: next }) })
    await load()
  }

  return (
    <section className="stack">
      <h1>오늘의 연습</h1>
      <p>연속 {streak}일</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!error && practice.length === 0 && <p className="muted">완료된 카드가 없으면 연습이 없습니다.</p>}
      {practice.map((item) => (
        <article key={item.id} className="card stack">
          <span className="pill">{item.is_task ? '수업 후 과제' : '소리 내어 읽기'}</span>
          <strong>{item.say}</strong>
          <p className="muted">{item.why}</p>
          <label className="row">
            <input
              type="checkbox"
              checked={checked.includes(item.id)}
              onChange={(event) => { void toggle(item.id, event.target.checked) }}
            />
            오늘 해 보았습니다
          </label>
        </article>
      ))}
    </section>
  )
}
