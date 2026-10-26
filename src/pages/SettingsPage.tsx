import { useEffect, useState, type FormEvent } from 'react'
import { api, type Session } from '../api.ts'

type Member = { userId: string; role: string; status: string; displayName: string; email: string }
type Assignment = { id: string; adminId: string; teacherId: string }

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) })
      setCurrent('')
      setNext('')
      setMessage('비밀번호를 바꿨습니다.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '바꾸지 못했습니다.')
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => { void submit(event) }}>
      <h2>비밀번호 변경</h2>
      <label>현재 비밀번호<input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} required autoComplete="current-password" /></label>
      <label>새 비밀번호 (8자 이상)<input type="password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
      {message && <p role="status" style={{ color: 'var(--green)' }}>{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div><button className="primary" type="submit">비밀번호 바꾸기</button></div>
    </form>
  )
}

function Permissions({ session }: { session: Session }) {
  const [members, setMembers] = useState<Member[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [m, a] = await Promise.all([
        api<{ members: Member[] }>('/api/team'),
        api<{ assignments: Assignment[] }>('/api/assignments'),
      ])
      setMembers(m.members)
      setAssignments(a.assignments)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '목록을 불러오지 못했습니다.')
    }
  }
  useEffect(() => { void load() }, [])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.')
    }
  }

  const others = members.filter((member) => member.userId !== session.user.id && member.status !== 'rejected')
  const teachers = members.filter((member) => member.role === 'teacher' && member.status === 'active')

  return (
    <div className="card stack">
      <h2>선생님 권한 설정</h2>
      <p className="muted small">관리자로 지정하면 담당으로 연결한 선생님들의 수업을 볼 수 있습니다. 대표는 모든 수업을 봅니다.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {others.length === 0 && <p className="muted">아직 가입한 선생님이 없습니다.</p>}
      {others.map((member) => (
        <div key={member.userId} className="stack" style={{ borderTop: '1px solid var(--line, #dde6e0)', paddingTop: 12 }}>
          <div className="row between">
            <div>
              <strong>{member.displayName}</strong>
              <div className="muted small">{member.email}</div>
            </div>
            {member.status === 'pending' ? (
              <div className="row">
                <button className="primary" onClick={() => { void run(() => api(`/api/memberships/${member.userId}/decision`, { method: 'POST', body: JSON.stringify({ status: 'active' }) })) }}>승인</button>
                <button className="ghost" onClick={() => { void run(() => api(`/api/memberships/${member.userId}/decision`, { method: 'POST', body: JSON.stringify({ status: 'rejected' }) })) }}>거절</button>
              </div>
            ) : member.role === 'representative' ? (
              <span className="pill">대표</span>
            ) : (
              <select
                value={member.role}
                onChange={(event) => { void run(() => api(`/api/memberships/${member.userId}/role`, { method: 'POST', body: JSON.stringify({ role: event.target.value }) })) }}
              >
                <option value="teacher">선생님</option>
                <option value="admin">관리자</option>
              </select>
            )}
          </div>
          {member.role === 'admin' && member.status === 'active' && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">담당 선생님</span>
              {teachers.length === 0 && <span className="small muted">연결할 선생님이 없습니다.</span>}
              {teachers.map((teacher) => {
                const link = assignments.find((item) => item.adminId === member.userId && item.teacherId === teacher.userId)
                return (
                  <label key={teacher.userId} className="check">
                    <input
                      type="checkbox"
                      checked={Boolean(link)}
                      onChange={() => {
                        void run(() => link
                          ? api(`/api/assignments/${link.id}`, { method: 'DELETE' })
                          : api('/api/assignments', { method: 'POST', body: JSON.stringify({ adminId: member.userId, teacherId: teacher.userId }) }))
                      }}
                    /> {teacher.displayName}
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function SettingsPage({ session }: { session: Session }) {
  return (
    <section className="stack" style={{ gap: 22 }}>
      <h1>설정</h1>
      <PasswordForm />
      {session.role === 'representative' && <Permissions session={session} />}
    </section>
  )
}
