import { ERASER_WIDTHS, STROKE_WIDTHS, type BrushPoint, type BrushSettings } from './types'

function segment(
  context: CanvasRenderingContext2D,
  from: BrushPoint,
  to: BrushPoint,
  width: number,
  alpha: number,
  offsetX = 0,
  offsetY = 0,
) {
  context.globalAlpha = alpha
  context.lineWidth = Math.max(.5, width)
  context.beginPath()
  context.moveTo(from.x + offsetX, from.y + offsetY)
  context.lineTo(to.x + offsetX, to.y + offsetY)
  context.stroke()
}

function textureLayers(
  context: CanvasRenderingContext2D,
  from: BrushPoint,
  to: BrushPoint,
  count: number,
  spread: number,
  width: number,
  alpha: number,
) {
  for (let index = 0; index < count; index += 1) {
    segment(
      context,
      from,
      to,
      width * (.35 + Math.random() * .45),
      alpha * (.55 + Math.random() * .7),
      (Math.random() - .5) * spread,
      (Math.random() - .5) * spread,
    )
  }
}

export function drawBrushStroke(
  context: CanvasRenderingContext2D,
  from: BrushPoint,
  to: BrushPoint,
  settings: BrushSettings,
) {
  const width = STROKE_WIDTHS[settings.strokeSize]
  const pressure = Math.min(1, Math.max(.15, to.pressure || .5))
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const elapsed = Math.max(1, to.time - from.time)
  const velocity = distance / elapsed

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = settings.color
  context.fillStyle = settings.color
  context.setLineDash([])

  if (settings.tool === 'eraser') {
    context.globalCompositeOperation = 'destination-out'
    segment(context, from, to, ERASER_WIDTHS[settings.eraserSize], 1)
    context.restore()
    return
  }

  context.globalCompositeOperation = 'source-over'

  if (settings.tool === 'pencil') {
    segment(context, from, to, width * (.52 + pressure * .28), .34)
    textureLayers(context, from, to, 3, 1.25, width * .34, .13)
  }

  if (settings.tool === 'colored-pencil') {
    segment(context, from, to, width * (.7 + pressure * .35), .58)
    textureLayers(context, from, to, 4, 1.7, width * .4, .18)
  }

  if (settings.tool === 'crayon') {
    context.setLineDash([Math.max(2, width * .72), Math.max(.7, width * .1)])
    context.lineDashOffset = Math.random() * width
    segment(context, from, to, width * (1.55 + pressure * .7), .34)
    context.setLineDash([])
    textureLayers(context, from, to, 8, width * .7, width * (.35 + pressure * .35), .13)
  }

  if (settings.tool === 'marker') {
    segment(context, from, to, width * (1 + pressure * .15), .9)
  }

  if (settings.tool === 'brush') {
    const speedFactor = Math.max(.58, 1.18 - velocity * .8)
    const brushWidth = width * (1.1 + pressure * .85) * speedFactor
    segment(context, from, to, brushWidth, .68)
    segment(context, from, to, brushWidth * .55, .24, -brushWidth * .08, 0)
  }

  context.restore()
}

export function drawBrushDot(
  context: CanvasRenderingContext2D,
  point: BrushPoint,
  settings: BrushSettings,
) {
  drawBrushStroke(context, point, { ...point, x: point.x + .12, y: point.y + .12 }, settings)
}
