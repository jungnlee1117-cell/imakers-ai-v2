import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, ImagePlus,
  LoaderCircle, Mic, Paintbrush, Send, Sparkles,
} from 'lucide-react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { createProviderClients } from './providers'
import type { AIProvider, ImageProvider, ProviderKind } from './providers'
import type { ConversationTurn, CreativeMemory, DrawingAnalysis, ImageVersion, StudioStep } from './types/creative'
import { EMPTY_MEMORY } from './types/creative'
import './studio.css'

const Logo = () => (
  <div className="logo-mark"><span>i</span><strong>아이메이커스</strong><em>AI</em></div>
)

function StartScreen({ onDraw, onUpload, provider, onProviderChange }: {
  onDraw: () => void
  onUpload: (image: string) => void
  provider: ProviderKind
  onProviderChange: (provider: ProviderKind) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onUpload(String(reader.result))
    reader.readAsDataURL(file)
  }

  return (
    <main className="start-page">
      <section className="start-card">
        <img className="start-hero-image" src="/imakers-start-hero.png" alt="그림을 보며 상상하는 아이와 AI 로봇 친구" />
        <div className="start-sky-wash" />
        <div className="provider-switch" aria-label="AI 대화 provider">
          {(['mock', 'openai', 'anthropic'] as ProviderKind[]).map((item) => (
            <button
              key={item}
              className={provider === item ? 'active' : ''}
              onClick={() => onProviderChange(item)}
            >
              {item === 'anthropic' ? 'Claude' : item === 'openai' ? 'OpenAI' : '체험'}
            </button>
          ))}
        </div>
        <header className="start-brand">
          <span className="brand-star">★</span>
          <div className="rainbow-logo" aria-label="아이메이커스 AI">
            <strong><i>아</i><i>이</i><i>메</i><i>이</i><i>커</i><i>스</i></strong>
            <small>AI Makers</small>
          </div>
        </header>
        <div className="start-message">
          <h1>너의 상상이 더 멋지게 펼쳐지는 곳</h1>
          <p>그리고, 이야기하고, 함께 만들어봐요!</p>
        </div>
        <div className="start-bottom">
          <div className="start-actions">
            <button className="start-primary" onClick={onDraw}>
              <Paintbrush size={21} /> 그림 그리기 시작하기 <ArrowRight size={20} />
            </button>
            <button className="start-upload" onClick={() => inputRef.current?.click()}>
              <ImagePlus size={20} /> 그림 올려서 시작하기
            </button>
            <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={upload} />
          </div>
          <div className="start-benefits">
            <div><span>🎨</span><strong>그려보고</strong><small>네 생각을 자유롭게</small></div>
            <div><span>💬</span><strong>이야기하고</strong><small>AI 친구와 함께</small></div>
            <div><span>✨</span><strong>더 멋지게 만들어요</strong><small>상상이 현실이 되는 곳</small></div>
          </div>
        </div>
      </section>
    </main>
  )
}

function Conversation({ drawing, onBack, onVisualize, aiProvider }: {
  drawing: string
  onBack: () => void
  onVisualize: (memory: CreativeMemory) => void
  aiProvider: AIProvider
}) {
  const [analysis, setAnalysis] = useState<DrawingAnalysis | null>(null)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [memory, setMemory] = useState<CreativeMemory>(EMPTY_MEMORY)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(true)
  const [ready, setReady] = useState(false)
  const [providerError, setProviderError] = useState('')

  useEffect(() => {
    let active = true
    aiProvider.analyzeDrawing(drawing)
      .then((result) => {
        if (!active) return
        setAnalysis(result)
        setTurns([{ id: crypto.randomUUID(), speaker: 'ai', text: result.openingMessage }])
      })
      .catch((error: unknown) => {
        if (!active) return
        setProviderError(error instanceof Error ? error.message : 'AI와 연결하지 못했어요.')
      })
      .finally(() => {
        if (active) setThinking(false)
      })
    return () => { active = false }
  }, [drawing, aiProvider])

  const reply = async () => {
    const childMessage = input.trim()
    if (!childMessage || !analysis || thinking) return
    setTurns((items) => [...items, { id: crypto.randomUUID(), speaker: 'child', text: childMessage }])
    setInput('')
    setThinking(true)
    try {
      const response = await aiProvider.respondToChild({
        childMessage,
        memory,
        turnCount: turns.filter((turn) => turn.speaker === 'child').length,
        drawingAnalysis: analysis,
        conversationHistory: turns.map(({ speaker, text }) => ({ speaker, text })),
      })
      setMemory(response.memory)
      setReady(response.readyToVisualize)
      setTurns((items) => [...items, {
        id: crypto.randomUUID(),
        speaker: 'ai',
        text: response.text,
        elements: response.elements,
      }])
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : 'AI와 연결하지 못했어요.')
    } finally {
      setThinking(false)
    }
  }

  const recentChildThoughts = turns.filter((turn) => turn.speaker === 'child').slice(-3)
  const latestAI = [...turns].reverse().find((turn) => turn.speaker === 'ai')

  return (
    <main className="conversation-page">
      <header className="conversation-header">
        <button className="icon-button" onClick={onBack} aria-label="이전 화면"><ArrowLeft size={21} /></button>
        <Logo />
        <div className="progress-steps">
          <span className="done"><Check size={13} /> 그림</span><i />
          <span className="current">2</span><b>이야기 나누기</b><i />
          <span>3</span><b>함께 펼치기</b>
        </div>
        <span className="safe-note">저장되지 않는 체험 모드</span>
      </header>

      <div className="conversation-layout">
        <section className="art-stage">
          <div className="section-label"><span>MY DRAWING</span><strong>내가 그린 그림</strong></div>
          <div className="art-frame">
            <img src={drawing} alt="내가 그린 원본 그림" />
            {thinking && !analysis && (
              <div className="observing"><LoaderCircle className="spin" /><strong>그림을 천천히 보고 있어…</strong><span>무엇인지 단정하지 않고 살펴볼게</span></div>
            )}
          </div>
          {recentChildThoughts.length > 0 && (
            <div className="thought-trail">
              <span>내가 들려준 생각</span>
              {recentChildThoughts.map((turn) => <em key={turn.id}>“{turn.text}”</em>)}
            </div>
          )}
        </section>

        <aside className="coach-panel">
          <div className="coach-heading">
            <div className="coach-symbol"><Sparkles size={19} /></div>
            <div><span>AI CREATIVE PARTNER</span><strong>같이 상상하는 메이</strong></div>
            <i className="online-dot" />
          </div>
          <div className="coach-response">
            {providerError
              ? <div className="provider-error"><strong>AI 연결을 확인해줘</strong><span>{providerError}</span><button onClick={onBack}>Provider 다시 고르기</button></div>
              : latestAI ? <p>{latestAI.text}</p> : <p className="muted">그림 속 작은 단서들을 찾고 있어…</p>}
            {thinking && analysis && <div className="typing"><i /><i /><i /></div>}
          </div>
          {ready ? (
            <div className="consent-card">
              <span><Sparkles size={17} /> 준비되면 함께 펼쳐보자</span>
              <button className="primary-button" onClick={() => onVisualize(memory)}>
                응, 같이 만들어보자 <ArrowRight size={18} />
              </button>
              <button className="text-button" onClick={() => setReady(false)}>조금 더 이야기할래</button>
            </div>
          ) : (
            <div className="reply-area">
              <label htmlFor="child-reply">내 생각 들려주기</label>
              <div className="reply-box">
                <textarea
                  id="child-reply"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); reply() }
                  }}
                  placeholder="떠오르는 생각을 말해줘"
                  rows={3}
                />
                <button className="send-button" onClick={reply} disabled={!input.trim() || thinking}><Send size={19} /></button>
              </div>
              <span className="reply-hint">정답은 없어. 짧게 말해도 좋아.</span>
            </div>
          )}
          <div className="memory-peek">
            <span>메이가 기억하고 있어</span>
            <div>
              {memory.mainSubject && <em>{memory.mainSubject}</em>}
              {memory.confirmedFacts.slice(-2).map((fact) => <em key={fact}>{fact}</em>)}
              {!memory.mainSubject && <small>이야기를 나누면 중요한 생각이 여기에 모여</small>}
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}

function Visualize({ drawing, memory, onBack, imageProvider }: {
  drawing: string
  memory: CreativeMemory
  onBack: () => void
  imageProvider: ImageProvider
}) {
  const [versions, setVersions] = useState<ImageVersion[]>([
    { id: 1, label: '첫 번째 펼침', request: '처음 함께 만든 모습', createdAt: '방금' },
  ])
  const [selected, setSelected] = useState(1)
  const [request, setRequest] = useState('')
  const [generating, setGenerating] = useState(true)
  const [imageError, setImageError] = useState('')

  useEffect(() => {
    imageProvider.generateFromDrawing({ drawingDataUrl: drawing, memory })
      .catch((error: unknown) => {
        setImageError(error instanceof Error ? error.message : '이미지를 펼치지 못했어요.')
      })
      .finally(() => setGenerating(false))
  }, [drawing, memory, imageProvider])

  const edit = async () => {
    if (!request.trim() || generating) return
    const editRequest = request.trim()
    setGenerating(true)
    setImageError('')
    try {
      await imageProvider.editImage({ sourceImageUrl: drawing, request: editRequest, memory })
      const next = versions.length + 1
      setVersions((items) => [...items, {
        id: next, label: `${next}번째 다듬기`, request: editRequest, createdAt: '방금',
      }])
      setSelected(next)
      setRequest('')
    } catch {
      setImageError('이미지를 다시 펼치지 못했어. 한 번 더 눌러볼래?')
    } finally {
      setGenerating(false)
    }
  }

  const current = versions.find((version) => version.id === selected) || versions[0]
  const visualClass = /밤|어둡/.test(current.request) ? 'night' : /크게|커/.test(current.request) ? 'bigger' : ''

  return (
    <main className="visualize-page">
      <header className="conversation-header">
        <button className="icon-button" onClick={onBack}><ArrowLeft size={21} /></button>
        <Logo />
        <div className="progress-steps compact-progress">
          <span className="done"><Check size={13} /> 그림</span><i />
          <span className="done"><Check size={13} /> 이야기</span><i />
          <span className="current">3</span><b>함께 펼치기</b>
        </div>
        <button className="secondary-button compact">작품 저장하기</button>
      </header>

      <section className="visualize-intro">
        <span className="eyebrow"><Sparkles size={15} /> FROM YOUR IMAGINATION</span>
        <h1>네 그림에서 시작해서 <i>이렇게 펼쳐봤어</i></h1>
        <p>원래 그림은 그대로 소중히 간직했어.</p>
      </section>

      <section className="comparison">
        <article>
          <div className="image-title"><span>01</span><div><small>ORIGINAL</small><strong>내가 그린 그림</strong></div></div>
          <div className="comparison-frame original"><img src={drawing} alt="내가 그린 그림" /></div>
        </article>
        <div className="compare-spark"><Sparkles size={20} /></div>
        <article>
          <div className="image-title"><span>02</span><div><small>IMAGINED TOGETHER</small><strong>AI와 함께 펼친 그림</strong></div></div>
          <div className={`comparison-frame imagined ${visualClass}`}>
            <div className="generated-scene">
              <img src={drawing} alt="AI와 함께 펼친 그림" />
              <div className="scene-glow" />
              <span className="scene-star one">✦</span><span className="scene-star two">✦</span>
            </div>
            {generating && <div className="image-loading"><LoaderCircle className="spin" /><strong>네 생각을 그림으로 펼치는 중…</strong></div>}
          </div>
        </article>
      </section>

      <section className="edit-studio">
        <div className="edit-heading">
          <div><span>다음에는</span><h2>어디를 바꾸고 싶어?</h2></div>
          <div className="memory-summary">
            <small>계속 기억할게</small>
            <span>{memory.mainSubject || '네가 만든 친구'}</span>
            {memory.rejectedIdeas.length > 0 && <span>제외: {memory.rejectedIdeas.join(', ')}</span>}
          </div>
        </div>
        <div className="edit-input">
          <button className="mic-button" aria-label="음성 입력, 준비 중"><Mic size={21} /></button>
          <input
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') edit() }}
            placeholder="예: 바퀴를 더 크게 해줘"
          />
          <button className="primary-button compact" onClick={edit} disabled={!request.trim() || generating}>
            다시 펼치기 <Sparkles size={17} />
          </button>
        </div>
        <div className="suggestion-row">
          {['밤으로 바꿔줘', '주인공을 더 크게', '구름은 빼줘'].map((item) => (
            <button key={item} onClick={() => setRequest(item)}>{item}</button>
          ))}
        </div>
        {imageError && <p className="image-error" role="alert">{imageError}</p>}
      </section>

      <section className="version-strip">
        <button className="version-arrow" onClick={() => setSelected(Math.max(1, selected - 1))}><ChevronLeft /></button>
        <div className="versions">
          {versions.map((version) => (
            <button key={version.id} className={selected === version.id ? 'version active' : 'version'} onClick={() => setSelected(version.id)}>
              <span className="version-thumb"><img src={drawing} alt="" /></span>
              <span><b>V{version.id}</b><small>{version.request}</small></span>
              {selected === version.id && <Check size={15} />}
            </button>
          ))}
        </div>
        <button className="version-arrow" onClick={() => setSelected(Math.min(versions.length, selected + 1))}><ChevronRight /></button>
      </section>
    </main>
  )
}

export default function Root() {
  const [step, setStep] = useState<StudioStep>('start')
  const [drawing, setDrawing] = useState('')
  const [memory, setMemory] = useState<CreativeMemory>(EMPTY_MEMORY)
  const [provider, setProvider] = useState<ProviderKind>(() => {
    const saved = localStorage.getItem('imakers-provider')
    return saved === 'openai' || saved === 'anthropic' || saved === 'mock' ? saved : 'mock'
  })
  const clients = useMemo(() => createProviderClients(provider), [provider])

  const changeProvider = (next: ProviderKind) => {
    setProvider(next)
    localStorage.setItem('imakers-provider', next)
  }

  const useDrawing = (image: string) => {
    setDrawing(image)
    setStep('conversation')
  }

  if (step === 'draw') return <DrawingCanvas onComplete={useDrawing} onBack={() => setStep('start')} />
  if (step === 'conversation' && drawing) {
    return <Conversation drawing={drawing} aiProvider={clients.aiProvider} onBack={() => setStep('start')} onVisualize={(nextMemory) => { setMemory(nextMemory); setStep('visualize') }} />
  }
  if (step === 'visualize' && drawing) {
    return <Visualize drawing={drawing} memory={memory} imageProvider={clients.imageProvider} onBack={() => setStep('conversation')} />
  }
  return <StartScreen onDraw={() => setStep('draw')} onUpload={useDrawing} provider={provider} onProviderChange={changeProvider} />
}
