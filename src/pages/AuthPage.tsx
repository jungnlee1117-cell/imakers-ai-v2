import { useState, type FormEvent } from 'react'
import { api } from '../api.ts'

export default function AuthPage({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (!signup) {
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      } else {
        await api('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            displayName,
            mode: 'gts_request',
          }),
        })
      }
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '들어가지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="box" onSubmit={(event) => { void submit(event) }}>
        <div>
          <h1>{signup ? '가입하기' : '로그인'}</h1>
          <p className="sub small">{signup ? '이메일 주소가 아이디가 됩니다. 비밀번호는 8자 이상입니다.' : '수업 녹음을 올리면 코칭 카드가 만들어집니다.'}</p>
        </div>

        {signup && (
          <label>이름<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required autoComplete="name" /></label>
        )}

        <label>아이디
          <input value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" placeholder="이메일 주소" inputMode="email" autoCapitalize="none" />
        </label>
        <label>비밀번호
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} />
        </label>

        {signup && (
          <label className="check"><input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} required /> 수업 녹음을 올리고 분석하는 데 동의합니다.</label>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary big" type="submit" disabled={busy}>{signup ? '가입하기' : '로그인'}</button>

        <div className="signup-toggle">
          <button type="button" className="link" onClick={() => { setSignup(!signup); setError(null) }}>
            {signup ? '이미 아이디가 있어요' : '처음이세요? 가입하기'}
          </button>
        </div>
      </form>
    </main>
  )
}
