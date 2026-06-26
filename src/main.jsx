import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'

const emptyAccount = {
  server: '',
  username: '',
  password: '',
  remember: true,
}

const navigationItems = [
  { id: 'account', title: 'ACCOUNT', subtitle: 'Login e conexão', icon: '👤' },
  { id: 'live', title: 'LIVE TV', subtitle: 'Canais ao vivo', icon: '📺' },
  { id: 'movies', title: 'MOVIES', subtitle: 'Filmes', icon: '🎬' },
  { id: 'series', title: 'SERIES', subtitle: 'Séries', icon: '▣' },
  { id: 'favorites', title: 'FAVORITES', subtitle: 'Favoritos', icon: '★' },
  { id: 'recents', title: 'RECENTES', subtitle: 'Últimos acessos', icon: '↺' },
]

function normalizeServer(server) {
  const trimmed = server.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function buildPlaylistUrl({ server, username, password }) {
  const normalizedServer = normalizeServer(server)
  if (!normalizedServer || !username.trim() || !password.trim()) return ''

  const params = new URLSearchParams({
    username: username.trim(),
    password: password.trim(),
    type: 'm3u_plus',
    output: 'hls',
  })

  return `${normalizedServer}/get.php?${params.toString()}`
}

function maskSensitiveUrl(url, password) {
  if (!url) return ''
  return password ? url.replace(encodeURIComponent(password.trim()), '••••••') : url
}

function loadSavedAccount() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return saved ? { ...emptyAccount, ...saved, remember: true } : emptyAccount
  } catch {
    return emptyAccount
  }
}

function saveAccount(account) {
  if (account.remember) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      server: account.server,
      username: account.username,
      password: account.password,
    }))
    return
  }

  localStorage.removeItem(STORAGE_KEY)
}

async function testConnection(account) {
  const url = buildPlaylistUrl(account)
  if (!url) throw new Error('missing-fields')

  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  return response
}

function Topbar({ screen, onNavigate }) {
  return (
    <header className="topbar">
      <button className="logo" onClick={() => onNavigate('account')} aria-label="Abrir account">
        <span>▶</span>
        <strong>BlueStream</strong>
      </button>
      <nav className="top-navigation" aria-label="Navegação principal">
        {navigationItems.map((item) => (
          <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
            {item.title}
          </button>
        ))}
      </nav>
    </header>
  )
}

function AccountScreen({ account, setAccount, onConnect, onRefresh, onClear, loading, status }) {
  const generatedUrl = useMemo(() => buildPlaylistUrl(account), [account])

  return (
    <main className="account-page">
      <section className="login-hero">
        <p className="eyebrow">ACCOUNT</p>
        <h1>Entre na sua conta IPTV</h1>
        <p className="hero-copy">Informe os dados do seu servidor para testar a conexão. A reprodução de canais será ativada nas próximas telas.</p>
      </section>

      <section className="panel login-card" aria-label="Tela de login">
        <div className="login-card-header">
          <div>
            <p className="eyebrow">Login seguro</p>
            <h2>Conectar servidor</h2>
          </div>
          <div className="account-orb">👤</div>
        </div>

        <div className="form-grid">
          <label>
            Servidor (DNS)
            <input
              value={account.server}
              onChange={(event) => setAccount({ ...account, server: event.target.value })}
              placeholder="dns.exemplo.com:8080"
              autoComplete="url"
            />
          </label>
          <label>
            Usuário
            <input
              value={account.username}
              onChange={(event) => setAccount({ ...account, username: event.target.value })}
              placeholder="Seu usuário"
              autoComplete="username"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={account.password}
              onChange={(event) => setAccount({ ...account, password: event.target.value })}
              placeholder="Sua senha"
              autoComplete="current-password"
            />
          </label>
        </div>

        <label className="remember-row">
          <input
            type="checkbox"
            checked={account.remember}
            onChange={(event) => setAccount({ ...account, remember: event.target.checked })}
          />
          <span>Lembrar login</span>
        </label>

        {generatedUrl && (
          <p className="hint">URL gerada: <span>{maskSensitiveUrl(generatedUrl, account.password)}</span></p>
        )}

        <div className="actions">
          <button className="primary-button" onClick={onConnect} disabled={loading}>{loading ? 'Conectando...' : 'Conectar'}</button>
          <button className="secondary-button" onClick={onRefresh} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar Lista'}</button>
          <button className="danger-button" onClick={onClear} disabled={loading}>Limpar Dados</button>
        </div>

        {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
      </section>
    </main>
  )
}

function PlaceholderScreen({ title, subtitle, icon }) {
  return (
    <main className="placeholder-wrap">
      <section className="panel placeholder">
        <div className="placeholder-icon">{icon}</div>
        <p className="eyebrow">{title}</p>
        <h2>{subtitle}</h2>
        <p>Estrutura preparada para receber a próxima etapa da funcionalidade sem iniciar reprodução agora.</p>
      </section>
    </main>
  )
}

function FooterNavigation({ screen, onNavigate }) {
  return (
    <footer className="footer-actions">
      {navigationItems.map((item) => (
        <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
          <span>{item.icon}</span>
          {item.title}
        </button>
      ))}
    </footer>
  )
}

function App() {
  const [screen, setScreen] = useState('account')
  const [account, setAccount] = useState(loadSavedAccount)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: '', message: '' })

  async function handleConnection(successMessage = 'Conectado com sucesso') {
    if (!buildPlaylistUrl(account)) {
      setStatus({ type: 'error', message: 'Preencha servidor, usuário e senha.' })
      return
    }

    setLoading(true)
    setStatus({ type: '', message: '' })

    try {
      saveAccount(account)
      await testConnection(account)
      setStatus({ type: 'success', message: successMessage })
    } catch {
      setStatus({ type: 'error', message: 'Erro ao conectar' })
    } finally {
      setLoading(false)
    }
  }

  function clearData() {
    localStorage.removeItem(STORAGE_KEY)
    setAccount(emptyAccount)
    setStatus({ type: 'success', message: 'Dados removidos deste navegador.' })
  }

  const currentItem = navigationItems.find((item) => item.id === screen) || navigationItems[0]

  return (
    <div className="app-shell">
      <div className="background-glow" />
      <Topbar screen={screen} onNavigate={setScreen} />

      {screen === 'account' ? (
        <AccountScreen
          account={account}
          setAccount={setAccount}
          onConnect={() => handleConnection('Conectado com sucesso')}
          onRefresh={() => handleConnection('Lista atualizada com sucesso')}
          onClear={clearData}
          loading={loading}
          status={status}
        />
      ) : (
        <PlaceholderScreen title={currentItem.title} subtitle={currentItem.subtitle} icon={currentItem.icon} />
      )}

      <FooterNavigation screen={screen} onNavigate={setScreen} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
