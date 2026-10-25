import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { languageLabel, sportLabel } from '../format.ts'

type Plan = { id: string; month: string; sport: string; languageMode: string; extractionNote: string | null }

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [sport, setSport] = useState('soccer')
  const [languageMode, setLanguageMode] = useState('english')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const data = await api<{ plans: Plan[] }>('/api/lesson-plans')
    setPlans(data.plans)
  }

  useEffect(() => { void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '계획안을 불러오지 못했습니다.')) }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setError(null)
    try {
      const body = await file.arrayBuffer()
      await api('/api/lesson-plans', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/pdf',
          'X-Month': month,
          'X-Sport': sport,
          'X-Language-Mode': languageMode,
        },
      })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '계획안을 올리지 못했습니다.')
    }
  }

  return (
    <section className="stack">
      <h1>월간 계획안</h1>
      <p className="muted">글자가 있는 PDF를 올립니다. 스캔 이미지는 글을 읽지 못할 수 있습니다.</p>
      <form className="stack" onSubmit={(event) => { void submit(event) }}>
        <label>월<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} required /></label>
        <label>종목
          <select value={sport} onChange={(event) => setSport(event.target.value)}>
            <option value="soccer">축구</option>
            <option value="jumprope">줄넘기</option>
          </select>
        </label>
        <label>언어
          <select value={languageMode} onChange={(event) => setLanguageMode(event.target.value)}>
            <option value="english">영어</option>
            <option value="korean">한국어</option>
            <option value="mixed">섞어 말하기</option>
          </select>
        </label>
        <label>PDF<input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit">올리기</button>
      </form>
      {plans.map((plan) => (
        <article key={plan.id} className="card">
          <strong>{plan.month}</strong> · {sportLabel(plan.sport)} · {languageLabel(plan.languageMode)}
          {plan.extractionNote && <p className="muted">{plan.extractionNote}</p>}
        </article>
      ))}
    </section>
  )
}
