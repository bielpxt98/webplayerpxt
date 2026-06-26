import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Hls from 'hls.js'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'

function normalizeServer(server) {
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

function parseAttributes(raw = '') {
  const attrs = {}
  const matcher = /([\w-]+)="([^"]*)"/g
  let match
  while ((match = matcher.exec(raw))) attrs[match[1]] = match[2]
  return attrs
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const channels = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('#EXTINF')) continue

    const [, attributeBlock = '', fallbackName = 'Canal sem nome'] = line.match(/^#EXTINF[^,]*?(.*?),(.*)$/) || []
    const attrs = parseAttributes(attributeBlock)
    const url = lines.slice(index + 1).find((candidate) => !candidate.startsWith('#'))

    if (url) {
      channels.push({
        id: `${channels.length}-${url}`,
        name: attrs['tvg-name'] || fallbackName.trim(),
        group: attrs['group-title'] || 'Sem grupo',
        logo: attrs['tvg-logo'] || '',
        url,
      })
    }
  }

  return channels
}

function loadSavedAccount() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { server: '', username: '', password: '', m3uUrl: '' }
  } catch {
    return { server: '', username: '', password: '', m3uUrl: '' }
  }
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
      {generatedUrl && <p className="hint">Link HLS gerado: <span>{generatedUrl.replace(form.password, '••••••')}</span></p>}
      <div className="actions">
        <button className="primary-button" onClick={onSaveAndLoad} disabled={loading}>{loading ? 'Carregando...' : 'Salvar e carregar lista'}</button>
        <button className="danger-button" onClick={onClear}>Limpar login</button>
      </div>
      {status && <p className="status">{status}</p>}
    </section>
  )
}

function LiveTv({ channels, search, setSearch, group, setGroup, onSelect, onRefresh }) {
  const groups = useMemo(() => ['Todos', ...Array.from(new Set(channels.map((c) => c.group))).sort()], [channels])
  const filtered = channels.filter((channel) => (group === 'Todos' || channel.group === group) && channel.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <section className="live-layout">
      <aside className="panel group-panel">
        <div className="section-heading compact"><h2>Grupos</h2><button className="ghost-button" onClick={onRefresh}>Atualizar lista</button></div>
        <div className="group-list">{groups.map((item) => <button key={item} className={item === group ? 'active' : ''} onClick={() => setGroup(item)}>{item}</button>)}</div>
      </aside>
      <main className="panel channel-panel">
        <div className="section-heading"><div><p className="eyebrow">LIVE TV</p><h2>Canais</h2></div><input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar canal" /></div>
        {filtered.length ? <div className="channel-grid">{filtered.map((channel) => <button className="channel-card" key={channel.id} onClick={() => onSelect(channel)}>{channel.logo ? <img src={channel.logo} alt="" /> : <span className="channel-icon">▶</span>}<span>{channel.name}</span><small>{channel.group}</small></button>)}</div> : <p className="empty">Nenhum canal encontrado. Configure a conta ou atualize a lista.</p>}
      </main>
    </section>
  )
}

function App() {
  const [screen, setScreen] = useState('home')
  const [form, setForm] = useState(loadSavedAccount)
  const [channels, setChannels] = useState([])
  const [group, setGroup] = useState('Todos')
  const [search, setSearch] = useState('')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const playlistUrl = form.m3uUrl.trim() || buildHlsUrl(form)

  async function saveAndLoad() {
    if (!playlistUrl) {
      setStatus('Informe DNS/usuário/senha ou cole uma URL M3U/HLS válida.')
      return
    }
    setLoading(true)
    setStatus('')
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
      const response = await fetch(playlistUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const parsed = parseM3U(text)
      setChannels(parsed)
      setGroup('Todos')
      setScreen('live')
      setStatus(`${parsed.length} canais carregados.`)
    } catch (error) {
      setStatus(`Não foi possível carregar a lista: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  function clearLogin() {
    localStorage.removeItem(STORAGE_KEY)
    setForm({ server: '', username: '', password: '', m3uUrl: '' })
    setChannels([])
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

      {screen === 'home' && <main className="home"><p className="eyebrow">Player IPTV genérico autorizado</p><h1>Escolha uma opção</h1><div className="main-menu">{mainCards.map(([id, title, subtitle]) => <button key={id} className="menu-card" onClick={() => setScreen(id)}><span className="play-badge">▶</span><strong>{title}</strong><small>{subtitle}</small></button>)}</div></main>}
      {screen === 'account' && <Account form={form} setForm={setForm} onSaveAndLoad={saveAndLoad} onClear={clearLogin} loading={loading} status={status} />}
      {screen === 'live' && (selectedChannel ? <Player channel={selectedChannel} onBack={() => setSelectedChannel(null)} /> : <LiveTv channels={channels} search={search} setSearch={setSearch} group={group} setGroup={setGroup} onSelect={setSelectedChannel} onRefresh={saveAndLoad} />)}
      {['epg', 'vod', 'series'].includes(screen) && <section className="panel placeholder"><p className="eyebrow">{screen.toUpperCase()}</p><h2>Em desenvolvimento</h2><p>Esta área está preparada para evolução futura.</p></section>}

      <footer className="footer-actions"><button onClick={() => setScreen('account')}>ACCOUNT</button><button onClick={() => setScreen('live')}>FAVORITE</button><button onClick={() => setScreen('account')}>SETTINGS</button></footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
