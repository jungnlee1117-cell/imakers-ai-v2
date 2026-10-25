import { useEffect, useState } from 'react'
import { api, go } from '../api.ts'
import { statusLabel } from '../format.ts'

type Teacher = {
  id: string
  displayName: string
  email: string
  lastUploadAt: string | null
  uploadedWithin30Days: boolean
  latestDoneUploadId: string | null
  latestStatus: string | null
  skills: Array<{ id: string; name: string; stage: string }>
}
type Member = { userId: string; role: string; status: string; displayName: string; email: string }

export default function TeachersPage({ role }: { role: string }) {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [adminId, setAdminId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [retentionDays, setRetentionDays] = useState('365')
  const [invite, setInvite] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [teacherData, memberData] = await Promise.all([
      api<{ teachers: Teacher[] }>('/api/teachers'),
      api<{ members: Member[] }>('/api/members'),
    ])
    setTeachers(teacherData.teachers)
    setMembers(memberData.members)
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '목록을 불러오지 못했습니다.'))
  }, [])

  const visible = teachers.filter((teacher) => !onlyMissing || !teacher.uploadedWithin30Days)
  const admins = members.filter((member) => member.role === 'admin' && member.status === 'active')
  const pending = members.filter((member) => member.status === 'pending')

  return (
    <section className="stack">
      <h1>선생님 목록</h1>
      <p className="muted">관리자는 담당 선생님만 봅니다. 녹음 재생도 담당 선생님만 됩니다. 이름은 가나다순입니다.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <label className="row"><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} /> 최근 30일 동안 올리지 않은 선생님</label>
      {visible.length === 0 && <p className="muted">보이는 선생님이 없습니다.</p>}
      {visible.map((teacher) => (
        <article key={teacher.id} className="card stack">
          <strong>{teacher.displayName}</strong>
          <span className="muted">{teacher.email}</span>
          <span>{teacher.uploadedWithin30Days ? '최근 30일 안에 올렸습니다' : '최근 30일 동안 올린 녹음이 없습니다'}</span>
          {teacher.latestStatus && <span>최근 상태 {statusLabel(teacher.latestStatus)}</span>}
          <span>{teacher.skills.map((skill) => `${skill.name} ${skill.stage}`).join(' · ') || '쌓인 표현이 없습니다'}</span>
          {teacher.latestDoneUploadId && <button className="primary" onClick={() => go(`/cards/${teacher.latestDoneUploadId}`)}>카드 열기</button>}
        </article>
      ))}
      {role === 'representative' && (
        <section className="panel stack">
          <h2>승인 · 초대 · 담당</h2>
          {pending.map((member) => (
            <div key={member.userId} className="row">
              <span>{member.displayName}</span>
              <button className="primary" onClick={() => { void api(`/api/memberships/${member.userId}/decision`, { method: 'POST', body: JSON.stringify({ status: 'active' }) }).then(load) }}>승인</button>
              <button className="ghost" onClick={() => { void api(`/api/memberships/${member.userId}/decision`, { method: 'POST', body: JSON.stringify({ status: 'rejected' }) }).then(load) }}>거절</button>
            </div>
          ))}
          <button className="ghost" onClick={() => { void api<{ code: string }>('/api/invites', { method: 'POST', body: JSON.stringify({ role: 'teacher' }) }).then((data) => setInvite(data.code)) }}>선생님 초대 코드</button>
          <button className="ghost" onClick={() => { void api<{ code: string }>('/api/invites', { method: 'POST', body: JSON.stringify({ role: 'admin' }) }).then((data) => setInvite(data.code)) }}>관리자 초대 코드</button>
          {invite && <p>초대 코드 {invite}</p>}
          <label>관리자
            <select value={adminId} onChange={(event) => setAdminId(event.target.value)}>
              <option value="">선택</option>
              {admins.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
            </select>
          </label>
          <label>선생님
            <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
              <option value="">선택</option>
              {members.filter((member) => member.role === 'teacher' && member.status === 'active').map((member) => (
                <option key={member.userId} value={member.userId}>{member.displayName}</option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!adminId || !teacherId} onClick={() => { void api('/api/assignments', { method: 'POST', body: JSON.stringify({ adminId, teacherId }) }).then(load) }}>담당 연결</button>
          <label>앞으로 올릴 녹음의 보관 일수
            <input value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} />
          </label>
          <button className="ghost" onClick={() => { void api('/api/retention', { method: 'POST', body: JSON.stringify({ retentionDays: Number(retentionDays) }) }) }}>보관 기간 저장</button>
          <p className="muted">이미 올라간 녹음의 만료일은 바꾸지 않습니다. 카드의 비교 기준은 카드 JSON 안에 있습니다.</p>
        </section>
      )}
    </section>
  )
}
