export type DrawingTool = 'pencil' | 'colored-pencil' | 'crayon' | 'marker' | 'brush' | 'eraser'
export type StrokeSize = 'thin' | 'medium' | 'thick' | 'extra'
export type EraserSize = 'small' | 'medium' | 'large'

export interface BrushPoint {
  x: number
  y: number
  pressure: number
  time: number
}

export interface BrushSettings {
  tool: DrawingTool
  color: string
  strokeSize: StrokeSize
  eraserSize: EraserSize
}

export const STROKE_WIDTHS: Record<StrokeSize, number> = {
  thin: 2.5,
  medium: 5,
  thick: 9,
  extra: 15,
}

export const ERASER_WIDTHS: Record<EraserSize, number> = {
  small: 16,
  medium: 34,
  large: 64,
}
