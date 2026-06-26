import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'
const EMPTY_ACCOUNT = { server: '', username: '', password: '', m3uUrl: '' }
const ALL_GROUPS = 'Todos'

function normalizeServer(server = '') {
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

function buildPlaylistUrl(account) {
  return account.m3uUrl.trim() || buildHlsUrl(account)
}

function parseAttributes(raw = '') {
  const attrs = {}
  const matcher = /([\w-]+)=("([^"]*)"|'([^']*)'|([^\s]+))/g
  let match
  while ((match = matcher.exec(raw))) attrs[match[1]] = match[3] ?? match[4] ?? match[5] ?? ''
  return attrs
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const channels = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.toUpperCase().startsWith('#EXTINF')) continue

    const [, attributeBlock = '', fallbackName = 'Canal sem nome'] = line.match(/^#EXTINF(?::[^\s,]*)?\s*([^,]*),(.*)$/i) || []
    const attrs = parseAttributes(attributeBlock)
    const url = lines.slice(index + 1).find((candidate) => !candidate.startsWith('#'))

    if (url) {
      channels.push({
        id: attrs['tvg-id'] || `${channels.length}-${url}`,
        name: (attrs['tvg-name'] || fallbackName || 'Canal sem nome').trim(),
        group: (attrs['group-title'] || 'Sem grupo').trim(),
        logo: (attrs['tvg-logo'] || '').trim(),
        url,
      })
    }
  }

  return channels
function maskSensitiveUrl(url, password) {
  if (!url) return ''
  return password ? url.replace(encodeURIComponent(password.trim()), '••••••') : url
}

function loadSavedAccount() {
  try {
    return { ...EMPTY_ACCOUNT, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) }
  } catch {
    return EMPTY_ACCOUNT
  }
}

function maskPassword(url, password) {
  if (!password) return url
  return url.replaceAll(password, '••••••')
}

function Player({ channel, onBack }) {
  const videoRef = useRef(null)
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
    <section className="panel account-panel">
      <p className="eyebrow">Login manual autorizado</p>
      <h2>Configurar conta</h2>
      <div className="form-grid">
        <label>DNS/Servidor<input value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} placeholder="https://servidor.com:8080" /></label>
        <label>Usuário<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Seu usuário" /></label>
        <label>Senha<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Sua senha" /></label>
        <label className="wide">URL M3U/HLS manual<textarea value={form.m3uUrl} onChange={(e) => setForm({ ...form, m3uUrl: e.target.value })} placeholder="Cole aqui uma URL M3U/HLS completa, se preferir" /></label>
      </div>
      {generatedUrl && <p className="hint">Link HLS gerado: <span>{maskPassword(generatedUrl, form.password)}</span></p>}
      <div className="actions">
        <button className="primary-button" onClick={onSaveAndLoad} disabled={loading}>{loading ? 'Carregando...' : 'Salvar e carregar lista'}</button>
        <button className="danger-button" onClick={onClear}>Limpar login</button>
      </div>
      {status && <p className="status">{status}</p>}
    </section>
  )
}

function LiveTv({ channels, search, setSearch, group, setGroup, onSelect, onRefresh, loading, status }) {
  const groups = useMemo(() => [ALL_GROUPS, ...Array.from(new Set(channels.map((c) => c.group))).sort((a, b) => a.localeCompare(b))], [channels])
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = channels.filter((channel) => (group === ALL_GROUPS || channel.group === group) && channel.name.toLowerCase().includes(normalizedSearch))
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
    <section className="live-layout">
      <aside className="panel group-panel">
        <div className="section-heading compact"><h2>Categorias</h2><button className="ghost-button" onClick={onRefresh} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar lista'}</button></div>
        <p className="hint">Categorias criadas automaticamente a partir de <strong>group-title</strong>.</p>
        <div className="group-list">{groups.map((item) => <button key={item} className={item === group ? 'active' : ''} onClick={() => setGroup(item)}>{item}</button>)}</div>
      </aside>
      <main className="panel channel-panel">
        <div className="section-heading"><div><p className="eyebrow">LIVE TV</p><h2>{filtered.length} de {channels.length} canais</h2></div><input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar canal" /></div>
        {status && <p className="status live-status">{status}</p>}
        {filtered.length ? <div className="channel-grid">{filtered.map((channel) => <button className="channel-card" key={channel.id} onClick={() => onSelect(channel)}>{channel.logo ? <img src={channel.logo} alt={`Logo de ${channel.name}`} loading="lazy" /> : <span className="channel-icon">▶</span>}<span>{channel.name}</span><small>{channel.group}</small></button>)}</div> : <p className="empty">Nenhum canal encontrado. Configure a conta ou atualize a lista.</p>}
      </main>
    </section>
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
  const [screen, setScreen] = useState('home')
  const [form, setForm] = useState(loadSavedAccount)
  const [channels, setChannels] = useState([])
  const [group, setGroup] = useState(ALL_GROUPS)
  const [search, setSearch] = useState('')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  async function loadPlaylist(account, { persist = false } = {}) {
    const playlistUrl = buildPlaylistUrl(account)
    if (!playlistUrl) {
      setStatus('Informe DNS/usuário/senha ou cole uma URL M3U/HLS válida.')
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
    setStatus('Baixando lista M3U...')
    try {
      if (persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
      const response = await fetch(playlistUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const parsed = parseM3U(text)
      setChannels(parsed)
      setGroup(ALL_GROUPS)
      setSearch('')
      setSelectedChannel(null)
      setScreen('live')
      setStatus(`${parsed.length} canais carregados na LIVE TV.`)
    } catch (error) {
      setStatus(`Não foi possível carregar a lista: ${error.message}`)
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

  function saveAndLoad() {
    loadPlaylist(form, { persist: true })
  }

  function refreshSavedList() {
    const savedAccount = loadSavedAccount()
    setForm(savedAccount)
    loadPlaylist(savedAccount)
  }

  function openLiveTv() {
    setScreen('live')
    if (!channels.length && buildPlaylistUrl(loadSavedAccount())) refreshSavedList()
  }

  function clearLogin() {
    localStorage.removeItem(STORAGE_KEY)
    setForm(EMPTY_ACCOUNT)
    setChannels([])
    setGroup(ALL_GROUPS)
    setSearch('')
    setSelectedChannel(null)
    setStatus('Login e lista removidos deste navegador.')
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

      {screen === 'home' && <main className="home"><p className="eyebrow">Player IPTV genérico autorizado</p><h1>Escolha uma opção</h1><div className="main-menu">{mainCards.map(([id, title, subtitle]) => <button key={id} className="menu-card" onClick={() => (id === 'live' ? openLiveTv() : setScreen(id))}><span className="play-badge">▶</span><strong>{title}</strong><small>{subtitle}</small></button>)}</div></main>}
      {screen === 'account' && <Account form={form} setForm={setForm} onSaveAndLoad={saveAndLoad} onClear={clearLogin} loading={loading} status={status} />}
      {screen === 'live' && (selectedChannel ? <Player channel={selectedChannel} onBack={() => setSelectedChannel(null)} /> : <LiveTv channels={channels} search={search} setSearch={setSearch} group={group} setGroup={setGroup} onSelect={setSelectedChannel} onRefresh={refreshSavedList} loading={loading} status={status} />)}
      {['epg', 'vod', 'series'].includes(screen) && <section className="panel placeholder"><p className="eyebrow">{screen.toUpperCase()}</p><h2>Em desenvolvimento</h2><p>Esta área está preparada para evolução futura.</p></section>}

      <footer className="footer-actions"><button onClick={() => setScreen('account')}>ACCOUNT</button><button onClick={openLiveTv}>FAVORITE</button><button onClick={() => setScreen('account')}>SETTINGS</button></footer>
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
