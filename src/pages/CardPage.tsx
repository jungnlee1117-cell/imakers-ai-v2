import { useEffect, useRef, useState } from 'react'
import { api, type AreaReview, type CardDocument, type TranscriptLine } from '../api.ts'
import { formatClock, languageLabel, sportLabel } from '../format.ts'

const AREA_ORDER = ['flow', 'english', 'interaction', 'discipline', 'safety', 'plan'] as const
const AREA_LABEL: Record<(typeof AREA_ORDER)[number], string> = {
  flow: '수업 흐름',
  english: '영어 표현',
  interaction: '아이와의 상호작용',
  discipline: '훈육',
  safety: '안전·주목',
  plan: '계획안',
}
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
      <section className="card stack">
        <h2>{status === 'failed' ? '카드를 만들지 못했습니다' : '카드를 만드는 중입니다'}</h2>
        {status !== 'failed' && <p className="muted"><span className="spinner" />보통 3~5분 걸립니다. 이 창을 닫아도 됩니다.</p>}
        {failure && <p className="error">{failure}</p>}
        {status === 'failed' && role === 'teacher' && (
          <button className="primary" onClick={() => { void api(`/api/uploads/${id}/retry`, { method: 'POST' }).then(() => { onChanged(); void load() }) }}>다시 시도</button>
        )}
        <a href="#/">← 목록으로</a>
      </section>
    )
  }

  const reviews = card.schema_version === '1.1'
    ? AREA_ORDER.flatMap((area) => card.area_reviews?.filter((review) => review.area === area) ?? [])
    : []
  let number = 0
  const nextNumber = () => { number += 1; return number }

  return (
    <section className="stack" style={{ gap: 22 }}>
      <a href="#/" className="muted small">← 내 수업</a>
      {notice && <p className="banner">{notice}</p>}
      <header className="hero-head">
        <h1>{card.lesson.date} · {card.lesson.class_name}</h1>
        <p className="muted">
          {sportLabel(card.lesson.sport)} · {languageLabel(card.lesson.language_mode)} · {formatClock(card.lesson.duration_sec)}
        </p>
      </header>
      <div className="player">
        <audio ref={audioRef} controls preload="metadata" src={audioUrl ?? undefined} />
        <p className="muted small">초록색 시각을 누르면 그 장면부터 들려 드립니다.</p>
      </div>

      {reviews.length === 0 && (
        <>
          <section className="sec">
            <h2><i>{nextNumber()}</i>수업 흐름</h2>
            <FlowBar card={card} onSeek={seek} />
          </section>
          {card.english_phrases && <PhraseTable card={card} onSeek={seek} />}
          <section className="sec">
            <h2><i>{nextNumber()}</i>아이와의 상호작용 · 훈육</h2>
            <div className="two">
              <div className="col good"><h3>잘한 점</h3>{card.interaction.good.map((scene) => <Scene key={scene.title} scene={scene} onSeek={seek} />)}</div>
              <div className="col weak"><h3>더 좋아질 점</h3>{card.interaction.improve.map((scene) => <Scene key={scene.title} scene={scene} onSeek={seek} />)}</div>
            </div>
          </section>
        </>
      )}

      {reviews.map((review) => (
        <section key={review.area} className="sec">
          <h2><i>{nextNumber()}</i>{AREA_LABEL[review.area]}</h2>
          {review.area === 'flow' && <FlowBar card={card} onSeek={seek} />}
          {review.area === 'english' && card.english_phrases && <PhraseTable card={card} onSeek={seek} bare />}
          <div className="two">
            <div className="col good">
              <h3>잘한 점</h3>
              {review.good.length === 0 && <p className="muted small">이번 수업에서는 따로 짚은 점이 없습니다.</p>}
              {review.good.map((finding) => <Finding key={finding.title} finding={finding} onSeek={seek} />)}
            </div>
            <div className="col weak">
              <h3>더 좋아질 점</h3>
              {review.improve.length === 0 && <p className="muted small">이번 수업에서는 따로 짚은 점이 없습니다.</p>}
              {review.improve.map((finding) => <Finding key={finding.title} finding={finding} onSeek={seek} />)}
            </div>
          </div>
        </section>
      ))}

      <section className="sec">
        <h2><i>{nextNumber()}</i>계획안 대로 했나요</h2>
        {card.plan_adherence?.status === 'done' ? (
          <div className="card stack">
            {card.plan_adherence.note && <p>{card.plan_adherence.note}</p>}
            <div className="two">
              <div><h3>계획한 활동</h3><ul>{(card.plan_adherence.planned ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>실제로 한 활동</h3><ul>{(card.plan_adherence.actual ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div>
            </div>
            {(card.plan_adherence.missing ?? []).length > 0 && <div><h3>빠진 활동</h3><ul>{(card.plan_adherence.missing ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div>}
          </div>
        ) : <p className="muted">이 달의 계획안이 연결되지 않았습니다. ‘계획안’ 탭에서 올리면 비교해 드립니다.</p>}
      </section>

      <section className="sec">
        <h2><i>{nextNumber()}</i>이번 수업의 기준 수치</h2>
        <p className="muted small">내 수업의 변화를 보는 숫자입니다.</p>
        <div className="metric-grid">
          {card.metrics.map((metric) => (
            <div key={metric.id} className="metric">
              <b>{metric.value}<small>{metric.unit}</small></b>
              <span>{metric.label}</span>
              {metric.sub && <em>{metric.sub}</em>}
            </div>
          ))}
        </div>
      </section>

      <section className="sec">
        <h2><i>{nextNumber()}</i>오늘의 연습</h2>
        <div className="stack">
          {card.practice.map((item) => (
            <div key={item.id} className="card practice-item">
              <strong>{item.say}</strong>
              <span className="muted small">{item.why}</span>
            </div>
          ))}
        </div>
      </section>

      {card.skill_events.length > 0 && (
        <details className="fold">
          <summary>이 수업에서 확인된 표현 {card.skill_events.length}개</summary>
          <div className="stack">
            {card.skill_events.map((event) => (
              <p key={`${event.skill_id}-${event.at_sec}-${event.expression}`}>
                <button className="time" onClick={() => seek(event.at_sec)}>{formatClock(event.at_sec)}</button>
                {' '}<span className="muted small">{SKILL_LABEL[event.skill_id] ?? event.skill_id}</span> {event.expression}
              </p>
            ))}
          </div>
        </details>
      )}

      {card.excluded_lines.length > 0 && (
        <details className="fold">
          <summary>평가에서 뺀 줄 {card.excluded_lines.length}개</summary>
          <p className="muted small">음성인식이 틀렸을 수 있는 줄은 평가에 쓰지 않았습니다.</p>
          <div className="stack">
            {card.excluded_lines.map((line) => (
              <p key={`${line.at_sec}-${line.reason}`}>
                <button className="time" onClick={() => seek(line.at_sec)}>{formatClock(line.at_sec)}</button> {line.reason}
              </p>
            ))}
          </div>
        </details>
      )}

      <details className="fold">
        <summary>전사 전체 보기</summary>
        <div>
          {lines.map((line) => (
            <div key={line.id} className="line">
              <p>
                <button className="time" onClick={() => seek(line.start_sec)}>{formatClock(line.start_sec)}</button>
                {' '}{line.text}
                {!line.trusted && <span className="pill warn" style={{ marginLeft: 6 }}>음성인식 의심</span>}
              </p>
              {role === 'teacher' && (
                <div className="row">
                  <button className={line.teacher_check === 'confirmed' ? 'primary' : 'ghost'} onClick={() => { void api(`/api/transcript-lines/${line.id}/check`, { method: 'POST', body: JSON.stringify({ teacherCheck: 'confirmed' }) }).then(load) }}>맞아요</button>
                  <button className={line.teacher_check === 'rejected' ? 'primary' : 'ghost'} onClick={() => { void api(`/api/transcript-lines/${line.id}/check`, { method: 'POST', body: JSON.stringify({ teacherCheck: 'rejected' }) }).then(load) }}>제가 한 말이 아니에요</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}

function FlowBar({ card, onSeek }: { card: CardDocument; onSeek: (seconds: number) => void }) {
  const total = card.flow.segments.reduce((sum, segment) => sum + Math.max(1, segment.end_sec - segment.start_sec), 0)
  const kinds = (['main', 'normal', 'control'] as const).filter((kind) => card.flow.segments.some((segment) => segment.kind === kind))
  return (
    <div className="stack">
      <p>{card.flow.lead}</p>
      <div className="flow">
        {card.flow.segments.map((segment) => (
          <button
            key={`${segment.start_sec}-${segment.label}`}
            className={`kind-${segment.kind}`}
            style={{ flex: Math.max(1, segment.end_sec - segment.start_sec) / total }}
            title={segment.label}
            aria-label={`${formatClock(segment.start_sec)} ${segment.label}`}
            onClick={() => onSeek(segment.start_sec)}
          />
        ))}
      </div>
      <div className="legend">
        {kinds.map((kind) => <span key={kind}><i className={`kind-${kind}`} />{KIND_LABEL[kind]}</span>)}
      </div>
      <div className="seg-list">
        {card.flow.segments.map((segment) => (
          <button key={`${segment.start_sec}-row-${segment.label}`} onClick={() => onSeek(segment.start_sec)}>
            <span className="ts">{formatClock(segment.start_sec)}–{formatClock(segment.end_sec)}</span>
            <span>{segment.label}</span>
          </button>
        ))}
      </div>
      <p className="banner">{card.flow.note}</p>
    </div>
  )
}

function PhraseTable({ card, onSeek, bare }: { card: CardDocument; onSeek: (seconds: number) => void; bare?: boolean }) {
  const phrases = card.english_phrases
  if (!phrases) return null
  const body = (
    <div className="stack">
      <p className="muted small">{phrases.note}</p>
      {phrases.items.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="phrases">
            <thead><tr><th>시각</th><th>구분</th><th>들린 표현</th><th>이렇게 말해 보세요</th><th>이유</th></tr></thead>
            <tbody>
              {phrases.items.map((item) => (
                <tr key={`${item.at_sec}-${item.heard}`}>
                  <td><button className="time" onClick={() => onSeek(item.at_sec)}>{formatClock(item.at_sec)}</button></td>
                  <td><span className={`pill ${item.type === 'error' ? 'bad' : item.type === 'check' ? 'gray' : 'warn'}`}>{PHRASE_LABEL[item.type]}</span></td>
                  <td>{item.heard}</td>
                  <td className="sg">{item.suggested}</td>
                  <td className="muted">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
  if (bare) return body
  return <section className="sec"><h2><i>＋</i>영어 표현 다듬기</h2>{body}</section>
}

function Finding({ finding, onSeek }: { finding: AreaReview['good'][number] | AreaReview['improve'][number]; onSeek: (seconds: number) => void }) {
  const example = 'example' in finding ? finding.example : undefined
  return (
    <div className="finding">
      <strong>{finding.title}</strong>
      <p>{finding.text}</p>
      <div className="ev">
        {finding.evidence.map((item) => (
          <div key={`${item.at_sec}-${item.quote}`}>
            <button className="time" onClick={() => onSeek(item.at_sec)}>{formatClock(item.at_sec)}</button>
            <q>{item.quote}</q>
          </div>
        ))}
      </div>
      {example && (
        <div className="say">
          <span className="muted small">이렇게 말해 보세요</span>
          <b>{example.say}</b>
          <span className="small">{example.why}</span>
        </div>
      )}
    </div>
  )
}

function Scene({ scene, onSeek }: { scene: { title: string; at_sec: number[]; text: string }; onSeek: (seconds: number) => void }) {
  return (
    <div className="finding">
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
