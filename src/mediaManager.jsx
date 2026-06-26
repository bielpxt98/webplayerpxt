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
    loadedAt: null,
    sourceUrl: '',
  }
}

const MediaManagerContext = createContext(null)

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

  return catalog
}

export function MediaManagerProvider({ children }) {
  const [catalog, setCatalog] = useState(createEmptyCatalog)

  const loadPlaylist = useCallback((content, sourceUrl = '') => {
    const parsedCatalog = parseM3UPlaylist(content, sourceUrl)
    setCatalog(parsedCatalog)
    return parsedCatalog
  }, [])

  const clearCatalog = useCallback(() => setCatalog(createEmptyCatalog()), [])

  const value = useMemo(() => ({
    ...catalog,
    loadPlaylist,
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
  }), [catalog, clearCatalog, loadPlaylist])

  return <MediaManagerContext.Provider value={value}>{children}</MediaManagerContext.Provider>
}

export function useMediaManager() {
  const context = useContext(MediaManagerContext)
  if (!context) throw new Error('useMediaManager deve ser usado dentro de MediaManagerProvider')
  return context
}
