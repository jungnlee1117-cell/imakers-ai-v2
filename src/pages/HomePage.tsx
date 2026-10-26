import { useEffect, useState } from 'react'
import { api, go, type Session } from '../api.ts'
import UploadPage from './UploadPage.tsx'

type Note = { id: string; message: string; readAt: string | null; uploadId: string | null }
type Lesson = { id: string; lessonDate: string; status: string; failureReason: string | null; teacherId: string; teacherName: string }

function dateLabel(value: string) {
  const [, month, day] = value.slice(0, 10).split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

function LessonList({ title, empty, items, own, load }: { title: string; empty: string; items: Lesson[]; own?: boolean; load: () => Promise<void> }) {
  return (
    <div className="stack">
      <h2>{title}</h2>
      {items.length === 0 && <p className="muted">{empty}</p>}
      {items.map((lesson) => (
        <article key={lesson.id} className="card lesson">
          <div className="t">
            <strong>{dateLabel(lesson.lessonDate)}{!own && ` · ${lesson.teacherName}`}</strong>
            {lesson.failureReason && <span className="small" style={{ color: 'var(--red)' }}>{lesson.failureReason}</span>}
          </div>
          <div className="row">
            {(lesson.status === 'uploading' || lesson.status === 'queued' || lesson.status === 'processing') && (
              <span className="pill warn"><span className="spinner" />{lesson.status === 'uploading' ? '올리는 중' : '카드 만드는 중 · 3~5분'}</span>
            )}
            {lesson.status === 'done' && <button className="primary" onClick={() => go(`/cards/${lesson.id}`)}>카드 보기</button>}
            {lesson.status === 'failed' && (
              <>
                <span className="pill bad">실패</span>
                {own && <button className="ghost" onClick={() => { void api(`/api/uploads/${lesson.id}/retry`, { method: 'POST' }).then(load) }}>다시 시도</button>}
              </>
            )}
            {own && (
              <button className="link" onClick={() => {
                if (window.confirm('이 녹음과 전사, 카드를 삭제합니다. 쌓인 기술 표현은 남습니다.')) {
                  void api(`/api/uploads/${lesson.id}`, { method: 'DELETE' }).then(load)
                }
              }}>삭제</button>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

export default function HomePage({ session, onSession }: { session: Session; onSession: () => void }) {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const isTeacher = session.role === 'teacher'
  const canUpload = isTeacher || session.role === 'representative'
  const mine = lessons.filter((lesson) => lesson.teacherId === session.user.id)
  const others = lessons.filter((lesson) => lesson.teacherId !== session.user.id)

  async function load() {
    try {
      const [list, notifications] = await Promise.all([
        api<{ lessons: Lesson[] }>('/api/lessons'),
        isTeacher ? api<{ notifications: Note[] }>('/api/notifications') : Promise.resolve({ notifications: [] as Note[] }),
      ])
      setLessons(list.lessons)
      setNotes(notifications.notifications)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '목록을 불러오지 못했습니다.')
    }
  }

  useEffect(() => { void load() }, [])

  const waiting = lessons.some((lesson) => lesson.status === 'uploading' || lesson.status === 'queued' || lesson.status === 'processing')
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => { void load() }, 2500)
    return () => window.clearInterval(timer)
  }, [waiting])

  const unread = notes.filter((note) => !note.readAt)

  return (
    <section className="stack" style={{ gap: 22 }}>
      {canUpload && <UploadPage session={session} onUploaded={() => { void load(); onSession() }} />}
      {error && <p className="error" role="alert">{error}</p>}
      {unread.map((note) => (
        <div key={note.id} className="banner row between">
          <span>{note.message}</span>
          <button className="ghost" onClick={() => { void api(`/api/notifications/${note.id}/read`, { method: 'POST' }).then(load) }}>확인</button>
        </div>
      ))}

      {canUpload && <LessonList title="내 수업" empty="아직 올린 수업이 없습니다. 위에서 첫 녹음을 올려 보세요." items={mine} own load={load} />}
      {!isTeacher && <LessonList title="선생님들이 올린 수업" empty="아직 선생님들이 올린 수업이 없습니다." items={others} load={load} />}
    </section>
  )
}
