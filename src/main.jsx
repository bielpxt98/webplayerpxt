import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import HlsPlayer from './HlsPlayer.jsx'
import { MediaManagerProvider, useMediaManager } from './mediaManager.jsx'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'
const EMPTY_ACCOUNT = { server: '', username: '', password: '', remember: true }
const BACKEND_BASE_URL = 'https://webplayerpxt.onrender.com'


const navigationItems = [
  { id: 'account', title: 'ACCOUNT', subtitle: 'Login e conexão', icon: '👤' },
  { id: 'live', title: 'LIVE TV', subtitle: 'Canais ao vivo', icon: '📺' },
  { id: 'movies', title: 'MOVIES', subtitle: 'Filmes', icon: '🎬' },
  { id: 'series', title: 'SERIES', subtitle: 'Séries', icon: '▣' },
  { id: 'radios', title: 'RADIOS', subtitle: 'Estações de rádio', icon: '📻' },
  { id: 'others', title: 'OUTROS', subtitle: 'Itens sem categoria', icon: '◌' },
  { id: 'favorites', title: 'FAVORITES', subtitle: 'Favoritos', icon: '★' },
  { id: 'recents', title: 'RECENTES', subtitle: 'Últimos acessos', icon: '↺' },
]

function normalizeServer(server = '') {
  const trimmed = server.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function buildXtreamLoginUrl({ server, username, password }) {
  const normalizedServer = normalizeServer(server)
  if (!normalizedServer || !username.trim() || !password.trim()) return ''

  const params = new URLSearchParams({
    username: username.trim(),
    password: password.trim(),
  })

  return `${normalizedServer}/player_api.php?${params.toString()}`
}

function maskSensitiveUrl(url, password) {
  if (!url || !password) return url
  return url.replaceAll(password.trim(), '••••••').replaceAll(encodeURIComponent(password.trim()), '••••••')
}

function loadSavedAccount() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return saved ? { ...EMPTY_ACCOUNT, ...saved, remember: true } : EMPTY_ACCOUNT
  } catch {
    return EMPTY_ACCOUNT
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

async function validateXtreamAccount(account) {
  if (!buildXtreamLoginUrl(account)) throw new Error('Preencha servidor, usuário e senha.')

  const response = await fetch(`${BACKEND_BASE_URL}/api/xtream/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server: account.server,
      username: account.username,
      password: account.password,
    }),
  })

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`

    try {
      const errorBody = await response.json()
      errorMessage = errorBody.error || errorMessage
    } catch {
      errorMessage = await response.text() || errorMessage
    }

    throw new Error(errorMessage)
  }

  return response.json()
}


function getChannelQuality(channel) {
  const searchable = `${channel.nome || ''} ${channel.grupo || ''} ${channel.url || ''}`.toUpperCase()
  if (/\b(4K|UHD|2160P)\b/.test(searchable)) return '4K'
  if (/\b(FHD|FULL\s*HD|1080P)\b/.test(searchable)) return 'FHD'
  if (/\b(HD|720P)\b/.test(searchable)) return 'HD'
  return ''
}

function createChannelKey(channel) {
  return `${channel.id || channel.nome}-${channel.url}`
}

function sortByName(items) {
  return [...items].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
}

function LiveTvScreen({ channels, favorites, onToggleFavorite }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedChannel, setSelectedChannel] = useState(null)

  const groups = useMemo(() => {
    const groupMap = channels.reduce((accumulator, channel) => {
      const groupName = channel.grupo || 'Sem categoria'
      accumulator[groupName] = (accumulator[groupName] || 0) + 1
      return accumulator
    }, {})

    return sortByName(Object.keys(groupMap)).map((name) => ({ name, count: groupMap[name] }))
  }, [channels])

  const activeGroup = selectedGroup && groups.some((group) => group.name === selectedGroup)
    ? selectedGroup
    : groups[0]?.name || ''

  const filteredChannels = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    return channels.filter((channel) => {
      const matchesGroup = !activeGroup || channel.grupo === activeGroup
      const matchesSearch = !normalizedSearch || `${channel.nome} ${channel.grupo}`.toLowerCase().includes(normalizedSearch)
      return matchesGroup && matchesSearch
    })
  }, [activeGroup, channels, searchTerm])

  const activeGroupTotal = groups.find((group) => group.name === activeGroup)?.count || 0
  const activeChannel = selectedChannel && channels.some((channel) => createChannelKey(channel) === createChannelKey(selectedChannel))
    ? selectedChannel
    : null

  if (!channels.length) {
    return (
      <main className="placeholder-wrap">
        <section className="panel placeholder">
          <div className="placeholder-icon">📺</div>
          <p className="eyebrow">LIVE TV</p>
          <h2>Nenhuma lista carregada</h2>
          <p>Conecte sua conta na tela ACCOUNT para o MediaManager organizar os canais ao vivo da API Xtream.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="live-layout" aria-label="Navegação de canais ao vivo">
      <aside className="panel group-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Categorias</p>
            <h2>LIVE TV</h2>
          </div>
          <span className="category-total">{groups.length}</span>
        </div>
        <div className="group-list" role="list" aria-label="Categorias da API Xtream">
          {groups.map((group) => (
            <button
              key={group.name}
              type="button"
              className={group.name === activeGroup ? 'active' : ''}
              onClick={() => setSelectedGroup(group.name)}
            >
              <span>{group.name}</span>
              <small>{group.count}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel channel-panel">
        <div className="live-player-card">
          <HlsPlayer url={activeChannel?.url || ''} title={activeChannel?.nome || 'Player LIVE TV'} />
          <div className="live-player-info">
            <p className="eyebrow">Player LIVE TV</p>
            <h3>{activeChannel?.nome || 'Selecione um canal'}</h3>
            <p>{activeChannel ? 'Reproduzindo o canal selecionado.' : 'Clique em um canal abaixo para iniciar a reprodução.'}</p>
          </div>
        </div>

        <div className="section-heading">
          <div>
            <p className="eyebrow">{activeGroup || 'Canais'}</p>
            <h2>{activeGroupTotal} canais na categoria</h2>
          </div>
          <label className="search-label">
            <span>Buscar canal</span>
            <input className="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Digite nome ou categoria" />
          </label>
        </div>

        <div className="channel-count-row">
          <span>{filteredChannels.length} canais encontrados</span>
          <span>{favorites.length} favoritos</span>
        </div>

        {filteredChannels.length > 0 ? (
          <div className="channel-grid" aria-label={`Canais de ${activeGroup}`}>
            {filteredChannels.map((channel) => {
              const channelKey = createChannelKey(channel)
              const quality = getChannelQuality(channel)
              const isFavorite = favorites.includes(channelKey)

              return (
                <article className={`channel-card ${activeChannel && createChannelKey(activeChannel) === channelKey ? 'active' : ''}`} key={channelKey}>
                  <button className={`favorite-button ${isFavorite ? 'active' : ''}`} type="button" onClick={() => onToggleFavorite(channelKey)} aria-label={isFavorite ? `Remover ${channel.nome} dos favoritos` : `Favoritar ${channel.nome}`}>
                    ★
                  </button>
                  <button className="channel-play-button" type="button" onClick={() => setSelectedChannel(channel)} aria-label={`Reproduzir ${channel.nome}`}>
                    <div className="channel-logo-wrap">
                    {channel.logo ? <img src={channel.logo} alt={`Logo ${channel.nome}`} loading="lazy" /> : <span className="channel-icon">📺</span>}
                  </div>
                  <strong title={channel.nome}>{channel.nome}</strong>
                    {quality && <span className="quality-badge">{quality}</span>}
                  </button>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="empty">Nenhum canal encontrado com a busca atual.</p>
        )}
      </section>
    </main>
  )
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
  const generatedUrl = useMemo(() => buildXtreamLoginUrl(account), [account])

  return (
    <main className="account-page">
      <section className="login-hero">
        <p className="eyebrow">ACCOUNT</p>
        <h1>Entre na sua conta IPTV</h1>
        <p className="hero-copy">Informe os dados do seu servidor para testar a conexão e carregar a API Xtream autorizada.</p>
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
          <label>Servidor (DNS)<input value={account.server} onChange={(event) => setAccount({ ...account, server: event.target.value })} placeholder="dns.exemplo.com:8080" autoComplete="url" /></label>
          <label>Usuário<input value={account.username} onChange={(event) => setAccount({ ...account, username: event.target.value })} placeholder="Seu usuário" autoComplete="username" /></label>
          <label>Senha<input type="password" value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} placeholder="Sua senha" autoComplete="current-password" /></label>
        </div>

        <label className="remember-row"><input type="checkbox" checked={account.remember} onChange={(event) => setAccount({ ...account, remember: event.target.checked })} /><span>Lembrar login</span></label>

        {generatedUrl && <p className="hint">URL gerada: <span>{maskSensitiveUrl(generatedUrl, account.password)}</span></p>}

        <div className="actions">
          <button className="primary-button" onClick={onConnect} disabled={loading}>{loading ? 'Conectando...' : 'Conectar'}</button>
          <button className="secondary-button" onClick={onRefresh} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar Catálogo'}</button>
          <button className="danger-button" onClick={onClear} disabled={loading}>Limpar Dados</button>
        </div>

        {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
      </section>
    </main>
  )
}

function PlaceholderScreen({ title, subtitle, icon, mediaItems = [], total = 0 }) {
  return (
    <main className="placeholder-wrap">
      <section className="panel placeholder">
        <div className="placeholder-icon">{icon}</div>
        <p className="eyebrow">{title}</p>
        <h2>{subtitle}</h2>
        <p>Estrutura preparada para receber a próxima etapa da funcionalidade sem iniciar reprodução agora.</p>
        <div className="media-summary"><strong>{total}</strong> itens carregados nesta seção</div>
        {mediaItems.length > 0 && (
          <ul className="media-preview" aria-label={`Prévia de ${title}`}>
            {mediaItems.slice(0, 5).map((item) => (
              <li key={`${item.id}-${item.url}`}><span>{item.nome}</span><small>{item.grupo}</small></li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function FooterNavigation({ screen, onNavigate }) {
  return (
    <footer className="footer-actions">
      {navigationItems.map((item) => (
        <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
          <span>{item.icon}</span>{item.title}
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
  const [favoriteChannels, setFavoriteChannels] = useState([])
  const mediaManager = useMediaManager()

  async function handleConnection(successMessage = 'Conectado com sucesso') {
    if (!buildXtreamLoginUrl(account)) {
      setStatus({ type: 'error', message: 'Preencha servidor, usuário e senha.' })
      return
    }

    setLoading(true)
    setStatus({ type: '', message: '' })

    try {
      saveAccount(account)
      await validateXtreamAccount(account)
      setStatus({ type: 'success', message: `${successMessage}.` })
    } catch (error) {
      setStatus({ type: 'error', message: `Erro ao conectar: ${error.message}` })
    } finally {
      setLoading(false)
    }
  }

  function clearData() {
    localStorage.removeItem(STORAGE_KEY)
    setAccount(EMPTY_ACCOUNT)
    mediaManager.clearCatalog()
    setFavoriteChannels([])
    setStatus({ type: 'success', message: 'Dados removidos deste navegador.' })
  }

  function toggleFavoriteChannel(channelKey) {
    setFavoriteChannels((currentFavorites) => (
      currentFavorites.includes(channelKey)
        ? currentFavorites.filter((favoriteKey) => favoriteKey !== channelKey)
        : [...currentFavorites, channelKey]
    ))
  }

  const currentItem = navigationItems.find((item) => item.id === screen) || navigationItems[0]
  const mediaByScreen = {
    live: mediaManager.live,
    movies: mediaManager.movies,
    series: mediaManager.series,
    radios: mediaManager.radios,
    others: mediaManager.others,
  }
  const currentMediaItems = mediaByScreen[screen] || []

  return (
    <div className="app-shell">
      <div className="background-glow" />
      <Topbar screen={screen} onNavigate={setScreen} />

      {screen === 'account' ? (
        <AccountScreen account={account} setAccount={setAccount} onConnect={() => handleConnection('Conectado com sucesso')} onRefresh={() => handleConnection('Conectado com sucesso')} onClear={clearData} loading={loading} status={status} />
      ) : screen === 'live' ? (
        <LiveTvScreen channels={mediaManager.live} favorites={favoriteChannels} onToggleFavorite={toggleFavoriteChannel} />
      ) : (
        <PlaceholderScreen title={currentItem.title} subtitle={currentItem.subtitle} icon={currentItem.icon} mediaItems={currentMediaItems} total={currentMediaItems.length} />
      )}

      <FooterNavigation screen={screen} onNavigate={setScreen} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <MediaManagerProvider>
    <App />
  </MediaManagerProvider>,
)
