import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Home, Redo2, Trash2, Undo2 } from 'lucide-react'
import { drawBrushDot, drawBrushStroke } from '../drawing/brushEngine'
import {
  type BrushPoint,
  type DrawingTool,
  type EraserSize,
  type StrokeSize,
} from '../drawing/types'

const COLORS = [
  '#f04b57', '#ff7b24', '#ffc52e', '#18b96c',
  '#7358df', '#2e9edf', '#8b5ae0', '#ef78a7',
  '#a65a1c', '#222222', '#8b8b8b', '#fffdf8',
]

const TOOLS: Array<{ id: DrawingTool; icon: string; label: string }> = [
  { id: 'pencil', icon: '✎', label: '연필' },
  { id: 'crayon', icon: '▰', label: '크레파스' },
  { id: 'marker', icon: '▮', label: '사인펜' },
  { id: 'brush', icon: '◒', label: '붓' },
  { id: 'eraser', icon: '◇', label: '지우개' },
]

const STROKE_SIZES: Array<{ id: StrokeSize; label: string; dot: number }> = [
  { id: 'thin', label: '가늘게', dot: 4 },
  { id: 'medium', label: '보통', dot: 7 },
  { id: 'thick', label: '굵게', dot: 11 },
  { id: 'extra', label: '아주 굵게', dot: 15 },
]

const ERASER_SIZES: Array<{ id: EraserSize; label: string; dot: number }> = [
  { id: 'small', label: '작게', dot: 8 },
  { id: 'medium', label: '중간', dot: 13 },
  { id: 'large', label: '크게', dot: 19 },
]

interface DrawingStudioProps {
  onComplete: (image: string) => void
  onBack: () => void
}

export function DrawingStudio({ onComplete, onBack }: DrawingStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const previousPoint = useRef<BrushPoint | null>(null)
  const history = useRef<ImageData[]>([])
  const future = useRef<ImageData[]>([])
  const lastDrawingTool = useRef<DrawingTool>('crayon')

  const [tool, setTool] = useState<DrawingTool>('crayon')
  const [color, setColor] = useState(COLORS[0])
  const [strokeSize, setStrokeSize] = useState<StrokeSize>('medium')
  const [eraserSize, setEraserSize] = useState<EraserSize>('medium')
  const [hasDrawn, setHasDrawn] = useState(false)
  const [historyState, setHistoryState] = useState({ undo: false, redo: false })

  const settings = useMemo(() => ({ tool, color, strokeSize, eraserSize }), [tool, color, strokeSize, eraserSize])

  const updateHistoryState = () => {
    setHistoryState({ undo: history.current.length > 0, redo: future.current.length > 0 })
  }

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const previous = canvas.width ? canvas.toDataURL() : null
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(rect.width * ratio)
    canvas.height = Math.floor(rect.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (previous) {
      const image = new Image()
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height)
      image.src = previous
    }
    history.current = []
    future.current = []
    updateHistoryState()
  }, [])

  useEffect(() => {
    resizeCanvas()
    const observer = new ResizeObserver(resizeCanvas)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [resizeCanvas])

  const pointFrom = (event: PointerEvent, rect: DOMRect): BrushPoint => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pointerType === 'mouse' ? .55 : Math.max(.15, event.pressure),
    time: event.timeStamp,
  })

  const saveForUndo = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    history.current.push(context.getImageData(0, 0, canvas.width, canvas.height))
    if (history.current.length > 30) history.current.shift()
    future.current = []
    updateHistoryState()
  }

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    event.preventDefault()
    saveForUndo()
    drawing.current = true
    canvas.setPointerCapture(event.pointerId)
    const point = pointFrom(event.nativeEvent, canvas.getBoundingClientRect())
    previousPoint.current = point
    drawBrushDot(context, point, settings)
    if (tool !== 'eraser') setHasDrawn(true)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !previousPoint.current) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const nativeEvents = event.nativeEvent.getCoalescedEvents?.() || [event.nativeEvent]
    for (const nativeEvent of nativeEvents) {
      const next = pointFrom(nativeEvent, rect)
      drawBrushStroke(context, previousPoint.current, next, settings)
      previousPoint.current = next
    }
  }

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false
    previousPoint.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    updateHistoryState()
  }

  const restore = (snapshot: ImageData) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.putImageData(snapshot, 0, 0)
    context.restore()
  }

  const undo = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const previous = history.current.pop()
    if (!canvas || !context || !previous) return
    future.current.push(context.getImageData(0, 0, canvas.width, canvas.height))
    restore(previous)
    setHasDrawn(history.current.length > 0)
    updateHistoryState()
  }

  const redo = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const next = future.current.pop()
    if (!canvas || !context || !next) return
    history.current.push(context.getImageData(0, 0, canvas.width, canvas.height))
    restore(next)
    setHasDrawn(true)
    updateHistoryState()
  }

  const clear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !hasDrawn) return
    saveForUndo()
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.restore()
    setHasDrawn(false)
    updateHistoryState()
  }

  const chooseTool = (next: DrawingTool) => {
    setTool(next)
    if (next !== 'eraser') lastDrawingTool.current = next
  }

  const chooseColor = (next: string) => {
    setColor(next)
    setTool(lastDrawingTool.current)
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
        <div className="draw-logo"><b>아이메이커스</b><small>AI MAKERS</small></div>
        <div className="draw-progress">
          <span className="active"><b>1</b>그림 그리기</span><i />
          <span><b>2</b>이야기하기</span><i />
          <span><b>3</b>함께 만들기</span>
        </div>
        <div className="draw-header-actions">
          <button className="draw-home wide" onClick={onBack}><Home size={17} /><span>처음으로</span></button>
          <button className="header-complete" onClick={complete}><Check size={18} /> 완료하고 AI에게 보여주기 <span>→</span></button>
        </div>
      </header>

      <section className="reference-studio">
        <aside className="material-dock" aria-label="그리기 도구">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              className={tool === item.id ? 'material-tool active' : 'material-tool'}
              onClick={() => chooseTool(item.id)}
            >
              <span aria-hidden="true">{item.icon}</span><b>{item.label}</b>
            </button>
          ))}
        </aside>

        <div className="canvas-paper">
          <canvas
            ref={canvasRef}
            aria-label="그림 그리기 캔버스"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          {!hasDrawn && <span className="canvas-hint">좋아하는 도구를 골라서 시작해봐</span>}
        </div>

        <aside className="settings-panel">
          <div className="setting-card color-card">
            <strong>색상 선택</strong>
            <div className="settings-colors">
              {COLORS.map((item) => (
                <button
                  key={item}
                  className={color === item && tool !== 'eraser' ? 'color active' : 'color'}
                  style={{ background: item }}
                  onClick={() => chooseColor(item)}
                  aria-label={`${item} 색상`}
                />
              ))}
            </div>
          </div>

          <div className="setting-card stroke-card">
            <strong>굵기 조절</strong>
            <div className="stroke-sample" aria-hidden="true">〰</div>
            <div className="settings-sizes">
              {STROKE_SIZES.map((item) => (
                <button key={item.id} className={strokeSize === item.id ? 'size-button active' : 'size-button'} onClick={() => { setStrokeSize(item.id); if (tool === 'eraser') setTool(lastDrawingTool.current) }} aria-label={item.label}>
                  <i style={{ width: item.dot, height: item.dot }} />
                </button>
              ))}
            </div>
          </div>

          <div className="setting-card eraser-card">
            <strong>지우개 크기</strong>
            <div className="eraser-options">
              {ERASER_SIZES.map((item) => (
                <button key={item.id} className={eraserSize === item.id && tool === 'eraser' ? 'eraser-option active' : 'eraser-option'} onClick={() => { setEraserSize(item.id); setTool('eraser') }}>
                  <i style={{ width: item.dot + 9, height: item.dot + 9 }} /><span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="reference-bottom">
          <div className="history-dock">
            <button onClick={undo} disabled={!historyState.undo} aria-label="되돌리기"><Undo2 size={21} /><span>되돌리기</span></button>
            <button onClick={redo} disabled={!historyState.redo} aria-label="다시 실행"><Redo2 size={21} /><span>다시하기</span></button>
            <button className="delete" onClick={clear} disabled={!hasDrawn} aria-label="전체 지우기"><Trash2 size={21} /><span>전체 지우기</span></button>
          </div>
          <div className="quick-tools">
            <small>지금 고른 도구로 이렇게 그려져요!</small>
            {TOOLS.filter((item) => item.id !== 'eraser').map((item) => (
              <button key={item.id} className={tool === item.id ? `quick-${item.id} active` : `quick-${item.id}`} onClick={() => chooseTool(item.id)}>
                <i /><span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
