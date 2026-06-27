import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export const MEDIA_TYPES = {
  LIVE: 'LIVE TV',
  MOVIES: 'MOVIES',
  SERIES: 'SERIES',
  RADIOS: 'RADIOS',
  OTHERS: 'OUTROS',
}

function createEmptyCatalog() {
  return {
    live: [],
    movies: [],
    series: [],
    radios: [],
    others: [],
    all: [],
    groups: {},
    searchIndex: { live: [], movies: [], series: [] },
    loadedAt: null,
    sourceUrl: '',
  }
}

const MediaManagerContext = createContext(null)

function getByKeys(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return fallback
}

function indexCategories(categories = []) {
  return categories.reduce((accumulator, category) => {
    const id = getByKeys(category, ['category_id', 'id'])
    const name = getByKeys(category, ['category_name', 'name'], MEDIA_TYPES.OTHERS)
    if (id) accumulator[id] = name
    return accumulator
  }, {})
}

function getMovieExtension(stream) {
  return getByKeys(stream, ['container_extension', 'container'], 'mp4').replace(/^\.+/, '') || 'mp4'
}

function createXtreamStreamUrl({ server, username, password }, path, streamId, extension) {
  if (!server || !username || !password || !streamId) return ''
  const normalizedServer = server.replace(/\/+$/, '')
  const encodedUsername = encodeURIComponent(username)
  const encodedPassword = encodeURIComponent(password)
  const encodedStreamId = encodeURIComponent(streamId)
  const normalizedExtension = String(extension || '').replace(/^\.+/, '')
  return `${normalizedServer}/${path}/${encodedUsername}/${encodedPassword}/${encodedStreamId}.${normalizedExtension}`
}

function createXtreamLiveUrls(credentials, streamId) {
  return {
    m3u8: createXtreamStreamUrl(credentials, 'live', streamId, 'm3u8'),
    ts: createXtreamStreamUrl(credentials, 'live', streamId, 'ts'),
  }
}

function createXtreamItem({ item, index, type, groupName, url, fallbackUrl = '' }) {
  const name = getByKeys(item, ['name', 'title'], `Item ${index + 1}`)
  const streamId = getByKeys(item, ['stream_id', 'series_id', 'id'])
  const logo = getByKeys(item, ['stream_icon', 'cover', 'cover_big', 'movie_image'])

  return {
    id: streamId || `${type.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
    nome: name,
    grupo: groupName || MEDIA_TYPES.OTHERS,
    logo,
    url,
    fallbackUrl,
    liveUrls: type === MEDIA_TYPES.LIVE ? {
      m3u8: url,
      ts: fallbackUrl,
    } : undefined,
    streamId,
    tipo: type,
    epg: getByKeys(item, ['epg_channel_id']),
    'tvg-id': getByKeys(item, ['epg_channel_id']),
    'tvg-name': name,
    'tvg-logo': logo,
    'group-title': groupName || MEDIA_TYPES.OTHERS,
    country: getByKeys(item, ['country']),
    language: getByKeys(item, ['language']),
    raw: item,
  }
}

function addCatalogItem(catalog, item) {
  const bucket = toBucket(item.tipo)
  catalog[bucket].push(item)
  catalog.all.push(item)
  catalog.groups[item.grupo] = [...(catalog.groups[item.grupo] || []), item]
}

function normalizeIndexText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function createSearchIndex(items = []) {
  return items.map((item) => ({
    key: `${item.tipo || 'ITEM'}:${item.streamId || item.id || item.nome}`,
    item,
    searchable: normalizeIndexText(`${item.nome || ''} ${item.grupo || ''}`),
  }))
}

function attachSearchIndexes(catalog) {
  return {
    ...catalog,
    searchIndex: {
      live: createSearchIndex(catalog.live),
      movies: createSearchIndex(catalog.movies),
      series: createSearchIndex(catalog.series),
    },
  }
}

export function parseXtreamCatalog(apiData, credentials = {}) {
  const normalizedCredentials = {
    server: String(credentials.server || apiData?.server || '').replace(/\/+$/, ''),
    username: String(credentials.username || '').trim(),
    password: String(credentials.password || '').trim(),
  }
  const catalog = { ...createEmptyCatalog(), sourceUrl: normalizedCredentials.server, loadedAt: apiData?.fetchedAt || new Date().toISOString() }
  const liveCategoryMap = indexCategories(apiData?.liveCategories)
  const movieCategoryMap = indexCategories(apiData?.movieCategories)
  const seriesCategoryMap = indexCategories(apiData?.seriesCategories)

  ;(apiData?.liveStreams || []).forEach((stream, index) => {
    const streamId = getByKeys(stream, ['stream_id', 'id'])
    const liveUrls = createXtreamLiveUrls(normalizedCredentials, streamId)
    addCatalogItem(catalog, createXtreamItem({
      item: stream,
      index,
      type: MEDIA_TYPES.LIVE,
      groupName: liveCategoryMap[getByKeys(stream, ['category_id'])] || getByKeys(stream, ['category_name'], MEDIA_TYPES.LIVE),
      url: liveUrls.m3u8,
      fallbackUrl: liveUrls.ts,
    }))
  })

  ;(apiData?.vodStreams || []).forEach((stream, index) => {
    const streamId = getByKeys(stream, ['stream_id', 'id'])
    addCatalogItem(catalog, createXtreamItem({
      item: stream,
      index,
      type: MEDIA_TYPES.MOVIES,
      groupName: movieCategoryMap[getByKeys(stream, ['category_id'])] || getByKeys(stream, ['category_name'], MEDIA_TYPES.MOVIES),
      url: createXtreamStreamUrl(normalizedCredentials, 'movie', streamId, 'mp4'),
    }))
  })

  ;(apiData?.series || []).forEach((series, index) => {
    addCatalogItem(catalog, createXtreamItem({
      item: series,
      index,
      type: MEDIA_TYPES.SERIES,
      groupName: seriesCategoryMap[getByKeys(series, ['category_id'])] || getByKeys(series, ['category_name'], MEDIA_TYPES.SERIES),
      url: '',
    }))
  })

  return attachSearchIndexes(catalog)
}

function getAttribute(line, attributeName) {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, 'i')
  return line.match(pattern)?.[1]?.trim() || ''
}

function getDisplayName(line) {
  const commaIndex = line.indexOf(',')
  return commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : ''
}

function inferType({ url, groupTitle, tvgName, name }) {
  const searchable = `${url} ${groupTitle} ${tvgName} ${name}`.toLowerCase()

  if (/\b(radio|rádio|radios|rádios|fm|am)\b/.test(searchable)) return MEDIA_TYPES.RADIOS
  if (/\b(movie|movies|filme|filmes|vod|cinema)\b/.test(searchable)) return MEDIA_TYPES.MOVIES
  if (/\b(series|séries|serie|série|season|temporada|episode|epis[oó]dio|s\d{1,2}e\d{1,3})\b/.test(searchable)) return MEDIA_TYPES.SERIES
  if (/\b(live|tv|canais|canal|channel|news|sports?)\b/.test(searchable)) return MEDIA_TYPES.LIVE

  return MEDIA_TYPES.OTHERS
}

function toBucket(type) {
  switch (type) {
    case MEDIA_TYPES.LIVE:
      return 'live'
    case MEDIA_TYPES.MOVIES:
      return 'movies'
    case MEDIA_TYPES.SERIES:
      return 'series'
    case MEDIA_TYPES.RADIOS:
      return 'radios'
    default:
      return 'others'
  }
}

function createMediaItem({ index, extinf, url }) {
  const groupTitle = getAttribute(extinf, 'group-title')
  const tvgName = getAttribute(extinf, 'tvg-name')
  const tvgLogo = getAttribute(extinf, 'tvg-logo')
  const name = tvgName || getDisplayName(extinf) || `Item ${index + 1}`
  const type = inferType({ url, groupTitle, tvgName, name })

  return {
    id: getAttribute(extinf, 'tvg-id') || `${type.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
    nome: name,
    grupo: groupTitle || MEDIA_TYPES.OTHERS,
    logo: tvgLogo,
    url,
    tipo: type,
    epg: getAttribute(extinf, 'x-tvg-url') || '',
    'tvg-id': getAttribute(extinf, 'tvg-id'),
    'tvg-name': tvgName,
    'tvg-logo': tvgLogo,
    'group-title': groupTitle,
    country: getAttribute(extinf, 'tvg-country') || getAttribute(extinf, 'country'),
    language: getAttribute(extinf, 'tvg-language') || getAttribute(extinf, 'language'),
  }
}

export function parseM3UPlaylist(content, sourceUrl = '') {
  const catalog = { ...createEmptyCatalog(), sourceUrl, loadedAt: new Date().toISOString() }
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let pendingExtinf = ''
  let itemIndex = 0

  lines.forEach((line) => {
    if (line.startsWith('#EXTINF')) {
      pendingExtinf = line
      return
    }

    if (line.startsWith('#') || !pendingExtinf) return

    const item = createMediaItem({ index: itemIndex, extinf: pendingExtinf, url: line })
    const bucket = toBucket(item.tipo)

    catalog[bucket].push(item)
    catalog.all.push(item)
    catalog.groups[item.grupo] = [...(catalog.groups[item.grupo] || []), item]
    pendingExtinf = ''
    itemIndex += 1
  })

  return attachSearchIndexes(catalog)
}

export function MediaManagerProvider({ children }) {
  const [catalog, setCatalog] = useState(createEmptyCatalog)

  const loadPlaylist = useCallback((content, sourceUrl = '') => {
    const parsedCatalog = parseM3UPlaylist(content, sourceUrl)
    setCatalog(parsedCatalog)
    return parsedCatalog
  }, [])

  const loadXtreamCatalog = useCallback((apiData, credentials = {}) => {
    const parsedCatalog = parseXtreamCatalog(apiData, credentials)
    setCatalog(parsedCatalog)
    return parsedCatalog
  }, [])

  const clearCatalog = useCallback(() => setCatalog(createEmptyCatalog()), [])

  const value = useMemo(() => ({
    ...catalog,
    loadPlaylist,
    loadXtreamCatalog,
    clearCatalog,
    hasPlaylist: catalog.all.length > 0,
    counts: {
      live: catalog.live.length,
      movies: catalog.movies.length,
      series: catalog.series.length,
      radios: catalog.radios.length,
      others: catalog.others.length,
      all: catalog.all.length,
    },
  }), [catalog, clearCatalog, loadPlaylist, loadXtreamCatalog])

  return <MediaManagerContext.Provider value={value}>{children}</MediaManagerContext.Provider>
}

export function useMediaManager() {
  const context = useContext(MediaManagerContext)
  if (!context) throw new Error('useMediaManager deve ser usado dentro de MediaManagerProvider')
  return context
}
