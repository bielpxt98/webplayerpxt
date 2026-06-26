import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Hls from 'hls.js'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'
const EMPTY_ACCOUNT = { server: '', username: '', password: '', m3uUrl: '' }
const ALL_GROUPS = 'Todos'

function normalizeServer(server = '') {
  const trimmed = server.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function buildHlsUrl({ server, username, password }) {
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

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel?.url) return undefined

    let hls
    if (Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(channel.url)
      hls.attachMedia(video)
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = channel.url
    }

    return () => {
      if (hls) hls.destroy()
    }
  }, [channel])

  return (
    <section className="panel player-panel">
      <div className="section-heading">
        <button className="ghost-button" onClick={onBack}>← Voltar</button>
        <div>
          <p className="eyebrow">Reproduzindo</p>
          <h2>{channel.name}</h2>
        </div>
      </div>
      <video ref={videoRef} className="video-player" controls autoPlay playsInline />
    </section>
  )
}

function Account({ form, setForm, onSaveAndLoad, onClear, loading, status }) {
  const generatedUrl = buildHlsUrl(form)
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
  }

  const mainCards = [
    ['live', 'LIVE TV', 'Transmissões ao vivo'],
    ['epg', 'EPG', 'Guia de programação'],
    ['vod', 'VOD', 'Em desenvolvimento'],
    ['series', 'SERIES', 'Em desenvolvimento'],
  ]

  return (
    <div className="app-shell">
      <div className="background-glow" />
      <header className="topbar">
        <button className="logo" onClick={() => setScreen('home')}><span>▶</span><strong>BlueStream</strong></button>
        {screen !== 'home' && <button className="ghost-button" onClick={() => { setSelectedChannel(null); setScreen('home') }}>Voltar</button>}
      </header>

      {screen === 'home' && <main className="home"><p className="eyebrow">Player IPTV genérico autorizado</p><h1>Escolha uma opção</h1><div className="main-menu">{mainCards.map(([id, title, subtitle]) => <button key={id} className="menu-card" onClick={() => (id === 'live' ? openLiveTv() : setScreen(id))}><span className="play-badge">▶</span><strong>{title}</strong><small>{subtitle}</small></button>)}</div></main>}
      {screen === 'account' && <Account form={form} setForm={setForm} onSaveAndLoad={saveAndLoad} onClear={clearLogin} loading={loading} status={status} />}
      {screen === 'live' && (selectedChannel ? <Player channel={selectedChannel} onBack={() => setSelectedChannel(null)} /> : <LiveTv channels={channels} search={search} setSearch={setSearch} group={group} setGroup={setGroup} onSelect={setSelectedChannel} onRefresh={refreshSavedList} loading={loading} status={status} />)}
      {['epg', 'vod', 'series'].includes(screen) && <section className="panel placeholder"><p className="eyebrow">{screen.toUpperCase()}</p><h2>Em desenvolvimento</h2><p>Esta área está preparada para evolução futura.</p></section>}

      <footer className="footer-actions"><button onClick={() => setScreen('account')}>ACCOUNT</button><button onClick={openLiveTv}>FAVORITE</button><button onClick={() => setScreen('account')}>SETTINGS</button></footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
