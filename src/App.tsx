import { useEffect, useState } from 'react'
import { api, go, setUnauthorizedHandler, type Session } from './api.ts'
import { billingLabel, roleLabel } from './format.ts'
import AccessPage from './pages/AccessPage.tsx'
import AuthPage from './pages/AuthPage.tsx'
import CardPage from './pages/CardPage.tsx'
import ChangesPage from './pages/ChangesPage.tsx'
import HomePage from './pages/HomePage.tsx'
import PlansPage from './pages/PlansPage.tsx'
import PracticePage from './pages/PracticePage.tsx'
import SkillsPage from './pages/SkillsPage.tsx'
import TeachersPage from './pages/TeachersPage.tsx'
import UploadPage from './pages/UploadPage.tsx'

function pathOf() {
  return (window.location.hash.replace(/^#/, '') || '/').split('?')[0]
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [route, setRoute] = useState(pathOf())

  async function refresh() {
    try {
      setSession(await api<Session>('/api/me'))
    } catch {
      setSession(null)
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null))
    void refresh()
    const onHash = () => setRoute(pathOf())
    window.addEventListener('hashchange', onHash)
    return () => {
      setUnauthorizedHandler(null)
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  if (!ready) return <main className="page">불러오는 중</main>
  if (!session) return <AuthPage onDone={() => { go('/'); void refresh() }} />

  const role = session.role
  const activeMemberships = session.memberships.filter((item) => item.status === 'active')

  return (
    <>
      <header className="app-header">
        <div>
          <div className="brand">수업 코칭</div>
          <div className="muted">
            {session.organization?.name} · {roleLabel(role ?? '')}
            {session.organization ? ` · ${billingLabel(session.organization.billingTier)}` : ''}
            {session.organization?.billingTier === 'paid' ? ' · 결제 연결 없음' : ''}
          </div>
        </div>
        <div className="row">
          {activeMemberships.length > 1 && (
            <select
              value={session.organization?.id}
              onChange={(event) => {
                void api('/api/session/organization', {
                  method: 'POST',
                  body: JSON.stringify({ organizationId: event.target.value }),
                }).then(() => refresh())
              }}
            >
              {activeMemberships.map((item) => (
                <option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>
              ))}
            </select>
          )}
          <button className="ghost" onClick={() => { void api('/api/auth/logout', { method: 'POST' }).then(() => refresh()) }}>로그아웃</button>
        </div>
      </header>
      {role === 'pending' ? (
        <main className="page">
          <section className="panel">
            <h1>승인 대기</h1>
            <p>GTS 소속은 대표가 초대하거나 승인한 뒤에 들어올 수 있습니다.</p>
          </section>
        </main>
      ) : (
        <>
          <nav className="page">
            {role === 'teacher' && (
              <>
                <a href="#/">홈</a>
                <a href="#/upload">업로드</a>
                <a href="#/plans">계획안</a>
                <a href="#/practice">오늘의 연습</a>
                <a href="#/skills">쌓인 기술</a>
                <a href="#/changes">변화 보기</a>
              </>
            )}
            {(role === 'representative' || role === 'admin') && <a href="#/teachers">선생님 목록</a>}
            {role === 'representative' && <a href="#/access">열람 내역</a>}
          </nav>
          <main className="page">
            {route.startsWith('/cards/') && <CardPage id={route.slice('/cards/'.length)} role={role ?? ''} onChanged={refresh} />}
            {route === '/' && role === 'teacher' && <HomePage />}
            {route === '/upload' && role === 'teacher' && <UploadPage session={session} onUploaded={refresh} />}
            {route === '/plans' && role === 'teacher' && <PlansPage />}
            {route === '/practice' && role === 'teacher' && <PracticePage />}
            {route === '/skills' && role === 'teacher' && <SkillsPage />}
            {route === '/changes' && role === 'teacher' && <ChangesPage />}
            {route === '/teachers' && (role === 'representative' || role === 'admin') && <TeachersPage role={role} />}
            {route === '/access' && role === 'representative' && <AccessPage />}
            {route === '/' && role !== 'teacher' && <TeachersPage role={role ?? 'admin'} />}
          </main>
        </>
      )}
    </>
  )
}
