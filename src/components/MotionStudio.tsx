import { useMemo, useState } from 'react'
import { ArrowLeft, Check, MoveRight, Play, Send, Sparkles } from 'lucide-react'
import { motionInterpreter } from '../motion/mockInterpreter'
import type {
  AnimatedObject,
  MotionDirection,
  MotionIntensity,
  MotionSpec,
  MotionSpeed,
  MotionType,
} from '../motion/types'
import type { CreativeMemory } from '../types/creative'

const PRESETS: Array<{ type: MotionType; icon: string; label: string }> = [
  { type: 'move', icon: '→', label: '움직이기' },
  { type: 'jump', icon: '↥', label: '점프' },
  { type: 'bounce', icon: '⌁', label: '통통 튀기' },
  { type: 'shake', icon: '〰', label: '흔들기' },
  { type: 'grow-shrink', icon: '⤢', label: '커졌다 작아지기' },
  { type: 'fly', icon: '⌁', label: '날기' },
  { type: 'rotate', icon: '↻', label: '빙글 돌기' },
]

const SPEEDS: Array<{ id: MotionSpeed; label: string }> = [
  { id: 'slow', label: '천천히' }, { id: 'normal', label: '보통' }, { id: 'fast', label: '빠르게' },
]
const DIRECTIONS: Array<{ id: MotionDirection; label: string }> = [
  { id: 'left', label: '왼쪽' }, { id: 'right', label: '오른쪽' }, { id: 'up', label: '위' }, { id: 'down', label: '아래' },
]
const INTENSITIES: Array<{ id: MotionIntensity; label: string }> = [
  { id: 'small', label: '작게' }, { id: 'medium', label: '보통' }, { id: 'large', label: '크게' },
]

function initialObjects(memory: CreativeMemory): AnimatedObject[] {
  return [
    {
      id: 'main',
      label: memory.mainSubject || '그림 속 주인공',
      sourceRegion: { x: 10, y: 16, width: 68, height: 70 },
      motions: [],
    },
    {
      id: 'sky',
      label: '하늘과 구름',
      sourceRegion: { x: 42, y: 0, width: 58, height: 38 },
      motions: [],
    },
    {
      id: 'world',
      label: '배경의 특별한 곳',
      sourceRegion: { x: 58, y: 32, width: 42, height: 68 },
      motions: [],
    },
  ]
}

function layerStyle(object: AnimatedObject) {
  const region = object.sourceRegion
  if (!region) return undefined
  return {
    clipPath: `inset(${region.y}% ${100 - region.x - region.width}% ${100 - region.y - region.height}% ${region.x}%)`,
  }
}

export function MotionStudio({
  image,
  memory,
  onBack,
}: {
  image: string
  memory: CreativeMemory
  onBack: () => void
}) {
  const [objects, setObjects] = useState<AnimatedObject[]>(() => initialObjects(memory))
  const [selectedId, setSelectedId] = useState('main')
  const [request, setRequest] = useState('')
  const [feedback, setFeedback] = useState('움직이고 싶은 대상을 먼저 골라봐.')
  const [interpreting, setInterpreting] = useState(false)

  const selected = useMemo(
    () => objects.find((object) => object.id === selectedId) || objects[0],
    [objects, selectedId],
  )
  const motion = selected.motions[0]

  const updateMotion = (next: MotionSpec) => {
    setObjects((items) => items.map((object) => object.id === selectedId ? { ...object, motions: [next] } : object))
  }

  const choosePreset = (type: MotionType) => {
    updateMotion({
      type,
      speed: motion?.speed || 'normal',
      direction: motion?.direction || (type === 'jump' || type === 'fly' ? 'up' : 'right'),
      intensity: motion?.intensity || 'medium',
    })
    setFeedback(`${selected.label}에게 움직임을 넣었어. 아래에서 느낌을 바꿔볼 수 있어.`)
  }

  const updateParameter = (patch: Partial<MotionSpec>) => {
    updateMotion({
      type: motion?.type || 'move',
      speed: motion?.speed || 'normal',
      direction: motion?.direction || 'right',
      intensity: motion?.intensity || 'medium',
      ...patch,
    })
  }

  const interpret = async () => {
    const text = request.trim()
    if (!text || interpreting) return
    setInterpreting(true)
    const result = await motionInterpreter.interpret(text, motion, selected)
    updateMotion(result.motion)
    setFeedback(result.explanation)
    setRequest('')
    setInterpreting(false)
  }

  return (
    <main className="motion-page">
      <header className="motion-header">
        <button className="icon-button" onClick={onBack} aria-label="확장 이미지로 돌아가기"><ArrowLeft size={20} /></button>
        <div className="logo-mark"><span>i</span><strong>아이메이커스</strong><em>AI</em></div>
        <div className="motion-step"><Play size={13} fill="currentColor" /> MOTION STUDIO</div>
        <span className="motion-safe">먼저 내 그림이 움직이는 걸 살펴봐요</span>
      </header>

      <section className="motion-intro">
        <span className="eyebrow"><Sparkles size={14} /> MAKE IT MOVE</span>
        <h1>어떤 부분이 움직였으면 좋겠어?</h1>
        <p>그림 속 대상을 고르고, 움직임을 하나 붙여봐.</p>
      </section>

      <div className="motion-layout">
        <section className="motion-preview-panel">
          <div className="motion-canvas">
            <img className="motion-base" src={image} alt="움직임을 적용할 그림" />
            {objects.filter((object) => object.motions[0]).map((object) => {
              const item = object.motions[0]
              return (
                <div
                  key={object.id}
                  className={`motion-layer motion-${item.type} speed-${item.speed} direction-${item.direction} intensity-${item.intensity}`}
                  style={layerStyle(object)}
                >
                  <img src={image} alt="" />
                </div>
              )
            })}
            <div className="object-pins">
              {objects.map((object, index) => (
                <button
                  key={object.id}
                  className={selectedId === object.id ? `pin pin-${index + 1} active` : `pin pin-${index + 1}`}
                  onClick={() => { setSelectedId(object.id); setFeedback(`${object.label}을 골랐어. 어떻게 움직일까?`) }}
                >
                  <span>{selectedId === object.id ? <Check size={11} /> : index + 1}</span>{object.label}
                </button>
              ))}
            </div>
          </div>
          <div className="motion-coach-note"><Sparkles size={16} /><span>{feedback}</span></div>
        </section>

        <aside className="motion-controls">
          <div className="selected-object">
            <span>지금 고른 부분</span><strong>{selected.label}</strong>
          </div>

          <div className="motion-section">
            <h2>어떻게 움직일까?</h2>
            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button
                  key={preset.type}
                  className={motion?.type === preset.type ? 'active' : ''}
                  onClick={() => choosePreset(preset.type)}
                >
                  <span>{preset.icon}</span><b>{preset.label}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="motion-section natural-motion">
            <h2>말로 바꿔도 좋아</h2>
            <div>
              <input
                value={request}
                onChange={(event) => setRequest(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') interpret() }}
                placeholder="예: 더 높이 뛰어"
              />
              <button onClick={interpret} disabled={!request.trim() || interpreting} aria-label="움직임 요청 보내기"><Send size={17} /></button>
            </div>
            <small>“더 빨리” · “왼쪽으로” · “엄청 크게 흔들어”</small>
          </div>

          <div className="motion-section parameter-section">
            <h2>움직이는 느낌</h2>
            <ParameterRow label="빠르기" values={SPEEDS} current={motion?.speed || 'normal'} onChange={(value) => updateParameter({ speed: value as MotionSpeed })} />
            <ParameterRow label="방향" values={DIRECTIONS} current={motion?.direction || 'right'} onChange={(value) => updateParameter({ direction: value as MotionDirection })} />
            <ParameterRow label="크기" values={INTENSITIES} current={motion?.intensity || 'medium'} onChange={(value) => updateParameter({ intensity: value as MotionIntensity })} />
          </div>
        </aside>
      </div>

      <footer className="motion-footer">
        <MoveRight size={18} />
        <p><strong>움직이는 모습을 보니까 뭐가 더 하고 싶어?</strong><span>지금은 그림의 움직임을 충분히 살펴보는 시간이에요.</span></p>
      </footer>
    </main>
  )
}

function ParameterRow({
  label,
  values,
  current,
  onChange,
}: {
  label: string
  values: Array<{ id: string; label: string }>
  current: string
  onChange: (value: string) => void
}) {
  return (
    <div className="parameter-row">
      <span>{label}</span>
      <div>{values.map((value) => (
        <button key={value.id} className={current === value.id ? 'active' : ''} onClick={() => onChange(value.id)}>{value.label}</button>
      ))}</div>
    </div>
  )
}
