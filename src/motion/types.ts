export type MotionType = 'move' | 'jump' | 'bounce' | 'shake' | 'grow-shrink' | 'fly' | 'rotate'
export type MotionSpeed = 'slow' | 'normal' | 'fast'
export type MotionDirection = 'left' | 'right' | 'up' | 'down'
export type MotionIntensity = 'small' | 'medium' | 'large'

export interface SourceRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface MotionSpec {
  type: MotionType
  speed?: MotionSpeed
  direction?: MotionDirection
  intensity?: MotionIntensity
}

export interface AnimatedObject {
  id: string
  label: string
  sourceRegion?: SourceRegion
  motions: MotionSpec[]
}

export interface MotionInterpretation {
  motion: MotionSpec
  explanation: string
}

export interface MotionInterpreter {
  interpret(
    text: string,
    currentMotion: MotionSpec | undefined,
    selectedObject: AnimatedObject,
  ): Promise<MotionInterpretation>
}
