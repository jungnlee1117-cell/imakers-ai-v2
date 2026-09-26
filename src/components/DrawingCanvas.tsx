import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Eraser, Home, Lightbulb, MoreHorizontal, PenLine, Redo2, Trash2, Undo2 } from 'lucide-react'

const COLORS = ['#252525', '#ff3b30', '#ff8a00', '#ffd000', '#38ae68', '#2d9cdb', '#6750df', '#9b65d4']

interface DrawingCanvasProps {
  onComplete: (image: string) => void
  onBack: () => void
}

export function DrawingCanvas({ onComplete, onBack }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const previousPoint = useRef<{ x: number; y: number } | null>(null)
  const history = useRef<ImageData[]>([])
  const [color, setColor] = useState(COLORS[0])
  const [eraser, setEraser] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const previous = canvas.width ? canvas.toDataURL() : null
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (previous) {
      const image = new Image()
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height)
      image.src = previous
    }
  }, [])

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [resizeCanvas])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    history.current.push(context.getImageData(0, 0, canvas.width, canvas.height))
    if (history.current.length > 20) history.current.shift()
    drawing.current = true
    if (!eraser) setHasDrawn(true)
    canvas.setPointerCapture(event.pointerId)
    const p = point(event)
    previousPoint.current = p
    context.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    context.beginPath()
    context.arc(p.x, p.y, eraser ? 15 : 3.5, 0, Math.PI * 2)
    context.fillStyle = color
    context.fill()
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    const from = previousPoint.current
    if (!context || !from) return
    const to = point(event)
    context.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    context.lineCap = 'round'
    if (eraser) {
      context.globalAlpha = 1
      context.strokeStyle = '#000'
      context.lineWidth = 30
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
    } else {
      const pressure = event.pressure > 0 ? event.pressure : 0.55
      context.strokeStyle = color
      context.globalAlpha = 0.48
      context.lineWidth = 5.5 + pressure * 3
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()

      for (let layer = 0; layer < 4; layer += 1) {
        const jitter = 2.2
        context.globalAlpha = 0.1 + Math.random() * 0.08
        context.lineWidth = 2 + Math.random() * 3
        context.beginPath()
        context.moveTo(from.x + (Math.random() - .5) * jitter, from.y + (Math.random() - .5) * jitter)
        context.lineTo(to.x + (Math.random() - .5) * jitter, to.y + (Math.random() - .5) * jitter)
        context.stroke()
      }
      context.globalAlpha = 1
    }
    previousPoint.current = to
  }

  const end = () => {
    drawing.current = false
    previousPoint.current = null
  }

  const undo = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const previous = history.current.pop()
    if (context && previous) context.putImageData(previous, 0, 0)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    history.current.push(context.getImageData(0, 0, canvas.width, canvas.height))
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const complete = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const context = exportCanvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#fffdf8'
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    context.drawImage(canvas, 0, 0)
    onComplete(exportCanvas.toDataURL('image/png'))
  }

  return (
    <main className="studio-page">
      <header className="draw-topbar">
        <button className="draw-home" onClick={onBack} aria-label="처음으로"><Home size={19} /></button>
        <div className="draw-logo"><b>아이메이커스</b><small>AI MAKERS</small></div>
        <div className="draw-progress">
          <span className="active"><b>1</b>그림 그리기</span><i />
          <span><b>2</b>이야기하기</span><i />
          <span><b>3</b>함께 만들기</span>
        </div>
        <div className="draw-bot">⌁<span>AI</span></div>
      </header>

      <section className="canvas-shell">
        <div className="draw-title">
          <span className="title-pencil">🖍️</span>
          <div><h1>네 생각을 그려볼래?</h1><p>자유롭게 그려보세요. 어떤 그림이든 좋아요!</p></div>
        </div>
        <div className="canvas-paper">
          <div className="canvas-actions">
            <button onClick={undo}><Undo2 size={18} /></button>
            <button disabled><Redo2 size={18} /></button>
            <button className="delete" onClick={clear}><Trash2 size={18} /></button>
            <button className="clear-label" onClick={clear}>전체 지우기</button>
          </div>
          <canvas
            ref={canvasRef}
            aria-label="그림 그리기 캔버스"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          {!hasDrawn && <span className="canvas-hint">크레파스로 쓱쓱, 네 생각을 그려봐</span>}
        </div>

        <div className="crayon-dock" aria-label="그리기 도구">
          <button className={!eraser ? 'tool active' : 'tool'} onClick={() => setEraser(false)} aria-label="크레파스">
            <PenLine size={20} />
          </button>
          <button className={eraser ? 'tool active' : 'tool'} onClick={() => setEraser(true)} aria-label="지우개"><Eraser size={20} /></button>
          <span className="dock-divider" />
          <div className="color-list">
            {COLORS.map((item) => (
              <button
                key={item}
                className={color === item && !eraser ? 'color active' : 'color'}
                style={{ background: item }}
                onClick={() => { setColor(item); setEraser(false) }}
                aria-label={`${item} 색상`}
              />
            ))}
          </div>
          <button className="tool more-tool" aria-label="더 많은 색"><MoreHorizontal size={19} /></button>
        </div>

        <div className="idea-strip">
          <button className="idea-label"><Lightbulb size={17} /> 예시 그림 보기</button>
          <div className="idea-cards">
            <button><span>🦖</span></button><button><span>🚀</span></button>
            <button><span>🏰</span></button><button><span>🧚</span></button><button><span>🚗</span></button>
          </div>
        </div>
        <button className="draw-complete" onClick={complete}>
          <Check size={20} /> 완료하고 AI에게 보여주기 <span>→</span>
        </button>
      </section>
    </main>
  )
}
