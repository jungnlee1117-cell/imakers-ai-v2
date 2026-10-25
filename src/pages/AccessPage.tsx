import { useEffect, useState } from 'react'
import { api } from '../api.ts'

type Entry = {
  id: string
  createdAt: string
  actorName: string | null
  targetType: 'card' | 'recording'
  lessonDate: string | null
  className: string | null
  teacherName: string | null
}

export default function AccessPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<{ entries: Entry[] }>('/api/access-log')
      .then((data) => setEntries(data.entries))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '열람 내역을 불러오지 못했습니다.'))
  }, [])

  return (
    <section className="stack">
      <h1>열람 내역</h1>
      <p className="muted">누가 언제 카드나 녹음을 열었는지입니다.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {entries.length === 0 && <p className="muted">아직 기록이 없습니다.</p>}
      <table>
        <thead><tr><th>시각</th><th>사람</th><th>대상</th><th>수업</th></tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.createdAt).toLocaleString('ko-KR')}</td>
              <td>{entry.actorName ?? '알 수 없음'}</td>
              <td>{entry.targetType === 'recording' ? '녹음' : '카드'}</td>
              <td>{entry.teacherName ?? ''} {entry.lessonDate ?? ''} {entry.className ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
