import { useEffect, useState } from 'react'
import { api } from '../api.ts'

type Skill = {
  id: string
  name: string
  description: string
  stage: '새싹' | '나무' | '숲'
  expressions: string[]
  newExpressions: string[]
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<{ skills: Skill[] }>('/api/skills')
      .then((data) => setSkills(data.skills))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '기술을 불러오지 못했습니다.'))
  }, [])

  return (
    <section className="stack">
      <h1>쌓인 기술</h1>
      <p className="muted">새싹은 0~4개, 나무는 5~9개, 숲은 10개 이상입니다. 한 번 쌓인 표현은 줄지 않습니다.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {skills.map((skill) => (
        <article key={skill.id} className="card stack">
          <div className="row"><h2>{skill.name}</h2><span className="pill">{skill.stage}</span></div>
          <p>{skill.description}</p>
          <p>모은 표현 {skill.expressions.length}개</p>
          {skill.newExpressions.length > 0 && (
            <div>
              <h3>이번에 새로 쓴 표현</h3>
              <ul>{skill.newExpressions.map((expression) => <li key={expression}>{expression}</li>)}</ul>
            </div>
          )}
          {skill.expressions.length > 0 && <ul>{skill.expressions.map((expression) => <li key={expression}>{expression}</li>)}</ul>}
        </article>
      ))}
    </section>
  )
}
