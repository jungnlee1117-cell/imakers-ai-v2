export type LanguageMode = 'english' | 'korean' | 'mixed'
export type MediaSource = 'video' | 'audio'
export type SkillId = 'praise' | 'rule_as_question' | 'child_care'

export type FlowSegment = {
  start_sec: number
  end_sec: number
  label: string
  kind: 'main' | 'normal' | 'control'
}

export type EnglishItem = {
  at_sec: number
  heard: string
  suggested: string
  reason: string
  type: 'error' | 'tip' | 'check'
}

export type Scene = {
  title: string
  at_sec: number[]
  text: string
}

export type Metric = {
  id: string
  label: string
  value: number
  unit: string
  better: 'up' | 'down'
  tolerance: number
  sub?: string
  compare: boolean
}

export type PracticeItem = {
  id: string
  say: string
  why: string
  is_task: boolean
}

export type SkillEvent = {
  skill_id: SkillId
  expression: string
  at_sec: number
}

export type ReviewArea = 'flow' | 'english' | 'interaction' | 'discipline' | 'safety' | 'plan'

export type ReviewEvidence = {
  at_sec: number
  quote: string
}

export type ReviewExample = {
  say: string
  why: string
}

export type ReviewFinding = {
  title: string
  text: string
  evidence: ReviewEvidence[]
  example?: ReviewExample
}

export type AreaReview = {
  area: ReviewArea
  good: ReviewFinding[]
  improve: Array<ReviewFinding & { example: ReviewExample }>
}

export type PlanAdherence =
  | { status: 'not_linked' }
  | {
      status: 'done'
      planned?: string[]
      actual?: string[]
      missing?: string[]
      note?: string
    }

/** 처리 부분이 앱에 넘기는 카드 한 장. 화면은 이 객체만 읽는다. */
export type CardDocument = {
  schema_version: '1.0' | '1.1'
  area_reviews?: AreaReview[]
  lesson: {
    date: string
    class_name: string
    sport: string
    language_mode: LanguageMode
    duration_sec: number
    source: MediaSource
  }
  flow: {
    lead: string
    note: string
    segments: FlowSegment[]
  }
  english_phrases?: {
    note: string
    items: EnglishItem[]
  }
  interaction: {
    good: Scene[]
    improve: Scene[]
  }
  plan_adherence?: PlanAdherence
  metrics: Metric[]
  excluded_lines: { at_sec: number; reason: string }[]
  practice: PracticeItem[]
  skill_events: SkillEvent[]
}

export type TranscriptLineOut = {
  start_sec: number
  text: string
  trusted: boolean
}

export type ProcessorInput = {
  audioPath: string
  sport: string
  languageMode: LanguageMode
  planText: string | null
  lessonDate: string
  className: string
  source: MediaSource
  /** ffprobe 로 읽은 길이(초). 못 읽으면 null */
  durationSec: number | null
  /** 아이 이름 가리기에서 빼야 하는 선생님 표시 이름 */
  teacherName: string | null
}

export type ProcessorOutput = {
  card: CardDocument
  transcript_lines: TranscriptLineOut[]
}

export interface LessonProcessor {
  readonly id: string
  process(input: ProcessorInput): Promise<ProcessorOutput>
}
