import { useEffect, useState } from 'react'
import { api, go, type UploadRow } from '../api.ts'
import { languageLabel, sportLabel, statusLabel } from '../format.ts'

type Note = { id: string; message: string; readAt: string | null; uploadId: string | null }

export default function HomePage() {
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [list, notifications] = await Promise.all([
        api<{ uploads: UploadRow[] }>('/api/uploads'),
        api<{ notifications: Note[] }>('/api/notifications'),
      ])
      setUploads(list.uploads)
      setNotes(notifications.notifications)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '목록을 불러오지 못했습니다.')
    }
  }

  useEffect(() => { void load() }, [])

  const waiting = uploads.some((upload) => upload.status === 'uploading' || upload.status === 'queued' || upload.status === 'processing')
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [waiting])

  return (
    <section className="stack">
      <h1>내 수업</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {notes.filter((note) => !note.readAt).length > 0 && (
        <div className="panel stack">
          <h2>알림</h2>
          {notes.filter((note) => !note.readAt).map((note) => (
            <div key={note.id} className="row">
              <span>{note.message}</span>
              <button className="ghost" onClick={() => { void api(`/api/notifications/${note.id}/read`, { method: 'POST' }).then(load) }}>읽음</button>
            </div>
          ))}
        </div>
      )}
      {uploads.length === 0 && <p className="muted">아직 올린 수업이 없습니다.</p>}
      {uploads.map((upload) => (
        <article key={upload.id} className="card stack">
          <div className="row">
            <strong>{upload.lessonDate} · {upload.className}</strong>
            <span className={`pill ${upload.status === 'failed' ? 'bad' : upload.status === 'done' ? '' : 'warn'}`}>{statusLabel(upload.status)}</span>
          </div>
          <p className="muted">{sportLabel(upload.sport)} · {languageLabel(upload.languageMode)} · {upload.filename}</p>
          {upload.failureReason && <p className="error">{upload.failureReason}</p>}
          <div className="row">
            {upload.status === 'done' && <button className="primary" onClick={() => go(`/cards/${upload.id}`)}>카드 열기</button>}
            {upload.status === 'failed' && <button className="primary" onClick={() => { void api(`/api/uploads/${upload.id}/retry`, { method: 'POST' }).then(load) }}>다시 시도</button>}
            <button className="ghost" onClick={() => {
              if (window.confirm('이 녹음과 전사, 카드를 삭제합니다. 쌓인 기술 표현은 남습니다.')) {
                void api(`/api/uploads/${upload.id}`, { method: 'DELETE' }).then(load)
              }
            }}>내 녹음 삭제</button>
          </div>
        </article>
      ))}
    </section>
  )
}
