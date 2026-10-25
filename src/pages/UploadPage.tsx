import { useState, type FormEvent } from 'react'
import { api, go, type Session } from '../api.ts'

const RESUME = 'cc-upload'

export default function UploadPage({ session, onUploaded }: { session: Session; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [lessonDate, setLessonDate] = useState(new Date().toISOString().slice(0, 10))
  const [className, setClassName] = useState('')
  const [sport, setSport] = useState('soccer')
  const [languageMode, setLanguageMode] = useState('english')
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agree, setAgree] = useState(Boolean(session.consent))

  async function ensureConsent() {
    if (session.consent || agree) {
      if (!session.consent) await api('/api/consents', { method: 'POST', body: '{}' })
      return
    }
    throw new Error('첫 업로드 전에 동의가 필요합니다.')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setError(null)
    try {
      await ensureConsent()
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
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
        setProgress(`${index + 1} / ${expected} 조각`)
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
      onUploaded()
      go('/')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '올리지 못했습니다. 같은 파일을 다시 고르면 이어서 올립니다.')
    }
  }

  return (
    <form className="stack" onSubmit={(event) => { void submit(event) }}>
      <h1>업로드</h1>
      <section className="panel stack">
        <h2>열람 범위</h2>
        <p>같은 소속의 대표는 녹음과 카드를 볼 수 있습니다. 관리자는 담당 선생님만 재생하고 전사를 봅니다. 다른 소속은 아무도 볼 수 없습니다.</p>
        <p>영상은 소리를 뽑은 뒤 삭제하고, 소리는 {session.organization?.retentionDays ?? 365}일 보관합니다. 소속 기관의 녹음 허락은 선생님이 직접 확인해야 합니다.</p>
        <p>파일 한도는 1GiB입니다. 25분 영상(수백 MB)을 올릴 수 있고, 끊기면 이어서 올립니다.</p>
      </section>
      {!session.consent && (
        <section className="panel stack">
          <h2>녹음 이용 동의</h2>
          <p>첫 업로드 전에 녹음 이용 동의가 필요합니다. 동의 문구는 전문가 검토 전이라 이 화면에 넣지 않습니다. 확인하면 동의 기록만 저장됩니다.</p>
          <label className="row"><input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} /> 녹음 이용에 대한 동의가 필요하다는 점을 확인했습니다.</label>
        </section>
      )}
      <label>날짜<input type="date" value={lessonDate} onChange={(event) => setLessonDate(event.target.value)} required /></label>
      <label>반<input value={className} onChange={(event) => setClassName(event.target.value)} required /></label>
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
      <label>영상 또는 음성<input type="file" accept="video/*,audio/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label>
      {progress && <p>올리는 중 {progress}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={!file || (!session.consent && !agree)}>올리기</button>
    </form>
  )
}
