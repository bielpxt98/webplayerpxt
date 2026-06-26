import React, { useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import HlsPlayer from './HlsPlayer.jsx'
import { MediaManagerProvider, useMediaManager } from './mediaManager.jsx'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'
const FAVORITES_STORAGE_KEY = 'authorized-iptv-player-favorites'
const EMPTY_ACCOUNT = { server: '', username: '', password: '', remember: true }
const MASKED_PASSWORD = '••••••'
const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_BASE_URL || '').replace(/\/+$/, '')


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

function isMaskedPassword(password = '') {
  return String(password).trim() === MASKED_PASSWORD
}

function getAccountCredentials(account) {
  return {
    server: account.server,
    username: account.username,
    password: account.password,
    remember: account.remember,
  }
}

function getSessionCredentialsPlaybackError(sessionCredentials) {
  if (!sessionCredentials?.password) return 'Senha real da sessão ausente. Conecte novamente para liberar o playback.'
  if (isMaskedPassword(sessionCredentials.password) || String(sessionCredentials.password).includes('•')) return 'Senha mascarada detectada na sessão. Conecte novamente para liberar o playback.'
  return ''
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
  return url
}

function hasMaskedPasswordInUrl(url = '') {
  return String(url).includes(MASKED_PASSWORD) || String(url).includes('%E2%80%A2')
}

function hasCompleteSessionCredentials(credentials) {
  return Boolean(credentials?.server && credentials?.username && credentials?.password && !isMaskedPassword(credentials.password) && !String(credentials.password).includes('•'))
}

function buildXtreamPlaybackUrl(sessionCredentials, path, streamId, extension) {
  const playbackError = getSessionCredentialsPlaybackError(sessionCredentials)
  const isMaskedPasswordUsed = Boolean(sessionCredentials?.password && (isMaskedPassword(sessionCredentials.password) || String(sessionCredentials.password).includes('•')))
  console.info('[Playback credentials] raw password source: sessionCredentials')
  console.info(`[Playback credentials] isMaskedPasswordUsed: ${isMaskedPasswordUsed}`)
  console.info('[Playback credentials]', {
    rawPasswordSource: 'sessionCredentials',
    isMaskedPasswordUsed,
  })
  if (playbackError || !hasCompleteSessionCredentials(sessionCredentials)) return ''

  const normalizedServer = normalizeServer(sessionCredentials.server)
  const username = String(sessionCredentials.username || '').trim()
  const password = String(sessionCredentials.password || '').trim()
  const normalizedExtension = String(extension || '').replace(/^\.+/, '')

  if (!normalizedServer || !username || !password || !streamId || !normalizedExtension) return ''

  return `${normalizedServer}/${path}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${normalizedExtension}`
}

function getPlayableItemUrl(item, sessionCredentials) {
  const streamId = item?.streamId || item?.id

  if (item?.tipo === 'MOVIES') return buildXtreamPlaybackUrl(sessionCredentials, 'movie', streamId, 'mp4')
  if (item?.tipo === 'LIVE TV') return buildXtreamPlaybackUrl(sessionCredentials, 'live', streamId, 'm3u8')

  return ''
}

function maskChannelUrl(url) {
  return url || ''
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

function getCatalogPayload(responseData) {
  return responseData?.catalog && typeof responseData.catalog === 'object'
    ? responseData.catalog
    : responseData
}

function getCatalogCounts(catalog) {
  return {
    live: Array.isArray(catalog?.liveStreams) ? catalog.liveStreams.length : 0,
    movies: Array.isArray(catalog?.vodStreams) ? catalog.vodStreams.length : 0,
    series: Array.isArray(catalog?.series) ? catalog.series.length : 0,
  }
}


function getChannelQuality(channel) {
  const searchable = `${channel.nome || ''} ${channel.grupo || ''} ${channel.url || ''}`.toUpperCase()
  if (/\b(4K|UHD|2160P)\b/.test(searchable)) return '4K'
  if (/\b(FHD|FULL\s*HD|1080P)\b/.test(searchable)) return 'FHD'
  if (/\b(HD|720P)\b/.test(searchable)) return 'HD'
  return ''
}

function createItemKey(item) {
  return `${item.tipo || 'ITEM'}:${item.streamId || item.id || item.nome}`
}

function createChannelKey(channel) {
  return createItemKey(channel)
}

function sortByName(items) {
  return [...items].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
}

function loadSavedFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites))
}

function getItemPoster(item) {
  return item?.logo || item?.raw?.stream_icon || item?.raw?.cover || item?.raw?.cover_big || item?.raw?.movie_image || ''
}

function getItemContainerExtension(item) {
  return String(item?.raw?.container_extension || item?.raw?.container || item?.container_extension || 'mp4').replace(/^\.+/, '') || 'mp4'
}

function createFavoriteSnapshot(item) {
  return {
    key: createItemKey(item),
    id: item.id,
    streamId: item.streamId,
    nome: item.nome,
    grupo: item.grupo,
    logo: getItemPoster(item),
    url: item.url,
    fallbackUrl: item.fallbackUrl || '',
    tipo: item.tipo,
    raw: item.raw || {},
  }
}

function findFavorite(favorites, item) {
  const itemKey = createItemKey(item)
  return favorites.find((favorite) => favorite.key === itemKey)
}

function buildSeriesInfoUrl(sessionCredentials, seriesId) {
  if (!hasCompleteSessionCredentials(sessionCredentials)) return ''

  const normalizedServer = normalizeServer(sessionCredentials.server)
  if (!normalizedServer || !seriesId) return ''

  const params = new URLSearchParams({
    username: sessionCredentials.username.trim(),
    password: sessionCredentials.password.trim(),
    action: 'get_series_info',
    series_id: String(seriesId),
  })

  return `${normalizedServer}/player_api.php?${params.toString()}`
}

async function fetchSeriesInfo(sessionCredentials, seriesId) {
  const directUrl = buildSeriesInfoUrl(sessionCredentials, seriesId)
  if (!directUrl) throw new Error('Dados da conta ou ID da série ausentes.')

  const response = await fetch(`${BACKEND_BASE_URL}/api/xtream/series-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server: sessionCredentials.server,
      username: sessionCredentials.username,
      password: sessionCredentials.password,
      seriesId,
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

function normalizeEpisodes(seriesInfo) {
  const episodesBySeason = seriesInfo?.episodes || {}
  return Object.entries(episodesBySeason).flatMap(([seasonNumber, episodes]) => (
    Array.isArray(episodes) ? episodes.map((episode) => ({ ...episode, seasonNumber })) : []
  ))
}


async function resolvePlaybackUrl(originalUrl) {
  if (!originalUrl) return null

  const response = await fetch(`${BACKEND_BASE_URL}/api/stream/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ originalUrl }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Não foi possível resolver o redirect do stream.')
  }

  return data
}

function LiveTvScreen({ channels, favorites, onToggleFavorite, sessionCredentials }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [playbackDebug, setPlaybackDebug] = useState({ url: '', format: 'm3u8', originalUrl: '', finalUrl: '', statusCode: '', contentType: '', redirected: '' })
  const [resolvedPlaybackUrl, setResolvedPlaybackUrl] = useState('')
  const resolveRequestIdRef = useRef(0)

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
  const activeStreamId = activeChannel?.streamId || activeChannel?.id
  const activePlaybackUrl = activeChannel ? buildXtreamPlaybackUrl(sessionCredentials, 'live', activeStreamId, 'm3u8') : ''
  const playerPlaybackUrl = resolvedPlaybackUrl || activePlaybackUrl
  const maskedActivePlaybackUrl = activePlaybackUrl ? maskChannelUrl(activePlaybackUrl) : ''
  const hasMaskedLiveUrl = hasMaskedPasswordInUrl(activePlaybackUrl)
  const updatePlaybackDebug = useCallback((debugInfo) => {
    setPlaybackDebug((currentDebug) => ({ ...currentDebug, ...debugInfo }))
  }, [])

  async function selectChannel(channel, event) {
    event?.preventDefault()
    event?.stopPropagation()

    const streamId = channel.streamId || channel.id
    const resolveRequestId = resolveRequestIdRef.current + 1
    resolveRequestIdRef.current = resolveRequestId
    const m3u8Url = buildXtreamPlaybackUrl(sessionCredentials, 'live', streamId, 'm3u8')

    console.info('[LIVE TV] Selected channel playback URL', {
      name: channel.nome,
      streamId,
      url: m3u8Url,
      action: 'resolve-before-playback',
    })
    setSelectedChannel(channel)
    setResolvedPlaybackUrl('')
    setPlaybackDebug({ url: m3u8Url, format: 'm3u8', originalUrl: m3u8Url, finalUrl: '', statusCode: '', contentType: '', redirected: '' })

    if (!m3u8Url) return

    try {
      const resolvedStream = await resolvePlaybackUrl(m3u8Url)
      if (resolveRequestIdRef.current !== resolveRequestId) return
      const canUseResolvedUrl = resolvedStream.finalUrl && [200, 302].includes(Number(resolvedStream.statusCode))
      const finalUrl = resolvedStream.finalUrl || m3u8Url
      const playbackUrl = canUseResolvedUrl ? finalUrl : m3u8Url
      setResolvedPlaybackUrl(playbackUrl)
      setPlaybackDebug({
        url: playbackUrl,
        format: 'm3u8',
        originalUrl: resolvedStream.originalUrl || m3u8Url,
        finalUrl,
        statusCode: resolvedStream.statusCode ?? '',
        contentType: resolvedStream.contentType || '',
        redirected: Boolean(resolvedStream.redirected),
      })
    } catch (error) {
      if (resolveRequestIdRef.current !== resolveRequestId) return
      setPlaybackDebug((currentDebug) => ({
        ...currentDebug,
        errorSource: 'resolve-stream',
        errorDetail: error.message,
      }))
    }
  }

  function toggleChannelFavorite(channel, event) {
    event.preventDefault()
    event.stopPropagation()
    onToggleFavorite(channel)
  }

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
          <HlsPlayer url={playerPlaybackUrl} title={activeChannel?.nome || 'Player LIVE TV'} onPlaybackUrlChange={updatePlaybackDebug} />
          <div className="live-player-info">
            <p className="eyebrow">Player LIVE TV</p>
            <h3>{activeChannel?.nome || 'Selecione um canal'}</h3>
            <p>{activeChannel ? 'Reproduzindo o canal selecionado.' : 'Clique em um canal abaixo para iniciar a reprodução.'}</p>
            <div className="live-url-diagnostic" aria-live="polite">
              <span>Diagnóstico temporário LIVE TV</span>
              <code>username: {sessionCredentials?.username ? 'OK' : 'ausente'}</code>
              <code>password: {sessionCredentials?.password ? 'REAL (visível no diagnóstico temporário)' : 'ausente'}</code>
              <code>stream_url: {activePlaybackUrl || 'selecione um canal para gerar a URL'}</code>
              <code>stream_id: {activeChannel?.streamId || activeChannel?.id || 'nenhum canal selecionado'}</code>
              <code>nome do canal: {activeChannel?.nome || 'nenhum canal selecionado'}</code>
              <code>formato solicitado: /live/username/password/stream_id.m3u8</code>
              <code>URL solicitada: {maskedActivePlaybackUrl || 'selecione um canal para gerar a URL'}</code>
              <code>URL real .m3u8: {activePlaybackUrl || 'selecione um canal para gerar a URL'}</code>
              <code>URL original: {playbackDebug.originalUrl || activePlaybackUrl || 'selecione um canal para gerar a URL'}</code>
              <code>URL final resolvida: {playbackDebug.finalUrl || 'aguardando redirect/token'}</code>
              <code>statusCode: {playbackDebug.statusCode || 'aguardando resposta'}</code>
              <code>redirected: {playbackDebug.redirected === '' ? 'aguardando resposta' : String(playbackDebug.redirected)}</code>
              <code>contentType: {playbackDebug.contentType || 'aguardando resposta'}</code>
              <code>URL em uso no player: {playbackDebug.url ? `${playbackDebug.format} - ${playbackDebug.url}` : 'selecione um canal para gerar a URL'}</code>
              {playbackDebug.failedUrl && <code>última URL que falhou: {playbackDebug.failedUrl}</code>}
              {playbackDebug.errorSource && <code>erro do player: {playbackDebug.errorSource} - {playbackDebug.errorDetail}</code>}
              {hasMaskedLiveUrl && <code>erro: URL ainda está usando senha mascarada</code>}
            </div>
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
              const isFavorite = Boolean(findFavorite(favorites, channel))

              return (
                <article
                  className={`channel-card ${activeChannel && createChannelKey(activeChannel) === channelKey ? 'active' : ''}`}
                  key={channelKey}
                  onClick={(event) => selectChannel(channel, event)}
                  aria-label={`Canal ${channel.nome}`}
                >
                  <button className={`favorite-button ${isFavorite ? 'active' : ''}`} type="button" onClick={(event) => toggleChannelFavorite(channel, event)} aria-label={isFavorite ? `Remover ${channel.nome} dos favoritos` : `Favoritar ${channel.nome}`}>
                    ★
                  </button>
                  <button className="channel-play-button" type="button" onClick={(event) => selectChannel(channel, event)} aria-label={`Reproduzir ${channel.nome}`}>
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

function CatalogScreen({ title, icon, items, favorites, onToggleFavorite, onSelectItem, selectedItem, playerTitle, playerDescription, playerUrl, playerFallbackUrl }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const groups = useMemo(() => {
    const groupMap = items.reduce((accumulator, item) => {
      const groupName = item.grupo || 'Sem categoria'
      accumulator[groupName] = (accumulator[groupName] || 0) + 1
      return accumulator
    }, {})
    return sortByName(Object.keys(groupMap)).map((name) => ({ name, count: groupMap[name] }))
  }, [items])

  const activeGroup = selectedGroup && groups.some((group) => group.name === selectedGroup) ? selectedGroup : groups[0]?.name || ''
  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    return items.filter((item) => {
      const matchesGroup = !activeGroup || item.grupo === activeGroup
      const matchesSearch = !normalizedSearch || `${item.nome} ${item.grupo}`.toLowerCase().includes(normalizedSearch)
      return matchesGroup && matchesSearch
    })
  }, [activeGroup, items, searchTerm])

  if (!items.length) {
    return (
      <main className="placeholder-wrap">
        <section className="panel placeholder">
          <div className="placeholder-icon">{icon}</div>
          <p className="eyebrow">{title}</p>
          <h2>Nenhum item carregado</h2>
          <p>Conecte sua conta na tela ACCOUNT para carregar o catálogo Xtream.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="live-layout" aria-label={`Navegação de ${title}`}>
      <aside className="panel group-panel">
        <div className="section-heading compact">
          <div><p className="eyebrow">Categorias</p><h2>{title}</h2></div>
          <span className="category-total">{groups.length}</span>
        </div>
        <div className="group-list" role="list" aria-label={`Categorias de ${title}`}>
          {groups.map((group) => (
            <button key={group.name} type="button" className={group.name === activeGroup ? 'active' : ''} onClick={() => setSelectedGroup(group.name)}>
              <span>{group.name}</span><small>{group.count}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel channel-panel">
        <div className="live-player-card">
          <HlsPlayer url={playerUrl || ''} fallbackUrl={playerFallbackUrl || ''} title={playerTitle || title} />
          <div className="live-player-info">
            <p className="eyebrow">Player {title}</p>
            <h3>{playerTitle || `Selecione em ${title}`}</h3>
            <p>{playerDescription || 'Clique em um item abaixo para iniciar.'}</p>
            {['MOVIES', 'SERIES'].includes(title) && (
              <div className="live-url-diagnostic" aria-live="polite">
                <span>Diagnóstico temporário {title}</span>
                <code>stream_url: {playerUrl ? 'construída usando a senha real' : 'selecione um item para gerar a URL'}</code>
                <code>URL: {playerUrl || 'selecione um item para gerar a URL'}</code>
                {playerFallbackUrl && <code>fallback: {playerFallbackUrl}</code>}
                {(hasMaskedPasswordInUrl(playerUrl) || hasMaskedPasswordInUrl(playerFallbackUrl)) && <code>erro: URL ainda está usando senha mascarada</code>}
              </div>
            )}
          </div>
        </div>
        <div className="section-heading">
          <div><p className="eyebrow">{activeGroup || title}</p><h2>{filteredItems.length} itens encontrados</h2></div>
          <label className="search-label"><span>Buscar</span><input className="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Digite nome ou categoria" /></label>
        </div>
        <div className="channel-count-row"><span>{items.length} itens carregados</span><span>{favorites.length} favoritos</span></div>
        {filteredItems.length > 0 ? (
          <div className="channel-grid" aria-label={`Itens de ${activeGroup}`}>
            {filteredItems.map((item) => {
              const itemKey = createItemKey(item)
              const isFavorite = Boolean(findFavorite(favorites, item))
              const poster = getItemPoster(item)
              return (
                <article className={`channel-card ${selectedItem && createItemKey(selectedItem) === itemKey ? 'active' : ''}`} key={itemKey}>
                  <button className={`favorite-button ${isFavorite ? 'active' : ''}`} type="button" onClick={() => onToggleFavorite(item)} aria-label={isFavorite ? `Remover ${item.nome} dos favoritos` : `Favoritar ${item.nome}`}>★</button>
                  <button className="channel-play-button" type="button" onClick={() => onSelectItem(item)} aria-label={`Abrir ${item.nome}`}>
                    <div className="channel-logo-wrap">{poster ? <img src={poster} alt={`Poster ${item.nome}`} loading="lazy" /> : <span className="channel-icon">{icon}</span>}</div>
                    <strong title={item.nome}>{item.nome}</strong>
                    <small title={item.grupo}>{item.grupo}</small>
                  </button>
                </article>
              )
            })}
          </div>
        ) : <p className="empty">Nenhum item encontrado com a busca atual.</p>}
      </section>
    </main>
  )
}

function MoviesScreen({ sessionCredentials, items, favorites, onToggleFavorite }) {
  const [selectedMovie, setSelectedMovie] = useState(null)

  return (
    <CatalogScreen
      title="MOVIES"
      icon="🎬"
      items={items}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onSelectItem={setSelectedMovie}
      selectedItem={selectedMovie}
      playerTitle={selectedMovie?.nome || ''}
      playerDescription={selectedMovie ? 'Reproduzindo filme selecionado.' : 'Clique em um filme abaixo para iniciar a reprodução.'}
      playerUrl={selectedMovie ? getPlayableItemUrl(selectedMovie, sessionCredentials) : ''}
    />
  )
}

function SeriesScreen({ sessionCredentials, items, favorites, onToggleFavorite }) {
  const [selectedSeries, setSelectedSeries] = useState(null)
  const [seriesInfo, setSeriesInfo] = useState(null)
  const [selectedEpisode, setSelectedEpisode] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [error, setError] = useState('')

  async function selectSeries(series) {
    setSelectedSeries(series)
    setSelectedEpisode(null)
    setSeriesInfo(null)
    setError('')
    setLoadingInfo(true)
    try {
      setSeriesInfo(await fetchSeriesInfo(sessionCredentials, series.streamId || series.id))
    } catch (fetchError) {
      setError(`Erro ao carregar episódios: ${fetchError.message}`)
    } finally {
      setLoadingInfo(false)
    }
  }

  const episodes = useMemo(() => normalizeEpisodes(seriesInfo), [seriesInfo])
  const episodeUrl = selectedEpisode
    ? buildXtreamPlaybackUrl(sessionCredentials, 'series', selectedEpisode.id || selectedEpisode.episode_id, getItemContainerExtension({ raw: selectedEpisode }))
    : ''

  const description = loadingInfo
    ? 'Carregando temporadas e episódios...'
    : error || (selectedEpisode ? `Temporada ${selectedEpisode.seasonNumber || selectedEpisode.season || ''}` : selectedSeries ? 'Escolha um episódio abaixo.' : 'Clique em uma série para carregar episódios.')

  return (
    <>
      <CatalogScreen title="SERIES" icon="▣" items={items} favorites={favorites} onToggleFavorite={onToggleFavorite} onSelectItem={selectSeries} selectedItem={selectedSeries} playerTitle={selectedEpisode?.title || selectedSeries?.nome || ''} playerDescription={description} playerUrl={episodeUrl} />
      {selectedSeries && (
        <main className="placeholder-wrap series-episodes-wrap">
          <section className="panel placeholder">
            <p className="eyebrow">Episódios</p>
            <h2>{selectedSeries.nome}</h2>
            {loadingInfo && <p>Carregando episódios...</p>}
            {error && <p className="status error">{error}</p>}
            {!loadingInfo && !error && episodes.length === 0 && <p>Nenhum episódio encontrado para esta série.</p>}
            {episodes.length > 0 && (
              <ul className="media-preview" aria-label="Episódios da série">
                {episodes.map((episode) => (
                  <li key={`${episode.seasonNumber}-${episode.id || episode.episode_id}`}>
                    <button className="episode-button" type="button" onClick={() => setSelectedEpisode(episode)}>
                      <span>{episode.title || `Episódio ${episode.episode_num || episode.id}`}</span><small>T{episode.seasonNumber || episode.season || '?'} • {getItemContainerExtension({ raw: episode })}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      )}
    </>
  )
}

function FavoritesScreen({ sessionCredentials, favorites, catalogItems, onToggleFavorite, onOpenSeries }) {
  const catalogByKey = useMemo(() => catalogItems.reduce((accumulator, item) => ({ ...accumulator, [createItemKey(item)]: item }), {}), [catalogItems])
  const favoriteItems = favorites.map((favorite) => catalogByKey[favorite.key] || favorite)
  const [selectedItem, setSelectedItem] = useState(null)

  function openFavorite(item) {
    if (item.tipo === 'SERIES') {
      onOpenSeries()
      return
    }
    setSelectedItem(item)
  }

  return <CatalogScreen title="FAVORITES" icon="★" items={favoriteItems} favorites={favorites} onToggleFavorite={onToggleFavorite} onSelectItem={openFavorite} selectedItem={selectedItem} playerTitle={selectedItem?.nome || ''} playerDescription={selectedItem ? 'Reproduzindo favorito selecionado.' : 'Clique em um favorito para reproduzir.'} playerUrl={selectedItem ? getPlayableItemUrl(selectedItem, sessionCredentials) : ''} playerFallbackUrl={selectedItem?.tipo === 'LIVE TV' ? buildXtreamPlaybackUrl(sessionCredentials, 'live', selectedItem.streamId || selectedItem.id, 'ts') : ''} />
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

function AccountScreen({ account, setAccount, sessionCredentials, onConnect, onRefresh, onClear, loading, status }) {
  const generatedUrl = useMemo(() => buildXtreamLoginUrl(getAccountCredentials(account)), [account])

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
          <label>Senha<input type="password" value={account.password} onFocus={() => isMaskedPassword(account.password) && setAccount({ ...account, password: '' })} onChange={(event) => setAccount({ ...account, password: event.target.value })} placeholder="Sua senha" autoComplete="current-password" /></label>
        </div>

        <label className="remember-row"><input type="checkbox" checked={account.remember} onChange={(event) => setAccount({ ...account, remember: event.target.checked })} /><span>Lembrar login</span></label>

        {generatedUrl && <p className="hint">URL gerada: <span>{maskSensitiveUrl(generatedUrl, getAccountCredentials(account).password)}</span></p>}
        {sessionCredentials?.password && (
          <div className="live-url-diagnostic" aria-live="polite">
            <span>Diagnóstico de credenciais</span>
            <code>username: OK</code>
            <code>password: REAL (visível no diagnóstico temporário)</code>
            <code>stream_url: construída usando a senha real</code>
            <code>URL: {generatedUrl}</code>
            {hasMaskedPasswordInUrl(generatedUrl) && <code>erro: URL ainda está usando senha mascarada</code>}
          </div>
        )}

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
  const [sessionCredentials, setSessionCredentials] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: '', message: '' })
  const [favorites, setFavorites] = useState(loadSavedFavorites)
  const mediaManager = useMediaManager()

  async function handleConnection(successMessage = 'Conectado com sucesso') {
    const formCredentials = getAccountCredentials(account)
    const authCredentials = isMaskedPassword(formCredentials.password)
      ? { ...formCredentials, password: sessionCredentials?.password || '' }
      : formCredentials

    if (!buildXtreamLoginUrl(authCredentials) || getSessionCredentialsPlaybackError({ password: authCredentials.password })) {
      setStatus({ type: 'error', message: 'Preencha servidor, usuário e senha.' })
      return
    }

    setLoading(true)
    setStatus({ type: '', message: '' })

    try {
      const responseData = await validateXtreamAccount(authCredentials)
      const realPassword = authCredentials.password.trim()
      saveAccount({ ...authCredentials, password: realPassword })
      const catalogPayload = getCatalogPayload(responseData)
      const loadedCatalog = mediaManager.loadXtreamCatalog(catalogPayload, {
        server: normalizeServer(authCredentials.server),
        username: authCredentials.username,
        password: realPassword,
      })
      setSessionCredentials({
        server: normalizeServer(authCredentials.server),
        username: authCredentials.username.trim(),
        password: realPassword,
      })
      setAccount({
        ...account,
        server: authCredentials.server,
        username: authCredentials.username,
        password: MASKED_PASSWORD,
      })
      const counts = getCatalogCounts(catalogPayload)
      setStatus({
        type: 'success',
        message: `${successMessage}. Catálogo carregado: ${counts.live || loadedCatalog.live.length} canais, ${counts.movies || loadedCatalog.movies.length} filmes e ${counts.series || loadedCatalog.series.length} séries.`,
      })
    } catch (error) {
      setStatus({ type: 'error', message: `Erro ao conectar: ${error.message}` })
    } finally {
      setLoading(false)
    }
  }

  function clearData() {
    localStorage.removeItem(STORAGE_KEY)
    setAccount(EMPTY_ACCOUNT)
    setSessionCredentials(null)
    mediaManager.clearCatalog()
    setFavorites([])
    localStorage.removeItem(FAVORITES_STORAGE_KEY)
    setStatus({ type: 'success', message: 'Dados removidos deste navegador.' })
  }

  function toggleFavoriteItem(item) {
    setFavorites((currentFavorites) => {
      const favorite = findFavorite(currentFavorites, item)
      const nextFavorites = favorite
        ? currentFavorites.filter((currentFavorite) => currentFavorite.key !== favorite.key)
        : [...currentFavorites, createFavoriteSnapshot(item)]
      saveFavorites(nextFavorites)
      return nextFavorites
    })
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
        <AccountScreen account={account} setAccount={setAccount} sessionCredentials={sessionCredentials} onConnect={() => handleConnection('Conectado com sucesso')} onRefresh={() => handleConnection('Conectado com sucesso')} onClear={clearData} loading={loading} status={status} />
      ) : screen === 'live' ? (
        <LiveTvScreen channels={mediaManager.live} favorites={favorites} onToggleFavorite={toggleFavoriteItem} sessionCredentials={sessionCredentials} />
      ) : screen === 'movies' ? (
        <MoviesScreen sessionCredentials={sessionCredentials} items={mediaManager.movies} favorites={favorites} onToggleFavorite={toggleFavoriteItem} />
      ) : screen === 'series' ? (
        <SeriesScreen sessionCredentials={sessionCredentials} items={mediaManager.series} favorites={favorites} onToggleFavorite={toggleFavoriteItem} />
      ) : screen === 'favorites' ? (
        <FavoritesScreen sessionCredentials={sessionCredentials} favorites={favorites} catalogItems={mediaManager.all} onToggleFavorite={toggleFavoriteItem} onOpenSeries={() => setScreen('series')} />
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
