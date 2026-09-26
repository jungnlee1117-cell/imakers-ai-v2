import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Eraser, PenLine, RotateCcw, Undo2 } from 'lucide-react'

const COLORS = ['#23372f', '#ec6a4b', '#f3b83f', '#79a86b', '#5b85c5', '#8c6bad']

interface DrawingCanvasProps {
  onComplete: (image: string) => void
  onBack: () => void
}

export function DrawingCanvas({ onComplete, onBack }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const history = useRef<ImageData[]>([])
  const [color, setColor] = useState(COLORS[0])
  const [eraser, setEraser] = useState(false)

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
    canvas.setPointerCapture(event.pointerId)
    const p = point(event)
    context.beginPath()
    context.moveTo(p.x, p.y)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const p = point(event)
    context.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    context.strokeStyle = color
    context.lineWidth = eraser ? 30 : 7
    context.lineTo(p.x, p.y)
    context.stroke()
  }

  const end = () => {
    drawing.current = false
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
      <header className="studio-header">
        <button className="text-button" onClick={onBack}>나가기</button>
        <div className="step-title">
          <span>01</span>
          <strong>네 생각을 자유롭게 그려봐</strong>
        </div>
        <button className="primary-button compact" onClick={complete}>
          다 그렸어요 <Check size={18} />
        </button>
      </header>

      <section className="canvas-shell">
        <div className="canvas-paper">
          <canvas
            ref={canvasRef}
            aria-label="그림 그리기 캔버스"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          <span className="canvas-hint">여기에 손가락이나 펜으로 그려봐</span>
        </div>

        <div className="tool-dock" aria-label="그리기 도구">
          <button className={!eraser ? 'tool active' : 'tool'} onClick={() => setEraser(false)} aria-label="펜">
            <PenLine size={21} />
            <span>펜</span>
          </button>
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
          <span className="tool-divider" />
          <button className={eraser ? 'tool active' : 'tool'} onClick={() => setEraser(true)}>
            <Eraser size={21} /><span>지우개</span>
          </button>
          <button className="tool" onClick={undo}><Undo2 size={21} /><span>되돌리기</span></button>
          <button className="tool" onClick={clear}><RotateCcw size={21} /><span>모두 지우기</span></button>
        </div>
      </section>
    </main>
  )
}
