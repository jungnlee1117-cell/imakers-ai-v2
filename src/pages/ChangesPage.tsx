import { useEffect, useState } from 'react'
import { api, type UploadRow } from '../api.ts'

type ChangeItem = {
  id: string
  label: string
  before: number
  after: number
  unit: string
  bucketLabel: '좋아졌어요' | '약해졌어요' | '비슷해요'
}

export default function ChangesPage() {
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [uploadId, setUploadId] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [items, setItems] = useState<ChangeItem[]>([])
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<{ uploads: UploadRow[] }>('/api/uploads').then((data) => {
      const done = data.uploads.filter((upload) => upload.status === 'done')
      setUploads(done)
      if (done[0]) setUploadId(done[0].id)
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '수업을 불러오지 못했습니다.'))
  }, [])

  useEffect(() => {
    if (!uploadId) return
    void api<{ notes: string[]; items: ChangeItem[]; previousUploadId: string | null }>(`/api/changes?uploadId=${uploadId}`)
      .then((data) => {
        setNotes(data.notes)
        setItems(data.items)
        setEmpty(!data.previousUploadId)
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '비교하지 못했습니다.'))
  }, [uploadId])

  const groups = ['좋아졌어요', '약해졌어요', '비슷해요'] as const

  return (
    <section className="stack">
      <h1>변화 보기</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {uploads.length === 0 && <p className="muted">완료된 수업이 두 개 이상 쌓이면 비교할 수 있습니다.</p>}
      {uploads.length > 0 && (
        <label>수업
          <select value={uploadId} onChange={(event) => setUploadId(event.target.value)}>
            {uploads.map((upload) => <option key={upload.id} value={upload.id}>{upload.lessonDate} · {upload.className}</option>)}
          </select>
        </label>
      )}
      {empty && <p>비교할 이전 수업이 없습니다.</p>}
      {notes.map((note) => <p key={note} className="banner">{note}</p>)}
      {groups.map((label) => (
        <article key={label} className="card stack">
          <h2>{label}</h2>
          {items.filter((item) => item.bucketLabel === label).length === 0 && <p className="muted">해당하는 항목이 없습니다.</p>}
          {items.filter((item) => item.bucketLabel === label).map((item) => (
            <p key={item.id}>{item.label}: {item.before}{item.unit} → {item.after}{item.unit}</p>
          ))}
        </article>
      ))}
    </section>
  )
}
