import { useEffect, useState } from 'react'
import { api, go, setUnauthorizedHandler, type Session } from './api.ts'
import { roleLabel } from './format.ts'
import AccessPage from './pages/AccessPage.tsx'
import AuthPage from './pages/AuthPage.tsx'
import CardPage from './pages/CardPage.tsx'
import ChangesPage from './pages/ChangesPage.tsx'
import HomePage from './pages/HomePage.tsx'
import PlansPage from './pages/PlansPage.tsx'
import PracticePage from './pages/PracticePage.tsx'
import SkillsPage from './pages/SkillsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'

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

  if (!ready) return <main className="shell page">불러오는 중</main>
  if (!session) return <AuthPage onDone={() => { go('/'); void refresh() }} />

  const role = session.role
  const activeMemberships = session.memberships.filter((item) => item.status === 'active')
  const tabs: Array<{ to: string; label: string; match: (path: string) => boolean }> = []
  if (role === 'teacher') {
    tabs.push(
      { to: '/', label: '내 수업', match: (path) => path === '/' || path === '/upload' || path.startsWith('/cards/') },
      { to: '/practice', label: '오늘의 연습', match: (path) => path === '/practice' },
      { to: '/skills', label: '쌓인 기술', match: (path) => path === '/skills' },
      { to: '/changes', label: '변화 보기', match: (path) => path === '/changes' },
      { to: '/plans', label: '계획안', match: (path) => path === '/plans' },
    )
  }
  if (role === 'representative' || role === 'admin') {
    tabs.push({ to: '/', label: '수업', match: (path) => path === '/' || path.startsWith('/cards/') })
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="logo" href="#/"><img src="/logo-mark.png" alt="" /> 수업 코칭</a>
        <div className="who">
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
          <span>{session.user.displayName} · {roleLabel(role ?? '')}</span>
          <button className="ghost" onClick={() => go('/settings')}>설정</button>
          <button className="ghost" onClick={() => { void api('/api/auth/logout', { method: 'POST' }).then(() => refresh()) }}>로그아웃</button>
        </div>
      </header>
      {role === 'pending' ? (
        <main className="page">
          <section className="card stack">
            <h1>승인을 기다리는 중입니다</h1>
            <p className="muted">대표가 승인하면 바로 쓸 수 있습니다. 승인 뒤에 아래 버튼을 눌러 주세요.</p>
            <div><button className="primary" onClick={() => { void refresh() }}>승인됐는지 확인</button></div>
          </section>
        </main>
      ) : (
        <>
          {tabs.length > 1 && (
            <nav className="tabs">
              {tabs.map((tab) => <a key={tab.label} href={`#${tab.to}`} className={tab.match(route) ? 'on' : ''}>{tab.label}</a>)}
            </nav>
          )}
          <main className="page">
            {route.startsWith('/cards/') && <CardPage id={route.slice('/cards/'.length)} role={role ?? ''} onChanged={refresh} />}
            {(route === '/' || route === '/upload') && role === 'teacher' && <HomePage session={session} onSession={refresh} />}
            {route === '/plans' && role === 'teacher' && <PlansPage />}
            {route === '/practice' && role === 'teacher' && <PracticePage />}
            {route === '/skills' && role === 'teacher' && <SkillsPage />}
            {route === '/changes' && role === 'teacher' && <ChangesPage />}
            {route === '/' && (role === 'representative' || role === 'admin') && <HomePage session={session} onSession={refresh} />}
            {route === '/settings' && <SettingsPage session={session} />}
            {route === '/access' && role === 'representative' && <AccessPage />}
          </main>
        </>
      )}
    </div>
  )
}
