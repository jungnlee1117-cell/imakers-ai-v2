import { Sparkles } from 'lucide-react'

export function MotionEntry() {
  return (
    <section className="motion-entry" aria-label="움직임 기능 상태">
      <div>
        <span><Sparkles size={16} /></span>
        <p>
          <strong>움직임 기능 준비 중</strong>
          <small>그림 속 친구를 정확히 찾는 기능을 준비하고 있어요.</small>
        </p>
      </div>
    </section>
  )
}
