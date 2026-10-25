import { useEffect, useRef, useState } from 'react'
import { api, type CardDocument, type TranscriptLine } from '../api.ts'
import { formatClock, languageLabel, sportLabel } from '../format.ts'

const KIND_LABEL = { main: '움직임', normal: '설명·정리', control: '훈육·재정비' }
const PHRASE_LABEL = { error: '문장 오류', tip: '다듬기', check: '확인 필요' }
const SKILL_LABEL: Record<string, string> = {
  praise: '칭찬 표현',
  rule_as_question: '규칙을 질문으로 말하기',
  child_care: '아이 마음 살피기',
}

export default function CardPage({ id, role, onChanged }: { id: string; role: string; onChanged: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [card, setCard] = useState<CardDocument | null>(null)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await api<{
        upload: { status: string; failureReason: string | null }
        card: CardDocument | null
        lines: TranscriptLine[]
        audioUrl: string | null
        processorNotice: string | null
      }>(`/api/uploads/${id}`)
      setStatus(data.upload.status)
      setFailure(data.upload.failureReason)
      setCard(data.card)
      setLines(data.lines)
      setAudioUrl(data.audioUrl)
      setNotice(data.processorNotice)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '카드를 불러오지 못했습니다.')
    }
  }

  useEffect(() => { void load() }, [id])

  function seek(seconds: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    void audio.play().catch(() => undefined)
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!card) {
    return (
      <section className="stack">
        <h1>수업 카드</h1>
        <p>{status === 'failed' ? '실패' : '카드를 만드는 중입니다.'}</p>
        {failure && <p className="error">{failure}</p>}
        {status === 'failed' && role === 'teacher' && (
          <button className="primary" onClick={() => { void api(`/api/uploads/${id}/retry`, { method: 'POST' }).then(() => { onChanged(); void load() }) }}>다시 시도</button>
        )}
      </section>
    )
  }

  const total = card.flow.segments.reduce((sum, segment) => sum + Math.max(1, segment.end_sec - segment.start_sec), 0)

  return (
    <section className="stack">
      {notice && <p className="banner">{notice}</p>}
      <header className="stack">
        <h1>{card.lesson.date} · {card.lesson.class_name}</h1>
        <p className="muted">
          {sportLabel(card.lesson.sport)} · {languageLabel(card.lesson.language_mode)} · {card.lesson.source === 'video' ? '영상에서 뽑은 소리' : '음성'} · {formatClock(card.lesson.duration_sec)}
        </p>
      </header>
      <audio ref={audioRef} controls preload="metadata" src={audioUrl ?? undefined} />
      <p className="muted">시각을 누르면 그 지점부터 재생됩니다.</p>

      <article className="card stack">
        <h2>수업 흐름</h2>
        <p>{card.flow.lead}</p>
        <div className="flow">
          {card.flow.segments.map((segment) => (
            <button
              key={`${segment.start_sec}-${segment.label}`}
              className={`kind-${segment.kind}`}
              style={{ flex: Math.max(1, segment.end_sec - segment.start_sec) / total }}
              onClick={() => seek(segment.start_sec)}
            >
              <small>{formatClock(segment.start_sec)} · {KIND_LABEL[segment.kind]}</small>
              {segment.label}
            </button>
          ))}
        </div>
        <p>{card.flow.note}</p>
      </article>

      {card.english_phrases && (
        <article className="card stack">
          <h2>영어 표현 다듬기</h2>
          <p>{card.english_phrases.note}</p>
          {card.english_phrases.items.map((item) => (
            <div key={`${item.at_sec}-${item.heard}`}>
              <button className="time" onClick={() => seek(item.at_sec)}>{formatClock(item.at_sec)}</button>
              <span className="pill">{PHRASE_LABEL[item.type]}</span>
              <p>들은 말: {item.heard}</p>
              <p>제안: {item.suggested}</p>
              <p className="muted">{item.reason}</p>
            </div>
          ))}
        </article>
      )}

      <article className="card stack">
        <h2>아이와의 상호작용·훈육</h2>
        <h3>이어가 보면 좋은 장면</h3>
        {card.interaction.good.map((scene) => (
          <Scene key={scene.title} scene={scene} onSeek={seek} />
        ))}
        <h3>이렇게 해 보면 좋아요</h3>
        {card.interaction.improve.map((scene) => (
          <Scene key={scene.title} scene={scene} onSeek={seek} />
        ))}
      </article>

      <article className="card stack">
        <h2>계획안 대로</h2>
        {card.plan_adherence?.status === 'done' ? (
          <>
            {card.plan_adherence.note && <p>{card.plan_adherence.note}</p>}
            <div className="split">
              <div><h3>계획한 활동</h3><ul>{(card.plan_adherence.planned ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>실제로 한 활동</h3><ul>{(card.plan_adherence.actual ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>빠진 활동</h3><ul>{(card.plan_adherence.missing ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div>
            </div>
          </>
        ) : <p>이 달의 계획안이 연결되지 않았습니다.</p>}
      </article>

      <article className="card stack">
        <h2>기준 수치</h2>
        <p className="muted">횟수와 비율입니다.</p>
        <div className="metric-grid">
          {card.metrics.map((metric) => (
            <div key={metric.id} className="panel">
              <div className="muted">{metric.label}</div>
              <strong>{metric.value}{metric.unit}</strong>
              {metric.sub && <div className="muted">{metric.sub}</div>}
            </div>
          ))}
        </div>
      </article>

      <article className="card stack">
        <h2>평가에서 뺀 줄</h2>
        {card.excluded_lines.map((line) => (
          <p key={`${line.at_sec}-${line.reason}`}>
            <button className="time" onClick={() => seek(line.at_sec)}>{formatClock(line.at_sec)}</button> {line.reason}
          </p>
        ))}
      </article>

      {card.skill_events.length > 0 && (
        <article className="card stack">
          <h2>이 수업에서 확인된 표현</h2>
          {card.skill_events.map((event) => (
            <p key={`${event.skill_id}-${event.at_sec}-${event.expression}`}>
              <button className="time" onClick={() => seek(event.at_sec)}>{formatClock(event.at_sec)}</button>
              {' '}{SKILL_LABEL[event.skill_id] ?? event.skill_id}: {event.expression}
            </p>
          ))}
        </article>
      )}

      <article className="card stack">
        <h2>전사</h2>
        {lines.map((line) => (
          <div key={line.id} className="stack">
            <p>
              <button className="time" onClick={() => seek(line.start_sec)}>{formatClock(line.start_sec)}</button>
              {' '}{line.text}
              {!line.trusted && <span className="pill warn">음성인식 의심</span>}
            </p>
            {role === 'teacher' && (
              <div className="row">
                <button className={line.teacher_check === 'confirmed' ? 'primary' : 'ghost'} onClick={() => { void api(`/api/transcript-lines/${line.id}/check`, { method: 'POST', body: JSON.stringify({ teacherCheck: 'confirmed' }) }).then(load) }}>맞아요</button>
                <button className={line.teacher_check === 'rejected' ? 'primary' : 'ghost'} onClick={() => { void api(`/api/transcript-lines/${line.id}/check`, { method: 'POST', body: JSON.stringify({ teacherCheck: 'rejected' }) }).then(load) }}>제가 한 말이 아니에요</button>
              </div>
            )}
          </div>
        ))}
      </article>
    </section>
  )
}

function Scene({ scene, onSeek }: { scene: { title: string; at_sec: number[]; text: string }; onSeek: (seconds: number) => void }) {
  return (
    <div>
      <strong>{scene.title}</strong>
      <div className="row">
        {scene.at_sec.map((seconds) => (
          <button key={seconds} className="time" onClick={() => onSeek(seconds)}>{formatClock(seconds)}</button>
        ))}
      </div>
      <p>{scene.text}</p>
    </div>
  )
}
