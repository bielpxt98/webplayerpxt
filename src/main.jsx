import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import HlsPlayer from './HlsPlayer.jsx'
import { MediaManagerProvider, useMediaManager } from './mediaManager.jsx'
import './styles.css'

const STORAGE_KEY = 'authorized-iptv-player-account'
const FAVORITES_STORAGE_KEY = 'authorized-iptv-player-favorites'
const SESSION_DURATION_MS = 6 * 60 * 60 * 1000
const EMPTY_ACCOUNT = { server: '', username: '', password: '', remember: true }
const MASKED_PASSWORD = '••••••'
const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_BASE_URL || '').replace(/\/+$/, '')

const PLAYBACK_CACHE_TTL_MS = 30 * 60 * 1000
const playbackUrlCache = new Map()

function nowMs() {
  return Date.now()
}

function getMediaTypeKey(item) {
  if (item?.tipo === 'LIVE TV') return 'live'
  if (item?.tipo === 'MOVIES') return 'movie'
  if (item?.tipo === 'SERIES') return 'series'
  return String(item?.tipo || 'item').toLowerCase()
}

function getPlaybackCacheKey({ type, streamId, originalUrl }) {
  return `${type || 'item'}:${streamId || 'no-stream'}:${originalUrl || ''}`
}

function getCachedPlaybackUrl(cacheKey) {
  const cached = playbackUrlCache.get(cacheKey)
  if (!cached) return null
  if (nowMs() - cached.resolvedAt > PLAYBACK_CACHE_TTL_MS) {
    playbackUrlCache.delete(cacheKey)
    return null
  }
  return cached
}

function setCachedPlaybackUrl(cacheKey, value) {
  playbackUrlCache.set(cacheKey, { ...value, resolvedAt: nowMs() })
}

function clearCachedPlaybackUrl(cacheKey) {
  if (cacheKey) playbackUrlCache.delete(cacheKey)
}

function proxyExternalAssetUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return url || ''
  return buildStreamProxyUrl(url)
}


const navigationItems = [
  { id: 'live', title: 'LIVE TV', subtitle: 'Canais ao vivo', icon: '📺' },
  { id: 'movies', title: 'MOVIES', subtitle: 'Filmes', icon: '🎬' },
  { id: 'series', title: 'SERIES', subtitle: 'Séries', icon: '▣' },
  { id: 'favorites', title: 'FAVORITES', subtitle: 'Favoritos', icon: '★' },
]

function buildStreamProxyUrl(url) {
  if (!url) return ''
  return `${BACKEND_BASE_URL}/api/stream-proxy?url=${encodeURIComponent(url)}`
}

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

function hasCompleteSessionCredentials(credentials) {
  return Boolean(credentials?.server && credentials?.username && credentials?.password && !isMaskedPassword(credentials.password) && !String(credentials.password).includes('•'))
}

function buildXtreamPlaybackUrl(sessionCredentials, path, streamId, extension) {
  const playbackError = getSessionCredentialsPlaybackError(sessionCredentials)
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

function getSavedSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!saved?.expiresAt || Date.now() > saved.expiresAt || isMaskedPassword(saved.password) || String(saved.password || '').includes('•')) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return saved
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function loadSavedAccount() {
  const saved = getSavedSession()
  return saved ? { ...EMPTY_ACCOUNT, server: saved.server, username: saved.username, password: MASKED_PASSWORD, remember: true } : EMPTY_ACCOUNT
}

function saveAccount(account) {
  if (account.remember && !isMaskedPassword(account.password) && !String(account.password || '').includes('•')) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      server: account.server,
      username: account.username,
      password: account.password,
      expiresAt: Date.now() + SESSION_DURATION_MS,
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

const SEARCH_DEBOUNCE_MS = 350
const MIN_SEARCH_CHARS = 2
const MAX_SEARCH_RESULTS = 50

function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function pushAppHistoryState(state) {
  if (typeof window === 'undefined') return
  window.history.pushState({ app: 'webplayerpxt', ...state }, '')
}

function itemMatchesSearch(item, normalizedSearch) {
  if (!normalizedSearch) return true
  return normalizeSearchText(`${item?.nome || ''} ${item?.grupo || ''}`).includes(normalizedSearch)
}

function useDebouncedValue(value, delayMs = SEARCH_DEBOUNCE_MS) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [delayMs, value])

  return debouncedValue
}

function useCatalogSearch({ items, searchIndex = [], searchTerm, filterItem }) {
  const normalizedInput = normalizeSearchText(searchTerm)
  const debouncedSearch = useDebouncedValue(normalizedInput)
  const deferredSearch = useDeferredValue(debouncedSearch)
  const hasSearchText = normalizedInput.length > 0
  const canSearch = normalizedInput.length >= MIN_SEARCH_CHARS && deferredSearch.length >= MIN_SEARCH_CHARS
  const isSearchPending = normalizedInput.length >= MIN_SEARCH_CHARS && normalizedInput !== debouncedSearch

  const results = useMemo(() => {
    const baseItems = filterItem ? items.filter(filterItem) : items
    if (!canSearch) return []

    const indexedResults = (searchIndex.length ? searchIndex : baseItems.map((item) => ({ item, searchable: normalizeSearchText(`${item?.nome || ''} ${item?.grupo || ''}`) })))
      .filter((entry) => (!filterItem || filterItem(entry.item)) && entry.searchable.includes(deferredSearch))
      .slice(0, MAX_SEARCH_RESULTS)
      .map((entry) => entry.item)

    return indexedResults
  }, [canSearch, deferredSearch, filterItem, items, normalizedInput.length, searchIndex])

  return { results, hasSearchText, canSearch, isSearchPending }
}


function VirtualizedGrid({ items, className = 'channel-grid', ariaLabel, renderItem, estimateItemHeight = 210, overscanRows = 2 }) {
  const containerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(520)
  const [columns, setColumns] = useState(1)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined

    function measure() {
      const styles = window.getComputedStyle(element)
      const columnCount = styles.gridTemplateColumns.split(' ').filter(Boolean).length || 1
      setColumns(columnCount)
      setViewportHeight(element.clientHeight || 520)
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  const rowCount = Math.ceil(items.length / columns)
  const startRow = Math.max(0, Math.floor(scrollTop / estimateItemHeight) - overscanRows)
  const visibleRows = Math.ceil(viewportHeight / estimateItemHeight) + overscanRows * 2
  const endRow = Math.min(rowCount, startRow + visibleRows)
  const startIndex = startRow * columns
  const endIndex = Math.min(items.length, endRow * columns)
  const visibleItems = items.slice(startIndex, endIndex)

  return (
    <div ref={containerRef} className={className} aria-label={ariaLabel} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: startRow * estimateItemHeight, gridColumn: '1 / -1' }} aria-hidden="true" />
      {visibleItems.map(renderItem)}
      <div style={{ height: Math.max(0, (rowCount - endRow) * estimateItemHeight), gridColumn: '1 / -1' }} aria-hidden="true" />
    </div>
  )
}

function SearchStatus({ isSearchPending }) {
  return isSearchPending ? <span className="search-status"><span className="search-spinner" aria-hidden="true" />Pesquisando...</span> : null
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

function getItemDescription(item, fallback = '') {
  return item?.descricao || item?.description || item?.plot || item?.raw?.plot || item?.raw?.description || item?.raw?.overview || item?.raw?.info?.plot || fallback
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



function useResolvedPlaybackUrl({ item, originalUrl, fallbackUrl = '' }) {
  const [state, setState] = useState({ playbackUrl: '', fallbackPlaybackUrl: '', debug: {}, resolving: false })
  const requestIdRef = useRef(0)
  const itemStreamId = item?.streamId || item?.id || ''
  const type = getMediaTypeKey(item)
  const cacheKey = item && originalUrl ? getPlaybackCacheKey({ type, streamId: itemStreamId, originalUrl }) : ''

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!item || !originalUrl) {
      setState({ playbackUrl: '', fallbackPlaybackUrl: '', debug: {}, resolving: false })
      return undefined
    }

    const selectedAt = nowMs()
    const cached = getCachedPlaybackUrl(cacheKey)
    const initialPlaybackUrl = cached?.finalUrl || originalUrl
    setState({
      playbackUrl: initialPlaybackUrl,
      fallbackPlaybackUrl: fallbackUrl,
      resolving: !cached,
      debug: {
        mixedContentFound: /^http:\/\//i.test(originalUrl) ? 'sim (bloqueado pelo proxy HTTPS)' : 'não',
        originalUrl,
        finalUrl: cached?.finalUrl || '',
        proxyUrl: buildStreamProxyUrl(initialPlaybackUrl),
        cacheUsed: cached ? 'sim' : 'não',
        resolveTimeMs: cached ? 0 : '',
        playerStartTimeMs: 0,
        statusCode: cached?.statusCode ?? '',
        contentType: cached?.contentType || '',
        redirected: cached ? Boolean(cached.redirected) : '',
      },
    })

    if (cached) return undefined

    let cancelled = false
    async function resolveInBackground() {
      const resolveStartedAt = nowMs()
      try {
        const resolvedStream = await resolvePlaybackUrl(originalUrl)
        if (cancelled || requestIdRef.current !== requestId) return
        const finalUrl = resolvedStream.finalUrl || originalUrl
        const canUseResolvedUrl = finalUrl && Number(resolvedStream.statusCode) === 200
        const playbackUrl = canUseResolvedUrl ? finalUrl : originalUrl
        setCachedPlaybackUrl(cacheKey, { type, streamId: itemStreamId, originalUrl, finalUrl: playbackUrl, statusCode: resolvedStream.statusCode ?? '', contentType: resolvedStream.contentType || '', redirected: Boolean(resolvedStream.redirected) })
        setState((current) => ({
          ...current,
          playbackUrl,
          resolving: false,
          debug: {
            ...current.debug,
            mixedContentFound: /^http:\/\//i.test(originalUrl) || /^http:\/\//i.test(finalUrl) ? 'sim (bloqueado pelo proxy HTTPS)' : 'não',
            finalUrl,
            proxyUrl: buildStreamProxyUrl(playbackUrl),
            cacheUsed: 'não',
            resolveTimeMs: nowMs() - resolveStartedAt,
            playerStartTimeMs: nowMs() - selectedAt,
            statusCode: resolvedStream.statusCode ?? '',
            contentType: resolvedStream.contentType || '',
            redirected: Boolean(resolvedStream.redirected),
          },
        }))
      } catch (error) {
        if (cancelled || requestIdRef.current !== requestId) return
        setState((current) => ({ ...current, resolving: false, debug: { ...current.debug, errorSource: 'resolve-stream', errorDetail: error.message } }))
      }
    }

    resolveInBackground()
    return () => { cancelled = true }
  }, [cacheKey, fallbackUrl, item, itemStreamId, originalUrl, type])

  const clearCache = useCallback(() => clearCachedPlaybackUrl(cacheKey), [cacheKey])

  return { ...state, clearCache }
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

function LiveTvScreen({ channels, searchIndex, favorites, onToggleFavorite, sessionCredentials, onBack }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [playbackDebug, setPlaybackDebug] = useState({ url: '', format: 'm3u8', originalUrl: '', finalUrl: '', statusCode: '', contentType: '', redirected: '', loadedVideoUrl: '', hlsSupported: '', nativeHlsSupport: '', manifestParsed: '', playStatus: '', playError: '', videoError: '' })
  const [resolvedPlaybackUrl, setResolvedPlaybackUrl] = useState('')
  const resolveRequestIdRef = useRef(0)
  const playerPanelRef = useRef(null)

  const groups = useMemo(() => {
    const groupMap = channels.reduce((accumulator, channel) => {
      const groupName = channel.grupo || 'Sem categoria'
      accumulator[groupName] = (accumulator[groupName] || 0) + 1
      return accumulator
    }, {})

    return sortByName(Object.keys(groupMap)).map((name) => ({ name, count: groupMap[name] }))
  }, [channels])

  const activeGroup = selectedGroup && groups.some((group) => group.name === selectedGroup) ? selectedGroup : ''

  const hasLiveSearchInput = normalizeSearchText(searchTerm).length > 0
  const { results: filteredChannels, hasSearchText: isSearching, canSearch, isSearchPending } = useCatalogSearch({
    items: channels,
    searchIndex,
    searchTerm,
    filterItem: useCallback((channel) => hasLiveSearchInput || (activeGroup && channel.grupo === activeGroup), [activeGroup, hasLiveSearchInput]),
  })

  const isLiveSearchActive = canSearch
  const activeGroupTotal = groups.find((group) => group.name === activeGroup)?.count || 0
  const activeChannel = selectedChannel && channels.some((channel) => createChannelKey(channel) === createChannelKey(selectedChannel)) ? selectedChannel : null
  const activeStreamId = activeChannel?.streamId || activeChannel?.id
  const activePlaybackUrl = activeChannel ? buildXtreamPlaybackUrl(sessionCredentials, 'live', activeStreamId, 'm3u8') : ''
  const activeCacheKey = activeChannel && activePlaybackUrl ? getPlaybackCacheKey({ type: 'live', streamId: activeStreamId, originalUrl: activePlaybackUrl }) : ''
  const playerPlaybackUrl = resolvedPlaybackUrl || activePlaybackUrl

  useEffect(() => {
    if (activeChannel) playerPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeChannel])

  const updatePlaybackDebug = useCallback((debugInfo) => {
    setPlaybackDebug((currentDebug) => ({ ...currentDebug, ...debugInfo }))
    if (debugInfo?.errorSource === 'hls-fatal' || debugInfo?.errorSource?.includes('video-error')) {
      clearCachedPlaybackUrl(activeCacheKey)
      if (activeChannel) selectChannel(activeChannel)
    }
  }, [activeCacheKey, activeChannel])

  async function selectChannel(channel, event) {
    event?.preventDefault()
    event?.stopPropagation()
    const streamId = channel.streamId || channel.id
    const resolveRequestId = resolveRequestIdRef.current + 1
    resolveRequestIdRef.current = resolveRequestId
    const selectedAt = nowMs()
    const m3u8Url = buildXtreamPlaybackUrl(sessionCredentials, 'live', streamId, 'm3u8')
    const cacheKey = getPlaybackCacheKey({ type: 'live', streamId, originalUrl: m3u8Url })
    const cachedStream = getCachedPlaybackUrl(cacheKey)
    const initialProxyUrl = cachedStream ? buildStreamProxyUrl(cachedStream.finalUrl) : buildStreamProxyUrl(m3u8Url)

    setSelectedChannel(channel)
    setSearchTerm('')
    pushAppHistoryState({ screen: 'live', view: 'player' })
    setResolvedPlaybackUrl(cachedStream?.finalUrl || '')
    setPlaybackDebug({ url: initialProxyUrl, format: 'm3u8', originalUrl: m3u8Url, finalUrl: cachedStream?.finalUrl || '', statusCode: cachedStream?.statusCode ?? '', contentType: cachedStream?.contentType || '', redirected: cachedStream ? Boolean(cachedStream.redirected) : '', loadedVideoUrl: '', hlsSupported: '', nativeHlsSupport: '', manifestParsed: '', playStatus: '', playError: '', videoError: '', mixedContentFound: /^http:\/\//i.test(m3u8Url) ? 'sim (bloqueado pelo proxy HTTPS)' : 'não', proxyUrl: initialProxyUrl, cacheUsed: cachedStream ? 'sim' : 'não', resolveTimeMs: cachedStream ? 0 : '', playerStartTimeMs: 0 })
    if (!m3u8Url || cachedStream) return

    try {
      const resolveStartedAt = nowMs()
      const resolvedStream = await resolvePlaybackUrl(m3u8Url)
      if (resolveRequestIdRef.current !== resolveRequestId) return
      const canUseResolvedUrl = resolvedStream.finalUrl && Number(resolvedStream.statusCode) === 200
      const finalUrl = resolvedStream.finalUrl || m3u8Url
      const playbackUrl = canUseResolvedUrl ? finalUrl : m3u8Url
      const proxiedPlaybackUrl = buildStreamProxyUrl(playbackUrl)
      setCachedPlaybackUrl(cacheKey, { type: 'live', streamId, originalUrl: m3u8Url, finalUrl: playbackUrl, statusCode: resolvedStream.statusCode ?? '', contentType: resolvedStream.contentType || '', redirected: Boolean(resolvedStream.redirected) })
      setResolvedPlaybackUrl(playbackUrl)
      setPlaybackDebug({ url: proxiedPlaybackUrl, format: 'm3u8', originalUrl: resolvedStream.originalUrl || m3u8Url, finalUrl, statusCode: resolvedStream.statusCode ?? '', contentType: resolvedStream.contentType || '', redirected: Boolean(resolvedStream.redirected), mixedContentFound: /^http:\/\//i.test(m3u8Url) || /^http:\/\//i.test(finalUrl) ? 'sim (bloqueado pelo proxy HTTPS)' : 'não', proxyUrl: proxiedPlaybackUrl, cacheUsed: 'não', resolveTimeMs: nowMs() - resolveStartedAt, playerStartTimeMs: nowMs() - selectedAt })
    } catch (error) {
      if (resolveRequestIdRef.current !== resolveRequestId) return
      setPlaybackDebug((currentDebug) => ({ ...currentDebug, errorSource: 'resolve-stream', errorDetail: error.message }))
    }
  }

  function openLiveGroup(groupName) {
    setSelectedGroup(groupName)
    pushAppHistoryState({ screen: 'live', view: 'category' })
  }

  function closeLivePlayer() {
    setSelectedChannel(null)
    setResolvedPlaybackUrl('')
  }

  useEffect(() => {
    function handlePopState() {
      if (selectedChannel) {
        closeLivePlayer()
        return
      }
      if (activeGroup) {
        setSelectedGroup('')
        setSearchTerm('')
        return
      }
      onBack()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [activeGroup, selectedChannel, onBack])

  function toggleChannelFavorite(channel, event) {
    event.preventDefault()
    event.stopPropagation()
    onToggleFavorite(channel)
  }

  if (!channels.length) {
    return <main className="placeholder-wrap"><section className="panel placeholder"><div className="placeholder-icon">📺</div><p className="eyebrow">LIVE TV</p><h2>Nenhuma lista carregada</h2><p>Carregando catálogo...</p><button className="secondary-button" type="button" onClick={onBack}>VOLTAR</button></section></main>
  }

  const liveSearchControl = (
    <label className="search-label">
      <span>Buscar canal</span>
      <input className="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Nome ou categoria" />
    </label>
  )

  const liveResultsGrid = (
    <>
      <div className="channel-count-row"><span>{filteredChannels.length} canais encontrados</span><span>{favorites.length} favoritos</span><SearchStatus isSearchPending={isSearchPending} /></div>
      {isSearching && !canSearch ? <p className="empty">Digite pelo menos 2 caracteres para pesquisar.</p> : filteredChannels.length > 0 ? <VirtualizedGrid items={filteredChannels} ariaLabel="Resultados globais de LIVE TV" renderItem={(channel) => { const channelKey = createChannelKey(channel); const quality = getChannelQuality(channel); const isFavorite = Boolean(findFavorite(favorites, channel)); return <article className="channel-card" key={channelKey} onClick={(event) => selectChannel(channel, event)} aria-label={`Canal ${channel.nome}`}><button className={`favorite-button ${isFavorite ? 'active' : ''}`} type="button" onClick={(event) => toggleChannelFavorite(channel, event)} aria-label={isFavorite ? `Remover ${channel.nome} dos favoritos` : `Favoritar ${channel.nome}`}>★</button><button className="channel-play-button" type="button" onClick={(event) => selectChannel(channel, event)} aria-label={`Reproduzir ${channel.nome}`}><div className="channel-logo-wrap">{channel.logo ? <img src={proxyExternalAssetUrl(channel.logo)} alt={`Logo ${channel.nome}`} loading="lazy" /> : <span className="channel-icon">📺</span>}</div><strong title={channel.nome}>{channel.nome}</strong><small title={channel.grupo}>{channel.grupo}</small>{quality && <span className="quality-badge">{quality}</span>}</button></article> }} /> : <p className="empty">Nenhum canal encontrado com a busca atual.</p>}
    </>
  )

  if (activeChannel && !isLiveSearchActive) {
    return (
      <main className="single-screen" aria-label={`Player do canal ${activeChannel.nome}`} ref={playerPanelRef}>
        <section className="panel channel-panel player-only-panel">
          <div className="section-heading compact"><div><p className="eyebrow">Player LIVE TV</p><h2>{activeChannel.nome}</h2></div><div className="detail-actions">{liveSearchControl}<button className="secondary-button" type="button" onClick={closeLivePlayer}>VOLTAR</button></div></div>
          <div className="live-player-card player-only-card"><HlsPlayer url={playerPlaybackUrl ? buildStreamProxyUrl(playerPlaybackUrl) : ''} fallbackUrl={resolvedPlaybackUrl ? buildStreamProxyUrl(resolvedPlaybackUrl) : ''} contentType={playbackDebug.contentType} title={activeChannel.nome} onPlaybackUrlChange={updatePlaybackDebug} /><div className="live-player-info"><p className="eyebrow">Ao vivo</p><h3>{activeChannel.nome}</h3><p>Reproduzindo o canal selecionado.</p></div></div>
        </section>
      </main>
    )
  }

  if (!activeGroup && !isLiveSearchActive) {
    return (
      <main className="section-home" aria-label="Categorias de LIVE TV">
        <section className="panel section-home-panel">
          <div className="section-heading compact"><div><p className="eyebrow">Categorias</p><h2>LIVE TV</h2></div><div className="detail-actions">{liveSearchControl}<button className="secondary-button" type="button" onClick={onBack}>VOLTAR</button></div></div>
          <div className="category-grid" role="list" aria-label="Categorias de TV">{groups.map((group) => <button key={group.name} type="button" className="category-card" onClick={() => openLiveGroup(group.name)}><span>📺</span><strong>{group.name}</strong><small>{group.count} canais</small></button>)}</div>
        </section>
      </main>
    )
  }

  return (
    <main className="catalog-detail" aria-label={isLiveSearchActive ? 'Busca global de LIVE TV' : `Canais de ${activeGroup}`}>
      <section className="panel channel-panel">
        <div className="section-heading"><div><p className="eyebrow">{isLiveSearchActive ? 'Busca global' : activeGroup}</p><h2>{isLiveSearchActive ? 'Resultados em todos os canais' : `${activeGroupTotal} canais na categoria`}</h2></div><div className="detail-actions"><button className="secondary-button" type="button" onClick={() => { setSelectedGroup(''); setSearchTerm('') }}>VOLTAR</button>{liveSearchControl}</div></div>
        {liveResultsGrid}
      </section>
    </main>
  )
}

function CatalogScreen({ title, icon, items, searchIndex, favorites, onToggleFavorite, onSelectItem, selectedItem, playerTitle, playerDescription, playerUrl, playerFallbackUrl, detailContent, afterContent, onBack, onCategoryBack, onPlayerBack }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const playerPanelRef = useRef(null)

  const groups = useMemo(() => {
    const groupMap = items.reduce((accumulator, item) => {
      const groupName = item.grupo || 'Sem categoria'
      accumulator[groupName] = (accumulator[groupName] || 0) + 1
      return accumulator
    }, {})
    return sortByName(Object.keys(groupMap)).map((name) => ({ name, count: groupMap[name] }))
  }, [items])

  const hasCatalogSearchInput = normalizeSearchText(searchTerm).length > 0
  const { results: filteredItems, hasSearchText: isSearching, canSearch, isSearchPending } = useCatalogSearch({
    items,
    searchIndex,
    searchTerm,
    filterItem: useCallback((item) => hasCatalogSearchInput || !selectedGroup || item.grupo === selectedGroup, [hasCatalogSearchInput, selectedGroup]),
  })


  const isCatalogSearchActive = canSearch

  useEffect(() => {
    if (playerUrl || playerFallbackUrl) playerPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [playerFallbackUrl, playerUrl])

  function openCatalogGroup(groupName) {
    setSelectedGroup(groupName)
    pushAppHistoryState({ screen: title.toLowerCase(), view: 'category' })
  }

  function selectCatalogItem(item) {
    setSearchTerm('')
    onSelectItem(item)
    pushAppHistoryState({ screen: title.toLowerCase(), view: 'detail' })
  }

  function goBackToCategories() {
    setSelectedGroup('')
    setSearchTerm('')
    onCategoryBack?.()
  }

  useEffect(() => {
    function handlePopState() {
      if (playerUrl || playerFallbackUrl) {
        onPlayerBack?.()
        return
      }
      if (selectedItem) {
        onCategoryBack?.()
        return
      }
      if (selectedGroup) {
        goBackToCategories()
        return
      }
      onBack?.()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [onBack, onCategoryBack, onPlayerBack, playerFallbackUrl, playerUrl, selectedGroup, selectedItem])

  if (!items.length) {
    return (
      <main className="placeholder-wrap">
        <section className="panel placeholder">
          <div className="placeholder-icon">{icon}</div>
          <p className="eyebrow">{title}</p>
          <h2>Nenhum item carregado</h2>
          <p>Carregando catálogo...</p>
          <button className="secondary-button" type="button" onClick={onBack}>VOLTAR</button>
        </section>
      </main>
    )
  }

  const searchControl = (
    <label className="search-label"><span>Buscar</span><input className="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Digite nome ou categoria" /></label>
  )

  const itemsGrid = (
    <>
      <div className="channel-count-row"><span>{filteredItems.length} itens encontrados</span><span>{favorites.length} favoritos</span><SearchStatus isSearchPending={isSearchPending} /></div>
      {isSearching && !canSearch ? <p className="empty">Digite pelo menos 2 caracteres para pesquisar.</p> : filteredItems.length > 0 ? (
        <VirtualizedGrid className="channel-grid media-card-grid" items={filteredItems} ariaLabel={isCatalogSearchActive ? `Resultados globais de ${title}` : `Itens de ${selectedGroup}`} estimateItemHeight={270} renderItem={(item) => {
          const itemKey = createItemKey(item)
          const isFavorite = Boolean(findFavorite(favorites, item))
          const poster = getItemPoster(item)
          return (
            <article className={`channel-card media-card ${selectedItem && createItemKey(selectedItem) === itemKey ? 'active' : ''}`} key={itemKey}>
              <button className={`favorite-button ${isFavorite ? 'active' : ''}`} type="button" onClick={() => onToggleFavorite(item)} aria-label={isFavorite ? `Remover ${item.nome} dos favoritos` : `Favoritar ${item.nome}`}>★</button>
              <button className="channel-play-button" type="button" onClick={() => selectCatalogItem(item)} aria-label={`Abrir ${item.nome}`}>
                <div className="channel-logo-wrap poster-wrap">{poster ? <img src={poster} alt={`Poster ${item.nome}`} loading="lazy" /> : <span className="channel-icon">{icon}</span>}</div>
                <strong title={item.nome}>{item.nome}</strong>
                <small title={item.grupo}>{item.grupo}</small>
              </button>
            </article>
          )
        }} />
      ) : <p className="empty">Nenhum item encontrado com a busca atual.</p>}
    </>
  )

  if ((playerUrl || playerFallbackUrl) && selectedItem && !isCatalogSearchActive) {
    return (
      <main className="single-screen" aria-label={`Player de ${playerTitle || title}`} ref={playerPanelRef}>
        <section className="panel channel-panel player-only-panel">
          <div className="section-heading compact">
            <div><p className="eyebrow">Player {title}</p><h2>{playerTitle || title}</h2></div>
            <div className="detail-actions">{searchControl}<button className="secondary-button" type="button" onClick={onPlayerBack}>VOLTAR</button></div>
          </div>
          <div className="live-player-card player-only-card">
            <HlsPlayer url={playerUrl ? buildStreamProxyUrl(playerUrl) : ''} fallbackUrl={playerFallbackUrl ? buildStreamProxyUrl(playerFallbackUrl) : ''} title={playerTitle || title} />
            <div className="live-player-info"><p className="eyebrow">Reprodução</p><h3>{playerTitle || title}</h3><p>{playerDescription || 'Reproduzindo item selecionado.'}</p></div>
          </div>
        </section>
      </main>
    )
  }

  if (selectedItem && detailContent && !isCatalogSearchActive) {
    return (
      <main className="single-screen" aria-label={`Detalhes de ${selectedItem.nome}`}>
        <section className="panel channel-panel">
          <div className="section-heading compact"><div><p className="eyebrow">Busca global</p><h2>{title}</h2></div>{searchControl}</div>
          {detailContent}
          {afterContent}
        </section>
      </main>
    )
  }

  if (!selectedGroup && !isCatalogSearchActive) {
    return (
      <main className="section-home" aria-label={`Categorias de ${title}`}>
        <section className="panel section-home-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Categorias</p>
              <h2>{title}</h2>
            </div>
            <div className="detail-actions">{searchControl}<button className="secondary-button" type="button" onClick={onBack}>VOLTAR</button></div>
          </div>
          <div className="category-grid" role="list" aria-label={`Categorias de ${title}`}>
            {groups.map((group) => (
              <button key={group.name} type="button" className="category-card" onClick={() => openCatalogGroup(group.name)}>
                <span>{icon}</span>
                <strong>{group.name}</strong>
                <small>{group.count} itens</small>
              </button>
            ))}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="catalog-detail" aria-label={isCatalogSearchActive ? `Busca global de ${title}` : `Itens de ${selectedGroup}`}>
      <section className="panel channel-panel">
        <div className="section-heading">
          <div><p className="eyebrow">{isCatalogSearchActive ? 'Busca global' : title}</p><h2>{isCatalogSearchActive ? `Resultados em ${title}` : selectedGroup}</h2></div>
          <div className="detail-actions">
            <button className="secondary-button" type="button" onClick={goBackToCategories}>VOLTAR</button>
            {searchControl}
          </div>
        </div>
        {itemsGrid}
      </section>
    </main>
  )
}

function MediaDetail({ item, icon, actionLabel, onAction, onBack, children }) {
  if (!item) return null
  const poster = getItemPoster(item)
  const description = getItemDescription(item, 'Sem descrição disponível para este título.')

  return (
    <section className="media-detail-panel" aria-label={`Detalhes de ${item.nome}`}>
      <div className="media-detail-poster">{poster ? <img src={poster} alt={`Capa ${item.nome}`} /> : <span>{icon}</span>}</div>
      <div className="media-detail-copy">
        <p className="eyebrow">Detalhes</p>
        <h2>{item.nome}</h2>
        <p>{description}</p>
        {children}
        <div className="detail-actions">
          {onAction && <button className="primary-button" type="button" onClick={onAction}>{actionLabel}</button>}
          <button className="secondary-button" type="button" onClick={onBack}>VOLTAR</button>
        </div>
      </div>
    </section>
  )
}

function MoviesScreen({ sessionCredentials, items, searchIndex, favorites, onToggleFavorite, onBack }) {
  const [selectedMovie, setSelectedMovie] = useState(null)
  const [playingMovie, setPlayingMovie] = useState(null)
  const originalMovieUrl = playingMovie ? getPlayableItemUrl(playingMovie, sessionCredentials) : ''
  const moviePlayback = useResolvedPlaybackUrl({ item: playingMovie, originalUrl: originalMovieUrl })
  const handleMoviePlaybackDebug = useCallback((debugInfo) => {
    if (debugInfo?.errorSource === 'hls-fatal' || debugInfo?.errorSource?.includes('video-error')) moviePlayback.clearCache()
  }, [moviePlayback.clearCache])

  return (
    <CatalogScreen
      title="MOVIES"
      icon="🎬"
      items={items}
      searchIndex={searchIndex}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onSelectItem={(movie) => { setSelectedMovie(movie); setPlayingMovie(null) }}
      selectedItem={selectedMovie}
      detailContent={<MediaDetail item={selectedMovie} icon="🎬" actionLabel="CONTINUAR / JOGAR" onAction={() => setPlayingMovie(selectedMovie)} onBack={() => { setSelectedMovie(null); setPlayingMovie(null) }} />}
      playerTitle={playingMovie?.nome || ''}
      playerDescription={playingMovie ? 'Reproduzindo filme selecionado.' : ''}
      playerUrl={moviePlayback.playbackUrl}
      onPlayerBack={() => setPlayingMovie(null)}
      onBack={onBack}
      onCategoryBack={() => { setSelectedMovie(null); setPlayingMovie(null) }}
    />
  )
}

function SeriesScreen({ sessionCredentials, items, searchIndex, favorites, onToggleFavorite, onBack }) {
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
  const episodePlaybackItem = useMemo(() => (selectedEpisode ? { ...selectedEpisode, tipo: 'SERIES', streamId: selectedEpisode.id || selectedEpisode.episode_id } : null), [selectedEpisode])
  const episodePlayback = useResolvedPlaybackUrl({ item: episodePlaybackItem, originalUrl: episodeUrl })
  const handleEpisodePlaybackDebug = useCallback((debugInfo) => {
    if (debugInfo?.errorSource === 'hls-fatal' || debugInfo?.errorSource?.includes('video-error')) episodePlayback.clearCache()
  }, [episodePlayback.clearCache])

  const description = loadingInfo
    ? 'Carregando temporadas e episódios...'
    : error || (selectedEpisode ? `Temporada ${selectedEpisode.seasonNumber || selectedEpisode.season || ''}` : selectedSeries ? 'Escolha um episódio abaixo.' : 'Clique em uma série para carregar episódios.')

  const episodesPanel = selectedSeries ? (
    <div className="series-episodes-wrap">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Temporadas / Episódios</p>
          <h2>Escolha um episódio</h2>
        </div>
        <span className="category-total">{episodes.length}</span>
      </div>
      {loadingInfo && <p>Carregando episódios...</p>}
      {error && <p className="status error">{error}</p>}
      {!loadingInfo && !error && episodes.length === 0 && <p>Nenhum episódio encontrado para esta série.</p>}
      {episodes.length > 0 && (
        <ul className="episode-list" aria-label="Episódios da série">
          {episodes.map((episode) => (
            <li key={`${episode.seasonNumber}-${episode.id || episode.episode_id}`}>
              <button className={`episode-button ${selectedEpisode && (selectedEpisode.id || selectedEpisode.episode_id) === (episode.id || episode.episode_id) ? 'active' : ''}`} type="button" onClick={() => setSelectedEpisode(episode)}>
                <span>{episode.title || `Episódio ${episode.episode_num || episode.id}`}</span><small>T{episode.seasonNumber || episode.season || '?'} • {getItemContainerExtension({ raw: episode })}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null

  const seriesDetail = (
    <MediaDetail item={selectedSeries} icon="▣" onBack={() => { setSelectedSeries(null); setSelectedEpisode(null); setSeriesInfo(null); setError('') }}>
      {episodesPanel}
    </MediaDetail>
  )

  return (
    <CatalogScreen title="SERIES" icon="▣" items={items} searchIndex={searchIndex} favorites={favorites} onToggleFavorite={onToggleFavorite} onSelectItem={selectSeries} selectedItem={selectedSeries} playerTitle={selectedEpisode?.title || ''} playerDescription={description} playerUrl={episodePlayback.playbackUrl} playbackDebug={episodePlayback.debug} onPlaybackUrlChange={handleEpisodePlaybackDebug} isResolving={episodePlayback.resolving} detailContent={seriesDetail} onPlayerBack={() => setSelectedEpisode(null)} onBack={onBack} onCategoryBack={() => { setSelectedSeries(null); setSelectedEpisode(null); setSeriesInfo(null); setError('') }} />
  )
}

function FavoritesScreen({ sessionCredentials, favorites, catalogItems, onToggleFavorite, onOpenSeries, onBack }) {
  const catalogByKey = useMemo(() => catalogItems.reduce((accumulator, item) => ({ ...accumulator, [createItemKey(item)]: item }), {}), [catalogItems])
  const favoriteItems = favorites.map((favorite) => catalogByKey[favorite.key] || favorite)
  const [selectedItem, setSelectedItem] = useState(null)
  const originalFavoriteUrl = selectedItem ? getPlayableItemUrl(selectedItem, sessionCredentials) : ''
  const originalFavoriteFallbackUrl = selectedItem?.tipo === 'LIVE TV' ? buildXtreamPlaybackUrl(sessionCredentials, 'live', selectedItem.streamId || selectedItem.id, 'ts') : ''
  const favoritePlayback = useResolvedPlaybackUrl({ item: selectedItem, originalUrl: originalFavoriteUrl, fallbackUrl: originalFavoriteFallbackUrl })
  const handleFavoritePlaybackDebug = useCallback((debugInfo) => {
    if (debugInfo?.errorSource === 'hls-fatal' || debugInfo?.errorSource?.includes('video-error')) favoritePlayback.clearCache()
  }, [favoritePlayback.clearCache])

  function openFavorite(item) {
    if (item.tipo === 'SERIES') {
      onOpenSeries()
      return
    }
    setSelectedItem(item)
  }

  return <CatalogScreen onBack={onBack} title="FAVORITES" icon="★" items={favoriteItems} favorites={favorites} onToggleFavorite={onToggleFavorite} onSelectItem={openFavorite} selectedItem={selectedItem} playerTitle={selectedItem?.nome || ''} playerDescription={selectedItem ? 'Reproduzindo favorito selecionado.' : 'Clique em um favorito para reproduzir.'} playerUrl={selectedItem ? getPlayableItemUrl(selectedItem, sessionCredentials) : ''} playerFallbackUrl={selectedItem?.tipo === 'LIVE TV' ? buildXtreamPlaybackUrl(sessionCredentials, 'live', selectedItem.streamId || selectedItem.id, 'ts') : ''} onPlayerBack={() => setSelectedItem(null)} />
}

function Topbar({ screen, onNavigate }) {
  return (
    <header className="topbar">
      <button className="logo" onClick={() => onNavigate('home')} aria-label="Abrir início">
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

function HomeScreen({ loading, onNavigate }) {
  const cards = navigationItems

  return (
    <main className="home section-home" aria-label="Tela inicial do catálogo">
      <section className="panel section-home-panel">
        <p className="eyebrow">Catálogo IPTV</p>
        <h1>Escolha uma área</h1>
        {loading && <p className="catalog-loading">Carregando catálogo...</p>}
        <div className="main-menu">
          {cards.map((item) => (
            <button key={item.id} type="button" className="menu-card" onClick={() => onNavigate(item.id)}>
              <span className="menu-icon">{item.icon}</span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </button>
          ))}
        </div>
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
  const [screen, setScreen] = useState(getSavedSession() ? 'home' : 'account')
  const [account, setAccount] = useState(loadSavedAccount)
  const [sessionCredentials, setSessionCredentials] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: '', message: '' })
  const [favorites, setFavorites] = useState(loadSavedFavorites)
  const mediaManager = useMediaManager()
  const isConnected = Boolean(sessionCredentials)

  useEffect(() => {
    const saved = getSavedSession()
    if (!saved) return undefined
    const timeoutId = window.setTimeout(() => {
      localStorage.removeItem(STORAGE_KEY)
      setSessionCredentials(null)
      mediaManager.clearCatalog()
      setAccount(EMPTY_ACCOUNT)
      setScreen('account')
      setStatus({ type: 'error', message: 'Sessão expirada após 6 horas. Faça login novamente.' })
    }, Math.max(saved.expiresAt - Date.now(), 0))
    return () => window.clearTimeout(timeoutId)
  }, [mediaManager, sessionCredentials])

  useEffect(() => {
    const saved = getSavedSession()
    if (!saved) return
    const restoredCredentials = { server: saved.server, username: saved.username, password: saved.password, remember: true }
    setSessionCredentials({ server: normalizeServer(saved.server), username: saved.username.trim(), password: saved.password })
    setAccount({ ...EMPTY_ACCOUNT, server: saved.server, username: saved.username, password: MASKED_PASSWORD, remember: true })
    handleConnection('Sessão restaurada', restoredCredentials)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  async function handleConnection(successMessage = 'Conectado com sucesso', credentialsOverride = null) {
    const formCredentials = credentialsOverride || getAccountCredentials(account)
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
      setScreen('home')
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
    setScreen('account')
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

  const isHandlingBrowserBackRef = useRef(false)

  useEffect(() => {
    window.history.replaceState({ app: 'webplayerpxt', screen }, '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handlePopState(event) {
      const nextScreen = event.state?.screen || 'home'
      isHandlingBrowserBackRef.current = true
      setScreen(nextScreen)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigateScreen = useCallback((nextScreen) => {
    setScreen(nextScreen)
    if (isHandlingBrowserBackRef.current) {
      isHandlingBrowserBackRef.current = false
      return
    }
    pushAppHistoryState({ screen: nextScreen })
  }, [])

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
      {isConnected && <Topbar screen={screen} onNavigate={navigateScreen} />}

      {!isConnected || screen === 'account' ? (
        <AccountScreen account={account} setAccount={setAccount} sessionCredentials={sessionCredentials} onConnect={() => handleConnection('Conectado com sucesso')} onRefresh={() => handleConnection('Conectado com sucesso')} onClear={clearData} loading={loading} status={status} />
      ) : screen === 'home' ? (
        <HomeScreen loading={loading} onNavigate={navigateScreen} />
      ) : screen === 'live' ? (
        <LiveTvScreen channels={mediaManager.live} searchIndex={mediaManager.searchIndex.live} favorites={favorites} onToggleFavorite={toggleFavoriteItem} sessionCredentials={sessionCredentials} onBack={() => navigateScreen('home')} />
      ) : screen === 'movies' ? (
        <MoviesScreen sessionCredentials={sessionCredentials} items={mediaManager.movies} searchIndex={mediaManager.searchIndex.movies} favorites={favorites} onToggleFavorite={toggleFavoriteItem} onBack={() => navigateScreen('home')} />
      ) : screen === 'series' ? (
        <SeriesScreen sessionCredentials={sessionCredentials} items={mediaManager.series} searchIndex={mediaManager.searchIndex.series} favorites={favorites} onToggleFavorite={toggleFavoriteItem} onBack={() => navigateScreen('home')} />
      ) : screen === 'favorites' ? (
        <FavoritesScreen sessionCredentials={sessionCredentials} favorites={favorites} catalogItems={mediaManager.all} onToggleFavorite={toggleFavoriteItem} onOpenSeries={() => navigateScreen('series')} onBack={() => navigateScreen('home')} />
      ) : (
        <PlaceholderScreen title={currentItem.title} subtitle={currentItem.subtitle} icon={currentItem.icon} mediaItems={currentMediaItems} total={currentMediaItems.length} />
      )}

      {isConnected && <FooterNavigation screen={screen} onNavigate={navigateScreen} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <MediaManagerProvider>
    <App />
  </MediaManagerProvider>,
)
