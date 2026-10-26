import { useState, type FormEvent } from 'react'
import { api, go, type Session } from '../api.ts'

const RESUME = 'cc-upload'

// 녹음 이용 동의 문구는 전문가 검토 후 가입 화면에 들어갑니다. 지금은 가입 때 체크한 확인을 첫 업로드에 자동 기록합니다.
export default function UploadPage({ session, onUploaded }: {
  session: Session
  onUploaded: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [lessonDate, setLessonDate] = useState(new Date().toISOString().slice(0, 10))
  const className = '수업'
  const sport = 'soccer'
  const languageMode = 'english'
  const selectedTeacher = session.user.id
  const [progressInfo, setProgressInfo] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function ensureConsent() {
    if (!session.consent) await api('/api/consents', { method: 'POST', body: '{}' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setError(null)
    try {
      await ensureConsent()
      const fingerprint = `${selectedTeacher}:${file.name}:${file.size}:${file.lastModified}`
      let saved = sessionStorage.getItem(RESUME)
      let uploadId = ''
      let chunkSize = 0
      let expected = 0
      let received: number[] = []
      if (saved) {
        const parsed = JSON.parse(saved) as { fingerprint: string; id: string }
        if (parsed.fingerprint === fingerprint) {
          const existing = await api<{ upload: { status: string; receivedChunks: number[]; chunkSize: number; expectedChunks: number } }>(`/api/uploads/${parsed.id}`)
          if (existing.upload.status === 'uploading') {
            uploadId = parsed.id
            chunkSize = existing.upload.chunkSize
            expected = existing.upload.expectedChunks
            received = existing.upload.receivedChunks
          }
        }
      }
      if (!uploadId) {
        const created = await api<{ id: string; chunkSize: number; expectedChunks: number }>('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name,
            byteSize: file.size,
            contentType: file.type || 'application/octet-stream',
            lessonDate,
            className,
            sport,
            languageMode,
          }),
        })
        uploadId = created.id
        chunkSize = created.chunkSize
        expected = created.expectedChunks
        sessionStorage.setItem(RESUME, JSON.stringify({ fingerprint, id: uploadId }))
      }
      const have = new Set(received)
      for (let index = 0; index < expected; index += 1) {
        if (have.has(index)) continue
        const start = index * chunkSize
        const blob = file.slice(start, Math.min(file.size, start + chunkSize))
        setProgressInfo({ done: index, total: expected })
        let lastError: unknown
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await api(`/api/uploads/${uploadId}/chunks/${index}`, {
              method: 'PUT',
              body: blob,
              headers: { 'Content-Type': 'application/octet-stream' },
            })
            lastError = null
            break
          } catch (caught) {
            lastError = caught
          }
        }
        if (lastError) throw lastError
      }
      await api(`/api/uploads/${uploadId}/complete`, { method: 'POST', body: '{}' })
      sessionStorage.removeItem(RESUME)
      setProgressInfo(null)
      setFile(null)
      onUploaded()
      go('/')
    } catch (caught) {
      setProgressInfo(null)
      setError(caught instanceof Error ? caught.message : '올리지 못했습니다. 같은 파일을 다시 고르면 이어서 올립니다.')
    }
  }

  const [over, setOver] = useState(false)
  const percent = progressInfo ? Math.round((progressInfo.done / Math.max(1, progressInfo.total)) * 100) : 0

  return (
    <form className="stack" onSubmit={(event) => { void submit(event) }}>
      <label
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          const dropped = event.dataTransfer.files?.[0]
          if (dropped) setFile(dropped)
        }}
      >
        <span className="big-icon" aria-hidden>🎙️</span>
        <strong>{file ? file.name : '수업 녹음을 올리세요'}</strong>
        <span className="muted small">{file ? `${(file.size / 1048576).toFixed(0)}MB · 다른 파일을 고르려면 다시 누르세요` : '영상이나 음성 파일을 끌어다 놓거나 눌러서 고르세요'}</span>
        <input type="file" accept="video/*,audio/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>

      {file && (
        <div className="upload-fields">
          <label>수업 날짜<input type="date" value={lessonDate} onChange={(event) => setLessonDate(event.target.value)} required /></label>
        </div>
      )}

      {progressInfo && (
        <div className="stack">
          <div className="bar"><span style={{ width: `${percent}%` }} /></div>
          <p className="muted small">올리는 중 {percent}% · 창을 닫지 마세요</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {file && (
        <button className="primary big" type="submit" disabled={!file || Boolean(progressInfo)}>
          {progressInfo ? '올리는 중…' : '올리기'}
        </button>
      )}
      <p className="muted small">영상은 소리만 뽑고 바로 지웁니다. 소리는 {session.organization?.retentionDays ?? 365}일 보관합니다.</p>
    </form>
  )
}
