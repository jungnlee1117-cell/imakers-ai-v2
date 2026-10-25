import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api.ts'

type DirectoryOrg = { id: string; name: string; billingTier: string }

export default function AuthPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'create_org' | 'invite' | 'gts_request'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [orgs, setOrgs] = useState<DirectoryOrg[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<{ organizations: DirectoryOrg[] }>('/api/directory/organizations').then((data) => setOrgs(data.organizations)).catch(() => undefined)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      if (mode === 'login') {
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      } else {
        await api('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            displayName,
            mode,
            organizationName: organizationName || undefined,
            inviteCode: inviteCode || undefined,
          }),
        })
      }
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '가입하지 못했습니다.')
    }
  }

  return (
    <main className="page">
      <section className="panel stack">
        <h1>수업 코칭</h1>
        <p className="muted">이메일로 가입합니다. 구글·카카오 로그인은 두지 않습니다. 결제는 연결되어 있지 않습니다.</p>
        <p>GTS는 무료이며 초대 또는 승인된 사람만 들어옵니다. 그 밖 소속은 직접 만들 수 있고 유료로 표시됩니다.</p>
        {orgs.length > 0 && <p className="muted">참여 요청을 받는 소속: {orgs.map((org) => org.name).join(', ')}</p>}
        <div className="row">
          <button className={mode === 'login' ? 'primary' : 'ghost'} onClick={() => setMode('login')}>로그인</button>
          <button className={mode === 'create_org' ? 'primary' : 'ghost'} onClick={() => setMode('create_org')}>새 소속</button>
          <button className={mode === 'invite' ? 'primary' : 'ghost'} onClick={() => setMode('invite')}>초대 코드</button>
          <button className={mode === 'gts_request' ? 'primary' : 'ghost'} onClick={() => setMode('gts_request')}>GTS 참여 요청</button>
        </div>
        <form className="stack" onSubmit={(event) => { void submit(event) }}>
          {mode !== 'login' && <label>이름<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>}
          <label>이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'login' ? 1 : 8} /></label>
          {mode === 'create_org' && <label>소속 이름<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>}
          {mode === 'invite' && <label>초대 코드<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required /></label>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" type="submit">{mode === 'login' ? '로그인' : '가입하기'}</button>
        </form>
      </section>
    </main>
  )
}
