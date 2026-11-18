import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import HlsPlayer from './HlsPlayer.jsx'
import { MediaManagerProvider, useMediaManager, parseM3UPlaylist } from './mediaManager.jsx'
import { getCachedCatalog, setCachedCatalog } from './idbStorage.js'
import './styles.css'

const DEFAULT_SERVER = 'http://ttvp2.live'
const STORAGE_KEY = 'authorized-iptv-player-account'
const FAVORITES_STORAGE_KEY = 'authorized-iptv-player-favorites'
const SESSION_DURATION_MS = 6 * 60 * 60 * 1000
const EMPTY_ACCOUNT = { server: DEFAULT_SERVER, username: '', password: '', remember: true }
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
  if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
    return url
  }
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
  if (url.startsWith('/api/stream-proxy')) return url
  // Se a página estiver rodando em HTTPS (ex: Render), envelopa o fluxo no proxy
  // para reescrever as playlists .m3u8 e evitar bloqueio de Mixed Content no navegador/mobile
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  if (isHttps || BACKEND_BASE_URL) {
    return `${BACKEND_BASE_URL}/api/stream-proxy?url=${encodeURIComponent(url)}`
  }
  return url
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

  if (item?.tipo === 'MOVIES') {
    const ext = getItemContainerExtension(item)
    return buildXtreamPlaybackUrl(sessionCredentials, 'movie', streamId, ext)
  }
  if (item?.tipo === 'LIVE TV') return buildXtreamPlaybackUrl(sessionCredentials, 'live', streamId, 'm3u8')

  return item?.url || ''
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

async function fetchDirectXtreamCatalog(account, initialData, onBackgroundUpdate = null) {
  const normServer = normalizeServer(account.server)
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'

  async function fetchAction(action, timeoutMs = 12000) {
    try {
      let targetUrl
      if (isHttps || BACKEND_BASE_URL) {
        const proxyUrl = new URL(`${BACKEND_BASE_URL || window.location.origin}/api/xtream/action`)
        proxyUrl.searchParams.set('server', normServer)
        proxyUrl.searchParams.set('username', account.username)
        proxyUrl.searchParams.set('password', account.password)
        proxyUrl.searchParams.set('action', action)
        targetUrl = proxyUrl.toString()
      } else {
        const directUrl = new URL('/player_api.php', normServer)
        directUrl.searchParams.set('username', account.username)
        directUrl.searchParams.set('password', account.password)
        directUrl.searchParams.set('action', action)
        targetUrl = directUrl.toString()
      }

      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const r = await fetch(targetUrl, {
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: ctrl.signal,
      })
      clearTimeout(t)
      if (r.ok) {
        const json = await r.json()
        return Array.isArray(json) ? json : []
      }
    } catch (err) {
      console.warn(`[XTREAM CATALOG] Falha em ${action}:`, err.message)
    }
    return []
  }

  // ETAPA 1 (Ultra Rápida: < 1s): Busca categorias e canais de TV ao vivo primeiro
  const [
    liveCategories,
    movieCategories,
    seriesCategories,
    liveStreams,
  ] = await Promise.all([
    fetchAction('get_live_categories', 8000),
    fetchAction('get_vod_categories', 8000),
    fetchAction('get_series_categories', 8000),
    fetchAction('get_live_streams', 10000),
  ])

  // Se liveStreams for vazio, tenta obter via M3U (get.php) como fallback inteligente
  if (!liveStreams.length) {
    try {
      const m3uUrl = new URL('/get.php', normServer)
      m3uUrl.searchParams.set('username', account.username)
      m3uUrl.searchParams.set('password', account.password)
      m3uUrl.searchParams.set('type', 'm3u_plus')
      m3uUrl.searchParams.set('output', 'm3u8')
      const targetM3u = isHttps || BACKEND_BASE_URL
        ? `${BACKEND_BASE_URL || window.location.origin}/api/stream-proxy?url=${encodeURIComponent(m3uUrl.toString())}`
        : m3uUrl.toString()
      const m3uCtrl = new AbortController()
      const m3uT = setTimeout(() => m3uCtrl.abort(), 12000)
      const m3uRes = await fetch(targetM3u, { signal: m3uCtrl.signal })
      clearTimeout(m3uT)
      if (m3uRes.ok) {
        const m3uText = await m3uRes.text()
        if (m3uText && m3uText.includes('#EXTINF')) {
          const parsedM3u = parseM3UPlaylist(m3uText, normServer)
          if (parsedM3u.live.length > 0 || parsedM3u.movies.length > 0 || parsedM3u.series.length > 0) {
            return {
              liveCategories: Object.keys(parsedM3u.groups || {}).map((g) => ({ category_id: g, category_name: g })),
              movieCategories: [],
              seriesCategories: [],
              liveStreams: parsedM3u.live.map((c) => ({
                stream_id: c.streamId || c.id,
                name: c.nome,
                category_name: c.grupo,
                stream_icon: c.logo,
              })),
              vodStreams: parsedM3u.movies.map((m) => ({
                stream_id: m.streamId || m.id,
                name: m.nome,
                category_name: m.grupo,
                stream_icon: m.logo,
              })),
              series: parsedM3u.series.map((s) => ({
                series_id: s.streamId || s.id,
                name: s.nome,
                category_name: s.grupo,
                cover: s.logo,
              })),
              user_info: initialData?.user_info || {},
              server_info: initialData?.server_info || {},
              fetchedAt: new Date().toISOString(),
            }
          }
        }
      }
    } catch (e) {
      console.warn('[M3U FALLBACK] Falha:', e.message)
    }
  }

  const stage1Catalog = {
    liveCategories,
    movieCategories,
    seriesCategories,
    liveStreams,
    vodStreams: [],
    series: [],
    user_info: initialData?.user_info || {},
    server_info: initialData?.server_info || {},
    fetchedAt: new Date().toISOString(),
  }

  // ETAPA 2 (Segundo plano): Baixa filmes e séries em background sem travar a interface
  const bgFetchVodAndSeries = async () => {
    try {
      const [vodStreams, series] = await Promise.all([
        fetchAction('get_vod_streams', 40000),
        fetchAction('get_series', 40000),
      ])
      const completeCatalog = {
        ...stage1Catalog,
        vodStreams: vodStreams || [],
        series: series || [],
        fetchedAt: new Date().toISOString(),
      }
      if (typeof onBackgroundUpdate === 'function') {
        onBackgroundUpdate(completeCatalog)
      }
    } catch (bgErr) {
      console.warn('[XTREAM BACKGROUND] Falha ao sincronizar VOD/Séries:', bgErr.message)
    }
  }

  // Dispara em background imediatamente
  bgFetchVodAndSeries()

  return stage1Catalog
}

async function validateXtreamAccount(account, onBackgroundUpdate = null) {
  const normServer = normalizeServer(account.server)
  if (!normServer || !account.username?.trim() || !account.password?.trim()) {
    throw new Error('Preencha servidor, usuário e senha.')
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'

  // 1. Em HTTPS (Render ou produção), todas as chamadas passam pelo proxy backend
  // para evitar erro de Mixed Content no celular e bloqueios de CORS
  if (isHttps || BACKEND_BASE_URL) {
    const validateEndpoint = `${BACKEND_BASE_URL || window.location.origin}/api/xtream/validate`
    const response = await fetch(validateEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server: normServer,
        username: account.username.trim(),
        password: account.password.trim(),
      }),
    })

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorBody = await response.json()
        errorMessage = errorBody.error || errorMessage
      } catch {
        errorMessage = (await response.text()) || errorMessage
      }
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const userInfo = data?.user_info || data || {}
    if (userInfo.auth === 0) {
      throw new Error('Usuário ou senha inválidos.')
    }

    // Carrega o catálogo através das rotas de proxy HTTPS
    const catalog = await fetchDirectXtreamCatalog(account, data, onBackgroundUpdate)

    return {
      ok: true,
      status: userInfo.status ?? 'Active',
      auth: userInfo.auth ?? 1,
      username: userInfo.username ?? account.username,
      exp_date: userInfo.exp_date ?? null,
      max_connections: userInfo.max_connections ?? null,
      active_cons: userInfo.active_cons ?? null,
      allowed_output_formats: userInfo.allowed_output_formats ?? ['m3u8', 'ts'],
      catalog,
      user_info: userInfo,
      server_info: data?.server_info || {},
    }
  }

  // 2. Ambiente HTTP puro local: tenta validação direta primeiro
  const directLoginUrl = buildXtreamLoginUrl(account)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    const directResponse = await fetch(directLoginUrl, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (directResponse.ok) {
      const data = await directResponse.json()
      const userInfo = data?.user_info || {}
      if (userInfo.auth === 1 || userInfo.status === 'Active') {
        const catalog = await fetchDirectXtreamCatalog(account, data, onBackgroundUpdate)
        return {
          ok: true,
          status: userInfo.status ?? null,
          auth: userInfo.auth ?? null,
          username: userInfo.username ?? null,
          exp_date: userInfo.exp_date ?? null,
          max_connections: userInfo.max_connections ?? null,
          active_cons: userInfo.active_cons ?? null,
          allowed_output_formats: userInfo.allowed_output_formats ?? [],
          catalog,
          user_info: userInfo,
          server_info: data?.server_info || {},
        }
      } else if (userInfo.auth === 0) {
        throw new Error('Usuário ou senha inválidos.')
      }
    }
  } catch (directErr) {
    if (directErr.message === 'Usuário ou senha inválidos.') {
      throw directErr
    }
    console.info('Tentativa direta falhou, utilizando backend proxy...', directErr.message)
  }

  // Fallback via backend proxy
  const response = await fetch(`${BACKEND_BASE_URL || window.location.origin}/api/xtream/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server: normServer,
      username: account.username.trim(),
      password: account.password.trim(),
    }),
  })

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`
    try {
      const errorBody = await response.json()
      errorMessage = errorBody.error || errorMessage
    } catch {
      errorMessage = (await response.text()) || errorMessage
    }
    throw new Error(errorMessage)
  }

  const data = await response.json()
  const userInfo = data?.user_info || data || {}
  const catalog = await fetchDirectXtreamCatalog(account, data, onBackgroundUpdate)

  return {
    ok: true,
    status: userInfo.status ?? 'Active',
    auth: userInfo.auth ?? 1,
    username: userInfo.username ?? account.username,
    exp_date: userInfo.exp_date ?? null,
    max_connections: userInfo.max_connections ?? null,
    active_cons: userInfo.active_cons ?? null,
    allowed_output_formats: userInfo.allowed_output_formats ?? [],
    catalog,
    user_info: userInfo,
    server_info: data?.server_info || {},
  }
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[-_.:/,+()!?@#$%&*"'`~^|\\<>{}[\]]/g, ' ') // hífens e pontuações viram espaço
    .replace(/\s+/g, ' ') // múltiplos espaços viram um só
    .trim()
    .toLowerCase()
}

function pushAppHistoryState(state) {
  if (typeof window === 'undefined') return
  window.history.pushState({ app: 'webplayerpxt', ...state }, '')
}

function itemMatchesSearch(item, normalizedSearch) {
  if (!normalizedSearch) return true
  const searchTokens = normalizeSearchText(normalizedSearch).split(' ').filter(Boolean)
  if (searchTokens.length === 0) return true
  const itemText = normalizeSearchText(`${item?.nome || ''} ${item?.grupo || ''}`)
  return searchTokens.every((token) => itemText.includes(token))
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
    if (!canSearch) return []

    const searchableIndex = searchIndex.length
      ? searchIndex
      : items.map((item) => ({ item, searchable: normalizeSearchText(`${item?.nome || ''} ${item?.grupo || ''}`) }))

    const searchTokens = deferredSearch.split(' ').filter(Boolean)

    return searchableIndex
      .filter((entry) => {
        if (filterItem && !filterItem(entry.item)) return false
        if (searchTokens.length === 0) return true
        return searchTokens.every((token) => entry.searchable.includes(token))
      })
      .slice(0, MAX_SEARCH_RESULTS)
      .map((entry) => entry.item)
  }, [canSearch, deferredSearch, filterItem, items, searchIndex])

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

function getItemYear(item) {
  const raw = item?.raw || {}
  const candidate = raw.year || raw.release_date || raw.releasedate || raw.aired || ''
  if (candidate) {
    const match = String(candidate).match(/\b(19\d\d|20\d\d)\b/)
    if (match) return match[1]
  }
  const nameMatch = String(item?.nome || '').match(/\b(19\d\d|20\d\d)\b/)
  return nameMatch ? nameMatch[1] : ''
}

function getItemRating(item) {
  const raw = item?.raw || {}
  const rating = raw.rating || raw.rating_5based || raw.score || raw.vote_average
  if (rating && Number(rating) > 0) {
    const num = Number(rating)
    return num <= 5 ? (num * 2).toFixed(1) : num.toFixed(1)
  }
  return ''
}

function getItemGenre(item) {
  const raw = item?.raw || {}
  return raw.genre || raw.category_name || item?.grupo || ''
}

function getItemDuration(item) {
  const raw = item?.raw || {}
  const duration = raw.duration || raw.episode_run_time || raw.runtime
  if (!duration) return ''
  if (String(duration).includes(':')) return duration
  const mins = parseInt(duration, 10)
  if (!isNaN(mins) && mins > 0) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  return ''
}

function getItemBackdrop(item) {
  const raw = item?.raw || {}
  const backdrop = Array.isArray(raw.backdrop_path) ? raw.backdrop_path[0] : (raw.backdrop_path || raw.backdrop || '')
  return backdrop ? proxyExternalAssetUrl(backdrop) : getItemPoster(item)
}

function getItemCast(item) {
  const raw = item?.raw || {}
  const cast = raw.cast || raw.actors
  if (!cast) return []
  if (Array.isArray(cast)) return cast.slice(0, 10).map((a) => typeof a === 'string' ? { name: a, character: '' } : a)
  if (typeof cast === 'string') {
    return cast.split(',').map((name) => name.trim()).filter(Boolean).slice(0, 10).map((name) => ({ name, character: '' }))
  }
  return []
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
  if (!hasCompleteSessionCredentials(sessionCredentials) || !seriesId) {
    throw new Error('Dados da conta ou ID da série ausentes.')
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const normServer = normalizeServer(sessionCredentials.server)

  // 1. Em HTTPS (Render ou produção), busca as informações da série via proxy para evitar Mixed Content
  if (isHttps || BACKEND_BASE_URL) {
    const response = await fetch(`${BACKEND_BASE_URL || window.location.origin}/api/xtream/series-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server: normServer,
        username: sessionCredentials.username.trim(),
        password: sessionCredentials.password.trim(),
        seriesId: String(seriesId),
      }),
    })

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorBody = await response.json()
        errorMessage = errorBody.error || errorMessage
      } catch {
        errorMessage = (await response.text()) || errorMessage
      }
      throw new Error(errorMessage)
    }

    return response.json()
  }

  // 2. Ambiente HTTP puro: tenta direto primeiro
  const directUrl = buildSeriesInfoUrl(sessionCredentials, seriesId)
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const directRes = await fetch(directUrl, {
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (directRes.ok) {
      return await directRes.json()
    }
  } catch (err) {
    console.warn('Tentativa direta de series-info falhou, usando proxy...', err.message)
  }

  // Fallback via backend proxy
  const response = await fetch(`${BACKEND_BASE_URL || window.location.origin}/api/xtream/series-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server: normServer,
      username: sessionCredentials.username.trim(),
      password: sessionCredentials.password.trim(),
      seriesId: String(seriesId),
    }),
  })

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`
    try {
      const errorBody = await response.json()
      errorMessage = errorBody.error || errorMessage
    } catch {
      errorMessage = (await response.text()) || errorMessage
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
  return { finalUrl: originalUrl, statusCode: 200, redirected: false }
}

function LiveTvScreen({ channels, searchIndex, favorites, onToggleFavorite, sessionCredentials, onBack, onLogout }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [isFavoritesOnly, setIsFavoritesOnly] = useState(false)
  const [playbackDebug, setPlaybackDebug] = useState({ url: '', format: 'm3u8', originalUrl: '', finalUrl: '', statusCode: '', contentType: '', redirected: '', loadedVideoUrl: '', hlsSupported: '', nativeHlsSupport: '', manifestParsed: '', playStatus: '', playError: '', videoError: '' })
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

  const activeGroup = isFavoritesOnly
    ? 'Favoritos'
    : (selectedGroup && groups.some((group) => group.name === selectedGroup) ? selectedGroup : (groups[0]?.name || ''))

  const liveSearchFilter = useCallback(() => true, [])
  const { results: globalChannelResults, canSearch } = useCatalogSearch({
    items: channels,
    searchIndex,
    searchTerm,
    filterItem: liveSearchFilter,
  })

  const isLiveSearchActive = canSearch

  const displayedChannels = useMemo(() => {
    if (isLiveSearchActive) return globalChannelResults
    if (isFavoritesOnly) {
      return channels.filter((c) => Boolean(findFavorite(favorites, c)))
    }
    return activeGroup ? channels.filter((c) => c.grupo === activeGroup) : []
  }, [isLiveSearchActive, globalChannelResults, isFavoritesOnly, channels, favorites, activeGroup])

  const activeChannel = selectedChannel && channels.some((channel) => createChannelKey(channel) === createChannelKey(selectedChannel))
    ? selectedChannel
    : (displayedChannels[0] || null)

  const activeStreamId = activeChannel?.streamId || activeChannel?.id
  const activePlaybackUrl = activeChannel ? buildXtreamPlaybackUrl(sessionCredentials, 'live', activeStreamId, 'm3u8') : ''
  const activeFallbackTsUrl = activeChannel ? buildXtreamPlaybackUrl(sessionCredentials, 'live', activeStreamId, 'ts') : ''
  const activeCacheKey = activeChannel && activePlaybackUrl ? getPlaybackCacheKey({ type: 'live', streamId: activeStreamId, originalUrl: activePlaybackUrl }) : ''
  const playerPlaybackUrl = resolvedPlaybackUrl || activePlaybackUrl

  // Iniciar reprodução do canal ativo automaticamente quando carregar
  useEffect(() => {
    if (activeChannel && (!selectedChannel || createChannelKey(selectedChannel) !== createChannelKey(activeChannel))) {
      selectChannel(activeChannel)
    }
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

  function handleFullscreen() {
    const playerWrapper = document.querySelector('.cortex-player-wrapper')
    const videoEl = document.querySelector('.cortex-player-wrapper video')
    const target = playerWrapper || videoEl
    if (!target) return

    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {})
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
      try {
        if (window.screen?.orientation?.unlock) window.screen.orientation.unlock()
      } catch (_) {}
    } else {
      // 1. Trava rotação horizontal (landscape) SINCRONAMENTE no exato clique/toque do usuário
      try {
        if (window.screen?.orientation?.lock) {
          window.screen.orientation.lock('landscape').catch(() => {})
        }
      } catch (_) {}

      // 2. iOS Safari: entra em tela cheia direto pelo elemento <video>
      if (videoEl && typeof videoEl.webkitEnterFullscreen === 'function') {
        videoEl.webkitEnterFullscreen()
        return
      }

      // 3. Android / Desktop: dispara Fullscreen API
      const req = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen
      if (req) {
        req.call(target).catch(() => {
          if (videoEl && videoEl !== target) {
            const vReq = videoEl.requestFullscreen || videoEl.webkitRequestFullscreen
            vReq?.call(videoEl).catch(() => {})
          }
        })
      }
    }
  }

  if (!channels.length) {
    return (
      <main className="placeholder-wrap">
        <section className="panel placeholder" style={{ maxWidth: '580px', padding: '36px 28px' }}>
          <div className="placeholder-icon">📺</div>
          <p className="eyebrow">LIVE TV</p>
          <h2>Nenhum canal disponível</h2>
          <p style={{ margin: '14px 0 24px', lineHeight: 1.6, opacity: 0.9 }}>
            Sua conta conectou com sucesso, mas o servidor IPTV não retornou canais para este usuário.
            <br />
            Verifique no painel do servidor se há pacotes liberados para esta conta.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>RECARREGAR</button>
            <button className="secondary-button" type="button" onClick={onBack}>VOLTAR AO INÍCIO</button>
          </div>
        </section>
      </main>
    )
  }

  const isCurrentFav = activeChannel ? Boolean(findFavorite(favorites, activeChannel)) : false

  return (
    <main className="cortex-screen" aria-label="TV ao Vivo">
      {/* Header Superior */}
      <div className="cortex-header">
        <div className="cortex-header-left">
          <h1>TV ao Vivo</h1>
        </div>
        <div className="cortex-header-center">
          <div className="cortex-logo-badge">
            <span className="logo-icon">▶</span>
            <span>PXT PLAYER</span>
          </div>
        </div>
        <div className="cortex-header-right">
          <button className="cortex-back-btn" type="button" onClick={onBack}>← Voltar</button>
          {onLogout && (
            <button className="cortex-logout-btn" type="button" onClick={onLogout} title="Sair da conta">
              ⏻ Sair
            </button>
          )}
        </div>
      </div>

      {/* Grid 3 Colunas (Categorias | Canais | Preview Player + EPG) */}
      <div className="cortex-live-grid">
        {/* Coluna 1: Categorias */}
        <section className="cortex-col cortex-col-cats" aria-label="Categorias de canais">
          <div className="cortex-search-box">
            <span className="cortex-search-icon">🔍</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar canais"
            />
          </div>
          <div className="cortex-cat-list" role="tablist">
            <button
              type="button"
              className={`cortex-cat-item ${isFavoritesOnly ? 'active' : ''}`}
              onClick={() => { setIsFavoritesOnly(true); setSelectedGroup(''); setSearchTerm('') }}
            >
              <div className="cortex-cat-left">
                <span className="cortex-cat-icon">★</span>
                <span className="cortex-cat-name">Favoritos</span>
              </div>
              <span className="cortex-cat-badge">{favorites.length}</span>
            </button>
            {groups.map((group) => {
              const isSelected = !isFavoritesOnly && !isLiveSearchActive && activeGroup === group.name
              return (
                <button
                  key={group.name}
                  type="button"
                  className={`cortex-cat-item ${isSelected ? 'active' : ''}`}
                  onClick={() => { setIsFavoritesOnly(false); setSelectedGroup(group.name); setSearchTerm('') }}
                >
                  <div className="cortex-cat-left">
                    <span className="cortex-cat-icon">📺</span>
                    <span className="cortex-cat-name" title={group.name}>{group.name}</span>
                  </div>
                  <span className="cortex-cat-badge">{group.count} canais</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* Coluna 2: Lista de Canais */}
        <section className="cortex-col cortex-col-channels" aria-label="Lista de canais">
          <div className="cortex-channel-list">
            {displayedChannels.length === 0 ? (
              <p className="empty" style={{ padding: '24px', textAlign: 'center' }}>
                {isLiveSearchActive ? 'Nenhum canal encontrado na busca.' : isFavoritesOnly ? 'Nenhum canal favoritado ainda.' : 'Nenhum canal nesta categoria.'}
              </p>
            ) : (
              displayedChannels.map((channel) => {
                const isSelected = activeChannel && createChannelKey(channel) === createChannelKey(activeChannel)
                const isFav = Boolean(findFavorite(favorites, channel))
                return (
                  <div
                    key={createChannelKey(channel)}
                    className={`cortex-channel-row ${isSelected ? 'active' : ''}`}
                    onClick={(e) => selectChannel(channel, e)}
                  >
                    <div className="cortex-channel-logo">
                      {channel.logo ? (
                        <img src={proxyExternalAssetUrl(channel.logo)} alt={channel.nome} loading="lazy" />
                      ) : (
                        <span>📺</span>
                      )}
                    </div>
                    <div className="cortex-channel-info">
                      <strong className="cortex-channel-name" title={channel.nome}>{channel.nome}</strong>
                    </div>
                    <button
                      type="button"
                      className={`favorite-button ${isFav ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onToggleFavorite(channel) }}
                      style={{ position: 'static', opacity: isFav ? 1 : 0.4 }}
                      title={isFav ? 'Remover dos favoritos' : 'Favoritar canal'}
                    >
                      ★
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Coluna 3: Preview Player & Guia EPG */}
        <section className="cortex-col cortex-col-preview" aria-label="Prévia e Guia do canal">
          <div className="cortex-player-wrapper">
            {activeChannel ? (
              <>
                <HlsPlayer
                  url={playerPlaybackUrl ? buildStreamProxyUrl(playerPlaybackUrl) : ''}
                  fallbackUrl={activeFallbackTsUrl ? buildStreamProxyUrl(activeFallbackTsUrl) : ''}
                  contentType={playbackDebug.contentType}
                  title={activeChannel.nome}
                  isLive={true}
                  onPlaybackUrlChange={updatePlaybackDebug}
                />
                <div className="cortex-live-indicator">
                  <span className="live-dot" /> AO VIVO
                </div>
              </>
            ) : (
              <div className="cortex-player-placeholder">
                <span>📺</span>
                <p>Selecione um canal para assistir</p>
              </div>
            )}
            {activeChannel && (
              <button
                type="button"
                className="cortex-fullscreen-btn"
                onClick={handleFullscreen}
                title="Tela Cheia"
              >
                ⛶
              </button>
            )}
          </div>

          <div className="cortex-preview-info">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <h3>{activeChannel ? activeChannel.nome : 'Nenhum canal selecionado'}</h3>
              {activeChannel && (
                <button
                  type="button"
                  className={`cortex-ghost-btn ${isCurrentFav ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(activeChannel) }}
                >
                  ★ {isCurrentFav ? 'Favoritado' : 'Favoritar'}
                </button>
              )}
            </div>

            <div className="cortex-epg-box">
              <p>{activeChannel?.epg || 'Sem guia para este canal'}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function CatalogScreen({
  title,
  icon,
  items,
  searchIndex,
  favorites,
  onToggleFavorite,
  onSelectItem,
  selectedItem,
  playerTitle,
  playerDescription,
  playerUrl,
  playerFallbackUrl,
  detailContent,
  afterContent,
  onBack,
  onCategoryBack,
  onPlayerBack,
  onLogout,
}) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isFavoritesOnly, setIsFavoritesOnly] = useState(false)
  const playerPanelRef = useRef(null)

  const groups = useMemo(() => {
    const groupMap = items.reduce((accumulator, item) => {
      const groupName = item.grupo || 'Sem categoria'
      accumulator[groupName] = (accumulator[groupName] || 0) + 1
      return accumulator
    }, {})
    return sortByName(Object.keys(groupMap)).map((name) => ({ name, count: groupMap[name] }))
  }, [items])

  const activeGroup = isFavoritesOnly
    ? 'Favoritos'
    : (selectedGroup && groups.some((g) => g.name === selectedGroup) ? selectedGroup : (groups[0]?.name || ''))

  const catalogSearchFilter = useCallback(() => true, [])
  const { results: globalSearchItems, canSearch } = useCatalogSearch({
    items,
    searchIndex,
    searchTerm,
    filterItem: catalogSearchFilter,
  })

  const isCatalogSearchActive = canSearch

  const displayedItems = useMemo(() => {
    if (isCatalogSearchActive) return globalSearchItems
    if (isFavoritesOnly) {
      return items.filter((item) => Boolean(findFavorite(favorites, item)))
    }
    return activeGroup ? items.filter((item) => item.grupo === activeGroup) : []
  }, [isCatalogSearchActive, globalSearchItems, isFavoritesOnly, items, favorites, activeGroup])

  function selectCatalogItem(item) {
    onSelectItem(item)
    pushAppHistoryState({ screen: title.toLowerCase(), view: 'detail' })
  }

  // Visualização de Player (Filme ou Episódio)
  if ((playerUrl || playerFallbackUrl) && (selectedItem || playerTitle)) {
    return (
      <main className="cortex-screen" aria-label={`Player de ${playerTitle || title}`} ref={playerPanelRef}>
        <div className="cortex-header">
          <div className="cortex-header-left">
            <h1>{playerTitle || title}</h1>
          </div>
          <div className="cortex-header-center">
            <div className="cortex-logo-badge">
              <span className="logo-icon">▶</span>
              <span>PXT PLAYER</span>
            </div>
          </div>
          <div className="cortex-header-right">
            <button className="cortex-back-btn" type="button" onClick={onPlayerBack}>← Voltar aos Detalhes</button>
          </div>
        </div>
        <div className="cortex-col" style={{ padding: '16px', borderRadius: '20px' }}>
          <div className="cortex-player-wrapper" style={{ height: '70vh', minHeight: '440px' }}>
            <HlsPlayer
              url={playerUrl ? buildStreamProxyUrl(playerUrl) : ''}
              fallbackUrl={playerFallbackUrl ? buildStreamProxyUrl(playerFallbackUrl) : ''}
              title={playerTitle || title}
            />
          </div>
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p className="eyebrow" style={{ color: '#38bdf8' }}>Em reprodução</p>
              <h2 style={{ margin: '4px 0', fontSize: '1.4rem', color: '#fff' }}>{playerTitle || title}</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>{playerDescription || 'Reproduzindo item selecionado.'}</p>
            </div>
            <button className="cortex-back-btn" type="button" onClick={onPlayerBack}>
              ← Fechar Player
            </button>
          </div>
        </div>
      </main>
    )
  }

  // Visualização de Detalhes Cinematográficos
  if (selectedItem && detailContent) {
    return (
      <main className="cortex-screen" aria-label={`Detalhes de ${selectedItem.nome}`}>
        {detailContent}
        {afterContent}
      </main>
    )
  }

  // Visualização de Vitrine Cortex (Barra Lateral de Categorias + Cards Verticais 2:3)
  const displayTitle = title === 'MOVIES' ? 'Filmes' : title === 'SERIES' ? 'Séries' : title === 'FAVORITES' ? 'Favoritos' : title

  return (
    <main className="cortex-screen" aria-label={displayTitle}>
      <div className="cortex-header">
        <div className="cortex-header-left">
          <h1>{displayTitle}</h1>
        </div>
        <div className="cortex-header-center">
          <div className="cortex-logo-badge">
            <span className="logo-icon">▶</span>
            <span>PXT PLAYER</span>
          </div>
        </div>
        <div className="cortex-header-right">
          <button className="cortex-back-btn" type="button" onClick={onBack}>← Voltar</button>
          {onLogout && (
            <button className="cortex-logout-btn" type="button" onClick={onLogout} title="Sair da conta">
              ⏻ Sair
            </button>
          )}
        </div>
      </div>

      <div className="cortex-vod-layout">
        {/* Sidebar de Categorias */}
        <aside className="cortex-col cortex-vod-sidebar" aria-label={`Categorias de ${displayTitle}`}>
          <div className="cortex-search-box">
            <span className="cortex-search-icon">🔍</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar..."
            />
          </div>
          <div className="cortex-cat-list" role="tablist">
            <button
              type="button"
              className={`cortex-cat-item ${isFavoritesOnly ? 'active' : ''}`}
              onClick={() => { setIsFavoritesOnly(true); setSelectedGroup(''); setSearchTerm('') }}
            >
              <div className="cortex-cat-left">
                <span className="cortex-cat-icon">★</span>
                <span className="cortex-cat-name">Favoritos</span>
              </div>
              <span className="cortex-cat-badge">{favorites.length}</span>
            </button>
            {groups.map((group) => {
              const isSelected = !isFavoritesOnly && !isCatalogSearchActive && activeGroup === group.name
              const unit = title === 'MOVIES' ? 'filmes' : title === 'SERIES' ? 'séries' : 'itens'
              return (
                <button
                  key={group.name}
                  type="button"
                  className={`cortex-cat-item ${isSelected ? 'active' : ''}`}
                  onClick={() => { setIsFavoritesOnly(false); setSelectedGroup(group.name); setSearchTerm('') }}
                >
                  <div className="cortex-cat-left">
                    <span className="cortex-cat-icon">{icon}</span>
                    <span className="cortex-cat-name" title={group.name}>{group.name}</span>
                  </div>
                  <span className="cortex-cat-badge">{group.count} {unit}</span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Grade de Cartazes Verticais 2:3 */}
        <section className="cortex-vod-content" aria-label={`Lista de ${displayTitle}`}>
          {displayedItems.length === 0 ? (
            <p className="empty" style={{ padding: '32px', textAlign: 'center' }}>
              {isCatalogSearchActive ? 'Nenhum título encontrado na busca.' : isFavoritesOnly ? 'Nenhum título favoritado ainda.' : 'Nenhum item nesta categoria.'}
            </p>
          ) : (
            <div className="cortex-poster-grid">
              {displayedItems.map((item) => {
                const itemKey = createItemKey(item)
                const isFavorite = Boolean(findFavorite(favorites, item))
                const poster = getItemPoster(item)
                const year = getItemYear(item)
                const rating = getItemRating(item)
                return (
                  <article
                    key={itemKey}
                    className="cortex-poster-card"
                    onClick={() => selectCatalogItem(item)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="cortex-poster-img-wrap">
                      {poster ? (
                        <img src={poster} alt={item.nome} loading="lazy" />
                      ) : (
                        <div className="cortex-poster-placeholder">
                          <span>{icon}</span>
                        </div>
                      )}
                      {rating && <span className="cortex-poster-rating">★ {rating}</span>}
                      <button
                        type="button"
                        className={`favorite-button ${isFavorite ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(item) }}
                        title={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
                      >
                        ★
                      </button>
                    </div>
                    <div className="cortex-poster-info">
                      <strong title={item.nome}>{item.nome}</strong>
                      {year && <span className="cortex-poster-year">{year}</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function MediaDetail({
  item,
  icon,
  actionLabel = 'Assistir agora',
  onAction,
  onBack,
  onHome,
  isFavorite = false,
  onToggleFavorite,
  relatedItems = [],
  onSelectRelated,
  children,
}) {
  if (!item) return null

  const poster = getItemPoster(item)
  const backdrop = getItemBackdrop(item)
  const description = getItemDescription(item, 'Uma excelente produção disponível na sua grade de programação.')
  const year = getItemYear(item) || '2026'
  const rating = getItemRating(item) || '7.5'
  const genre = getItemGenre(item)
  const duration = getItemDuration(item) || '01:45:00'
  const cast = getItemCast(item)

  return (
    <div className="cortex-detail-container">
      {/* Backdrop wallpaper com efeito blur cinemático */}
      <div className="cortex-detail-backdrop">
        {backdrop && (
          <img
            src={backdrop}
            alt=""
            className="cortex-detail-backdrop-img"
          />
        )}
      </div>

      {/* Top Header */}
      <div className="cortex-header" style={{ position: 'relative', zIndex: 2 }}>
        <div className="cortex-header-left">
          <p className="eyebrow" style={{ color: '#38bdf8', margin: 0 }}>DETALHES</p>
        </div>
        <div className="cortex-header-center">
          <div className="cortex-logo-badge">
            <span className="logo-icon">▶</span>
            <span>PXT PLAYER</span>
          </div>
        </div>
        <div className="cortex-header-right">
          <button className="cortex-back-btn" type="button" onClick={onBack}>← Voltar</button>
        </div>
      </div>

      {/* Hero row */}
      <div className="cortex-detail-hero">
        {/* Poster 2:3 vertical */}
        <div className="cortex-detail-poster">
          {poster ? (
            <img src={poster} alt={item.nome} />
          ) : (
            <div className="cortex-poster-placeholder"><span>{icon}</span></div>
          )}
        </div>

        {/* Informações */}
        <div className="cortex-detail-info">
          <h1 className="cortex-detail-title">{item.nome}</h1>

          {/* Badges de Metadados */}
          <div className="cortex-badges-row">
            {year && <span className="cortex-badge-pill">{year}</span>}
            {rating && <span className="cortex-badge-pill rating">★ {rating}</span>}
            <span className="cortex-badge-pill">L</span>
            {genre && <span className="cortex-badge-pill">{genre}</span>}
            {duration && <span className="cortex-badge-pill">{duration}</span>}
          </div>

          {/* Botões de Ação */}
          <div className="cortex-actions-row">
            {onAction && (
              <button className="cortex-play-btn" type="button" onClick={onAction}>
                ▶▶ {actionLabel}
              </button>
            )}
            {onToggleFavorite && (
              <button
                className={`cortex-ghost-btn ${isFavorite ? 'active' : ''}`}
                type="button"
                onClick={onToggleFavorite}
              >
                ★ {isFavorite ? 'Favoritado' : 'Favoritar'}
              </button>
            )}
            <button className="cortex-ghost-btn" type="button" onClick={onBack}>
              ← Voltar
            </button>
            {onHome && (
              <button className="cortex-ghost-btn" type="button" onClick={onHome}>
                ⌂ Início
              </button>
            )}
          </div>

          {/* Sinopse */}
          <p className="cortex-synopsis">{description}</p>

          {/* Elenco / Cast */}
          {cast.length > 0 && (
            <div className="cortex-cast-row">
              {cast.map((actor, idx) => (
                <div key={idx} className="cortex-cast-card">
                  <div className="cortex-cast-avatar">
                    {actor.photo ? <img src={actor.photo} alt={actor.name} /> : <span>👤</span>}
                  </div>
                  <strong>{actor.name}</strong>
                  {actor.character && <small>{actor.character}</small>}
                </div>
              ))}
            </div>
          )}

          {/* Conteúdo adicional (ex: Temporadas e Episódios de Séries) */}
          {children}
        </div>
      </div>

      {/* Relacionados na sua lista */}
      {relatedItems.length > 0 && (
        <div className="cortex-related-box">
          <h3>RELACIONADOS NA SUA LISTA</h3>
          <div className="cortex-related-carousel">
            {relatedItems.slice(0, 15).map((rel) => {
              const relPoster = getItemPoster(rel)
              const relYear = getItemYear(rel)
              return (
                <article
                  key={createItemKey(rel)}
                  className="cortex-poster-card"
                  onClick={() => onSelectRelated?.(rel)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="cortex-poster-img-wrap">
                    {relPoster ? <img src={relPoster} alt={rel.nome} loading="lazy" /> : <div className="cortex-poster-placeholder"><span>{icon}</span></div>}
                  </div>
                  <div className="cortex-poster-info">
                    <strong title={rel.nome}>{rel.nome}</strong>
                    {relYear && <span className="cortex-poster-year">{relYear}</span>}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function MoviesScreen({ sessionCredentials, items, searchIndex, favorites, onToggleFavorite, onBack, onLogout }) {
  const [selectedMovie, setSelectedMovie] = useState(null)
  const [playingMovie, setPlayingMovie] = useState(null)
  const originalMovieUrl = playingMovie ? getPlayableItemUrl(playingMovie, sessionCredentials) : ''
  const moviePlayback = useResolvedPlaybackUrl({ item: playingMovie, originalUrl: originalMovieUrl })

  const isSelectedFav = selectedMovie ? Boolean(findFavorite(favorites, selectedMovie)) : false

  const relatedMovies = useMemo(() => {
    if (!selectedMovie) return []
    return items.filter(
      (m) => m.grupo === selectedMovie.grupo && createItemKey(m) !== createItemKey(selectedMovie)
    )
  }, [items, selectedMovie])

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
      detailContent={
        <MediaDetail
          item={selectedMovie}
          icon="🎬"
          actionLabel="Assistir agora"
          onAction={() => setPlayingMovie(selectedMovie)}
          onBack={() => { setSelectedMovie(null); setPlayingMovie(null) }}
          onHome={onBack}
          isFavorite={isSelectedFav}
          onToggleFavorite={() => selectedMovie && onToggleFavorite(selectedMovie)}
          relatedItems={relatedMovies}
          onSelectRelated={(rel) => setSelectedMovie(rel)}
        />
      }
      playerTitle={playingMovie?.nome || ''}
      playerDescription={playingMovie ? 'Reproduzindo filme selecionado.' : ''}
      playerUrl={moviePlayback.playbackUrl}
      onPlayerBack={() => setPlayingMovie(null)}
      onBack={onBack}
      onLogout={onLogout}
      onCategoryBack={() => { setSelectedMovie(null); setPlayingMovie(null) }}
    />
  )
}

function SeriesScreen({ sessionCredentials, items, searchIndex, favorites, onToggleFavorite, onBack, onLogout }) {
  const [selectedSeries, setSelectedSeries] = useState(null)
  const [seriesInfo, setSeriesInfo] = useState(null)
  const [selectedSeason, setSelectedSeason] = useState('')
  const [selectedEpisode, setSelectedEpisode] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [error, setError] = useState('')

  async function selectSeries(series) {
    setSelectedSeries(series)
    setSelectedEpisode(null)
    setSeriesInfo(null)
    setSelectedSeason('')
    setError('')
    setLoadingInfo(true)
    try {
      const info = await fetchSeriesInfo(sessionCredentials, series.streamId || series.id)
      setSeriesInfo(info)
      const seasons = Object.keys(info?.episodes || {})
      if (seasons.length > 0) setSelectedSeason(seasons[0])
    } catch (fetchError) {
      setError(`Erro ao carregar episódios: ${fetchError.message}`)
    } finally {
      setLoadingInfo(false)
    }
  }

  const episodesBySeason = seriesInfo?.episodes || {}
  const seasonKeys = Object.keys(episodesBySeason)
  const currentSeasonKey = selectedSeason || seasonKeys[0] || '1'
  const currentEpisodes = Array.isArray(episodesBySeason[currentSeasonKey]) ? episodesBySeason[currentSeasonKey] : []

  const episodeUrl = selectedEpisode
    ? buildXtreamPlaybackUrl(sessionCredentials, 'series', selectedEpisode.id || selectedEpisode.episode_id, getItemContainerExtension({ raw: selectedEpisode }))
    : ''
  const episodePlaybackItem = useMemo(() => (selectedEpisode ? { ...selectedEpisode, tipo: 'SERIES', streamId: selectedEpisode.id || selectedEpisode.episode_id } : null), [selectedEpisode])
  const episodePlayback = useResolvedPlaybackUrl({ item: episodePlaybackItem, originalUrl: episodeUrl })

  const isSelectedFav = selectedSeries ? Boolean(findFavorite(favorites, selectedSeries)) : false

  const relatedSeries = useMemo(() => {
    if (!selectedSeries) return []
    return items.filter(
      (s) => s.grupo === selectedSeries.grupo && createItemKey(s) !== createItemKey(selectedSeries)
    )
  }, [items, selectedSeries])

  const seriesEpisodesContent = selectedSeries ? (
    <div className="cortex-seasons-wrap">
      {/* Abas das Temporadas */}
      {seasonKeys.length > 0 && (
        <div className="cortex-seasons-tabs">
          {seasonKeys.map((seasonNum) => {
            const seasonLabel = `Temporada ${String(seasonNum).padStart(2, '0')}`
            return (
              <button
                key={seasonNum}
                type="button"
                className={`cortex-season-tab ${currentSeasonKey === seasonNum ? 'active' : ''}`}
                onClick={() => setSelectedSeason(seasonNum)}
              >
                {seasonLabel}
              </button>
            )
          })}
        </div>
      )}

      {loadingInfo && <p style={{ color: '#38bdf8' }}>Carregando episódios...</p>}
      {error && <p className="status error">{error}</p>}

      {/* Grade de Episódios 16:9 */}
      {!loadingInfo && !error && (
        <div className="cortex-episodes-grid">
          {currentEpisodes.length === 0 ? (
            <p className="empty">Nenhum episódio nesta temporada.</p>
          ) : (
            currentEpisodes.map((ep, idx) => {
              const epNum = ep.episode_num || idx + 1
              const epTitle = ep.title || `Episódio ${epNum}`
              const epThumb = ep.info?.movie_image || getItemPoster(selectedSeries)
              return (
                <article
                  key={ep.id || ep.episode_id || idx}
                  className="cortex-episode-card"
                  onClick={() => setSelectedEpisode(ep)}
                >
                  <div className="cortex-episode-thumb-wrap">
                    {epThumb ? (
                      <img src={proxyExternalAssetUrl(epThumb)} alt={epTitle} loading="lazy" />
                    ) : (
                      <div className="cortex-poster-placeholder"><span>▣</span></div>
                    )}
                    <span className="cortex-episode-badge">EP {String(epNum).padStart(2, '0')}</span>
                    <div className="cortex-episode-play-overlay">
                      <div className="cortex-episode-play-circle">▶</div>
                    </div>
                  </div>
                  <div className="cortex-episode-info">
                    <strong title={epTitle}>{epTitle}</strong>
                    <small>{ep.info?.duration || getItemContainerExtension({ raw: ep })}</small>
                  </div>
                </article>
              )
            })
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <CatalogScreen
      title="SERIES"
      icon="▣"
      items={items}
      searchIndex={searchIndex}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onSelectItem={selectSeries}
      selectedItem={selectedSeries}
      playerTitle={selectedEpisode?.title ? `${selectedSeries?.nome} - ${selectedEpisode.title}` : (selectedSeries?.nome || '')}
      playerDescription={selectedEpisode ? `Temporada ${currentSeasonKey} • Episódio ${selectedEpisode.episode_num || ''}` : ''}
      playerUrl={episodePlayback.playbackUrl}
      detailContent={
        <MediaDetail
          item={selectedSeries}
          icon="▣"
          actionLabel="Assistir 1º Episódio"
          onAction={() => {
            if (currentEpisodes.length > 0) setSelectedEpisode(currentEpisodes[0])
          }}
          onBack={() => { setSelectedSeries(null); setSelectedEpisode(null); setSeriesInfo(null); setError('') }}
          onHome={onBack}
          isFavorite={isSelectedFav}
          onToggleFavorite={() => selectedSeries && onToggleFavorite(selectedSeries)}
          relatedItems={relatedSeries}
          onSelectRelated={(rel) => selectSeries(rel)}
        >
          {seriesEpisodesContent}
        </MediaDetail>
      }
      onPlayerBack={() => setSelectedEpisode(null)}
      onBack={onBack}
      onLogout={onLogout}
      onCategoryBack={() => { setSelectedSeries(null); setSelectedEpisode(null); setSeriesInfo(null); setError('') }}
    />
  )
}

function FavoritesScreen({ sessionCredentials, favorites, catalogItems, onToggleFavorite, onOpenSeries, onBack, onLogout }) {
  const catalogByKey = useMemo(() => catalogItems.reduce((accumulator, item) => ({ ...accumulator, [createItemKey(item)]: item }), {}), [catalogItems])
  const favoriteItems = favorites.map((favorite) => catalogByKey[favorite.key] || favorite)
  const [selectedItem, setSelectedItem] = useState(null)
  const originalFavoriteUrl = selectedItem ? getPlayableItemUrl(selectedItem, sessionCredentials) : ''
  const originalFavoriteFallbackUrl = selectedItem?.tipo === 'LIVE TV' ? buildXtreamPlaybackUrl(sessionCredentials, 'live', selectedItem.streamId || selectedItem.id, 'ts') : ''
  const favoritePlayback = useResolvedPlaybackUrl({ item: selectedItem, originalUrl: originalFavoriteUrl, fallbackUrl: originalFavoriteFallbackUrl })

  function openFavorite(item) {
    if (item.tipo === 'SERIES') {
      onOpenSeries()
      return
    }
    setSelectedItem(item)
  }

  return (
    <CatalogScreen
      onBack={onBack}
      title="FAVORITES"
      icon="★"
      items={favoriteItems}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onSelectItem={openFavorite}
      selectedItem={selectedItem}
      playerTitle={selectedItem?.nome || ''}
      playerDescription={selectedItem ? 'Reproduzindo favorito selecionado.' : 'Clique em um favorito para reproduzir.'}
      playerUrl={selectedItem ? getPlayableItemUrl(selectedItem, sessionCredentials) : ''}
      playerFallbackUrl={selectedItem?.tipo === 'LIVE TV' ? buildXtreamPlaybackUrl(sessionCredentials, 'live', selectedItem.streamId || selectedItem.id, 'ts') : ''}
      onPlayerBack={() => setSelectedItem(null)}
      onLogout={onLogout}
    />
  )
}

function Topbar({ screen, onNavigate, onLogout, username }) {
  return (
    <header className="topbar">
      <button className="logo" onClick={() => onNavigate('home')} aria-label="Abrir início">
        <span>▶</span>
        <strong>PXT PLAYER</strong>
      </button>
      <nav className="top-navigation" aria-label="Navegação principal">
        {navigationItems.map((item) => (
          <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
            {item.title}
          </button>
        ))}
      </nav>
      <div className="topbar-user-actions">
        {username && <span className="topbar-username" title="Usuário conectado">👤 {username}</span>}
        {onLogout && (
          <button type="button" className="logout-button" onClick={onLogout} title="Sair da conta">
            ⏻ Sair
          </button>
        )}
      </div>
    </header>
  )
}

function AccountScreen({ account, setAccount, sessionCredentials, onConnect, onRefresh, onClear, loading, status }) {
  const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const isHttpError = status.type === 'error' && (
    status.message.includes('HTTP') ||
    status.message.includes('403') ||
    status.message.includes('Failed to fetch') ||
    status.message.includes('NetworkError')
  )

  function handleSwitchToHttp() {
    if (typeof window === 'undefined') return
    const httpUrl = window.location.href.replace(/^https:/i, 'http:')
    window.location.href = httpUrl
  }

  return (
    <main className="account-page">
      <div className="login-bg-watermark" aria-hidden="true">
        <span className="watermark-brand">PXT</span>
        <span className="watermark-sub">PLAYER</span>
      </div>

      <section className="login-hero">
        <div className="pxt-brand-badge">
          <div className="pxt-logo-icon">
            <svg width="42" height="42" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="14" fill="url(#pxtGrad)" />
              <path d="M19 15L33 24L19 33V15Z" fill="#FFFFFF" />
              <defs>
                <linearGradient id="pxtGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#00C0FF" />
                  <stop offset="1" stopColor="#0055FF" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <span className="pxt-logo-title">PXT PLAYER</span>
            <span className="pxt-logo-slogan">Sua melhor experiência em streaming</span>
          </div>
        </div>
        <p className="eyebrow">PORTAL DE ACESSO</p>
        <h1>Entre na sua conta</h1>
        <p className="hero-copy">Assista seus canais ao vivo, filmes e séries favoritos com alta estabilidade e reprodução instantânea.</p>
      </section>

      <section className="panel login-card" aria-label="Tela de login">
        <div className="login-card-header">
          <div>
            <p className="eyebrow">Acesso Exclusivo</p>
            <h2>Entrar</h2>
          </div>
          <div className="account-orb">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </div>

        <div className="form-grid-modern">
          <label>
            <span>Usuário</span>
            <input
              value={account.username}
              onChange={(event) => setAccount({ ...account, username: event.target.value })}
              placeholder="Digite seu usuário"
              autoComplete="username"
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              type="password"
              value={account.password}
              onFocus={() => isMaskedPassword(account.password) && setAccount({ ...account, password: '' })}
              onChange={(event) => setAccount({ ...account, password: event.target.value })}
              placeholder="Digite sua senha"
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
          <span>Lembrar meu login neste dispositivo</span>
        </label>

        <div className="actions login-actions-row">
          <button className="primary-button btn-connect-full" onClick={onConnect} disabled={loading}>
            {loading ? 'Conectando...' : 'Entrar no Player'}
          </button>
          <button className="secondary-button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Atualizando...' : 'Recarregar'}
          </button>
          <button className="danger-button" onClick={onClear} disabled={loading}>
            Limpar
          </button>
        </div>

        {status.message && <p className={`status ${status.type}`}>{status.message}</p>}

        {isHttpsPage && isHttpError && (
          <div className="http-helper-box">
            <p>
              <strong>Dica de Conexão Direta (HTTP Puro):</strong> Se o navegador bloquear o servidor IPTV em HTTPS, clique abaixo para tentar abrir em HTTP puro ou permita <em>"Conteúdo inseguro"</em> no ícone ao lado da barra de endereço.
            </p>
            <button type="button" className="secondary-button http-switch-btn" onClick={handleSwitchToHttp}>
              🔓 Abrir em HTTP Puro
            </button>
          </div>
        )}
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

function HomeScreen({ loading, onNavigate, onLogout, username }) {
  const cards = navigationItems

  return (
    <main className="home section-home" aria-label="Tela inicial do catálogo">
      <section className="panel section-home-panel">
        <div className="home-panel-header">
          <div>
            <p className="eyebrow">Catálogo IPTV {username ? `• ${username}` : ''}</p>
            <h1>Escolha uma área</h1>
          </div>
          {onLogout && (
            <button type="button" className="logout-button" onClick={onLogout}>
              ⏻ Sair da Conta
            </button>
          )}
        </div>
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

function FooterNavigation({ screen, onNavigate, onLogout }) {
  return (
    <footer className="footer-actions">
      {navigationItems.map((item) => (
        <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
          <span>{item.icon}</span>{item.title}
        </button>
      ))}
      {onLogout && (
        <button type="button" className="footer-logout-btn" onClick={onLogout} title="Sair da conta">
          <span>⏻</span>SAIR
        </button>
      )}
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
      playbackUrlCache.clear()
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

    // Instantâneo (< 50ms): Carrega imediatamente do cache IndexedDB se já visitou antes
    const cacheKey = `${normalizeServer(saved.server)}_${saved.username.trim()}`.toLowerCase()
    getCachedCatalog(cacheKey).then((cachedCatalog) => {
      if (cachedCatalog && (cachedCatalog.liveStreams?.length || cachedCatalog.live?.length)) {
        mediaManager.loadXtreamCatalog(cachedCatalog, {
          server: normalizeServer(saved.server),
          username: saved.username,
          password: saved.password,
        })
        setScreen('home')
        // Revalida em segundo plano sem bloquear o usuário
        handleConnection('Sessão restaurada', restoredCredentials, { isBackground: true })
      } else {
        handleConnection('Sessão restaurada', restoredCredentials, { isBackground: false })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnection(successMessage = 'Conectado com sucesso', credentialsOverride = null, options = {}) {
    const formCredentials = credentialsOverride || getAccountCredentials(account)
    const authCredentials = isMaskedPassword(formCredentials.password)
      ? { ...formCredentials, password: sessionCredentials?.password || '' }
      : formCredentials

    if (!buildXtreamLoginUrl(authCredentials) || getSessionCredentialsPlaybackError({ password: authCredentials.password })) {
      setStatus({ type: 'error', message: 'Preencha servidor, usuário e senha.' })
      return
    }

    const isBackground = Boolean(options?.isBackground)
    if (!isBackground) {
      setLoading(true)
      setStatus({ type: '', message: '' })
    }

    const cacheKey = `${normalizeServer(authCredentials.server)}_${authCredentials.username.trim()}`.toLowerCase()

    const onBackgroundCatalogReady = (fullCatalog) => {
      const fullPayload = getCatalogPayload({ catalog: fullCatalog })
      mediaManager.loadXtreamCatalog(fullPayload, {
        server: normalizeServer(authCredentials.server),
        username: authCredentials.username,
        password: authCredentials.password,
      })
      setCachedCatalog(cacheKey, fullPayload)
    }

    try {
      const responseData = await validateXtreamAccount(authCredentials, onBackgroundCatalogReady)
      const realPassword = authCredentials.password.trim()
      saveAccount({ ...authCredentials, password: realPassword })
      const catalogPayload = getCatalogPayload(responseData)
      const loadedCatalog = mediaManager.loadXtreamCatalog(catalogPayload, {
        server: normalizeServer(authCredentials.server),
        username: authCredentials.username,
        password: realPassword,
      })

      // Salva estágio 1 no IndexedDB imediatamente
      setCachedCatalog(cacheKey, catalogPayload)

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
        message: `${successMessage}. Catálogo pronto: ${counts.live || loadedCatalog.live.length} canais ao vivo.`,
      })
      setScreen('home')
      if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
        try {
          window.screen.orientation.lock('landscape').catch(() => {})
        } catch (_) {}
      }
    } catch (error) {
      if (!isBackground) {
        setStatus({ type: 'error', message: `Erro ao conectar: ${error.message}` })
      }
    } finally {
      if (!isBackground) {
        setLoading(false)
      }
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY)
    playbackUrlCache.clear()
    setSessionCredentials(null)
    mediaManager.clearCatalog()
    setAccount({ ...EMPTY_ACCOUNT, username: '', password: '' })
    setStatus({ type: 'success', message: 'Você saiu da conta com sucesso.' })
    setScreen('account')
  }

  function clearData() {
    localStorage.removeItem(STORAGE_KEY)
    playbackUrlCache.clear()
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
      {isConnected && (
        <Topbar
          screen={screen}
          onNavigate={navigateScreen}
          onLogout={handleLogout}
          username={sessionCredentials?.username}
        />
      )}

      {!isConnected || screen === 'account' ? (
        <AccountScreen account={account} setAccount={setAccount} sessionCredentials={sessionCredentials} onConnect={() => handleConnection('Conectado com sucesso')} onRefresh={() => handleConnection('Conectado com sucesso')} onClear={clearData} loading={loading} status={status} />
      ) : screen === 'home' ? (
        <HomeScreen loading={loading} onNavigate={navigateScreen} onLogout={handleLogout} username={sessionCredentials?.username} />
      ) : screen === 'live' ? (
        <LiveTvScreen channels={mediaManager.live} searchIndex={mediaManager.searchIndex.live} favorites={favorites} onToggleFavorite={toggleFavoriteItem} sessionCredentials={sessionCredentials} onBack={() => navigateScreen('home')} onLogout={handleLogout} />
      ) : screen === 'movies' ? (
        <MoviesScreen sessionCredentials={sessionCredentials} items={mediaManager.movies} searchIndex={mediaManager.searchIndex.movies} favorites={favorites} onToggleFavorite={toggleFavoriteItem} onBack={() => navigateScreen('home')} onLogout={handleLogout} />
      ) : screen === 'series' ? (
        <SeriesScreen sessionCredentials={sessionCredentials} items={mediaManager.series} searchIndex={mediaManager.searchIndex.series} favorites={favorites} onToggleFavorite={toggleFavoriteItem} onBack={() => navigateScreen('home')} onLogout={handleLogout} />
      ) : screen === 'favorites' ? (
        <FavoritesScreen sessionCredentials={sessionCredentials} favorites={favorites} catalogItems={mediaManager.all} onToggleFavorite={toggleFavoriteItem} onOpenSeries={() => navigateScreen('series')} onBack={() => navigateScreen('home')} onLogout={handleLogout} />
      ) : (
        <PlaceholderScreen title={currentItem.title} subtitle={currentItem.subtitle} icon={currentItem.icon} mediaItems={currentMediaItems} total={currentMediaItems.length} />
      )}

      {isConnected && <FooterNavigation screen={screen} onNavigate={navigateScreen} onLogout={handleLogout} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <MediaManagerProvider>
    <App />
  </MediaManagerProvider>,
)
