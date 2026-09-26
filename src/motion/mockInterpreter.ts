import type {
  AnimatedObject,
  MotionDirection,
  MotionIntensity,
  MotionInterpretation,
  MotionInterpreter,
  MotionSpeed,
  MotionType,
} from './types'

function pickType(text: string, fallback: MotionType): MotionType {
  if (/점프|뛰어|뛰었/.test(text)) return 'jump'
  if (/통통|바운스/.test(text)) return 'bounce'
  if (/흔들/.test(text)) return 'shake'
  if (/커졌다|작아졌다|커지고|줄어|크기/.test(text)) return 'grow-shrink'
  if (/날아|날았|비행/.test(text)) return 'fly'
  if (/돌아|회전|빙글/.test(text)) return 'rotate'
  if (/달려|움직|가게|이동/.test(text)) return 'move'
  return fallback
}

function pickSpeed(text: string, fallback: MotionSpeed): MotionSpeed {
  if (/더 빨|빠르게|빨리|쌩쌩/.test(text)) return 'fast'
  if (/천천히|느리게|조금 천천/.test(text)) return 'slow'
  if (/보통/.test(text)) return 'normal'
  return fallback
}

function pickDirection(text: string, fallback: MotionDirection): MotionDirection {
  if (/왼쪽/.test(text)) return 'left'
  if (/오른쪽/.test(text)) return 'right'
  if (/위로|높이/.test(text)) return 'up'
  if (/아래/.test(text)) return 'down'
  return fallback
}

function pickIntensity(text: string, fallback: MotionIntensity): MotionIntensity {
  if (/엄청|아주|더 높|크게|세게/.test(text)) return 'large'
  if (/조금|살짝|작게/.test(text)) return 'small'
  if (/보통/.test(text)) return 'medium'
  return fallback
}

export class MockMotionInterpreter implements MotionInterpreter {
  async interpret(
    text: string,
    currentMotion: AnimatedObject['motions'][number] | undefined,
    selectedObject: AnimatedObject,
  ): Promise<MotionInterpretation> {
    const fallback = currentMotion || {
      type: 'move',
      speed: 'normal',
      direction: 'right',
      intensity: 'medium',
    }
    const motion = {
      type: pickType(text, fallback.type),
      speed: pickSpeed(text, fallback.speed || 'normal'),
      direction: pickDirection(text, fallback.direction || 'right'),
      intensity: pickIntensity(text, fallback.intensity || 'medium'),
    }
    await new Promise((resolve) => window.setTimeout(resolve, 280))
    return {
      motion,
      explanation: `${selectedObject.label}의 움직임을 네 말에 맞게 바꿨어.`,
    }
  }
}

export const motionInterpreter: MotionInterpreter = new MockMotionInterpreter()
