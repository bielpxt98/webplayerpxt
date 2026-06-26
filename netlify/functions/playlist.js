const REQUEST_TIMEOUT_MS = 25000
const ERROR_BODY_PREVIEW_LENGTH = 2000

const XTREAM_DATA_ENDPOINTS = [
  { key: 'liveCategories', action: 'get_live_categories', label: 'categorias LIVE' },
  { key: 'liveStreams', action: 'get_live_streams', label: 'canais LIVE' },
  { key: 'vodStreams', action: 'get_vod_streams', label: 'filmes' },
  { key: 'series', action: 'get_series', label: 'séries' },
]

function jsonResponse(statusCode, message, details = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ error: message, ...details }),
  }
}

function normalizeServer(server = '') {
  const trimmed = String(server).trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function getCredentials(payload) {
  const server = normalizeServer(payload.server)
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()

  if (!server || !username || !password) return null
  return { server, username, password }
}

function buildXtreamApiUrl({ server, username, password }, action = '') {
  const params = new URLSearchParams({ username, password })
  if (action) params.set('action', action)
  return `${server}/player_api.php?${params.toString()}`
}

function safeLogUrl(xtreamUrl) {
  try {
    const url = new URL(xtreamUrl)
    if (url.searchParams.has('password')) url.searchParams.set('password', '***')
    return url.toString()
  } catch {
    return 'URL inválida'
  }
}

async function readErrorPreview(response) {
  const text = await response.text()
  return text.slice(0, ERROR_BODY_PREVIEW_LENGTH)
}

async function fetchXtreamJson(credentials, endpoint, signal) {
  const xtreamUrl = buildXtreamApiUrl(credentials, endpoint.action)
  const startedAt = Date.now()

  console.log('[playlist] Buscando API Xtream', {
    endpoint: endpoint.label,
    url: safeLogUrl(xtreamUrl),
    timeoutMs: REQUEST_TIMEOUT_MS,
  })

  const response = await fetch(xtreamUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'webplayerpxt-netlify-xtream-proxy/2.0',
    },
    signal,
  })

  console.log('[playlist] Resposta da API Xtream', {
    endpoint: endpoint.label,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    elapsedMs: Date.now() - startedAt,
  })

  if (!response.ok) {
    const upstreamBody = await readErrorPreview(response)
    const error = new Error(`Servidor IPTV retornou erro HTTP ${response.status} em ${endpoint.label}.`)
    error.status = response.status
    error.upstreamBody = upstreamBody
    throw error
  }

  const text = await response.text()
  if (!text.trim()) return null

  try {
    return JSON.parse(text)
  } catch (error) {
    error.message = `Resposta inválida da API Xtream em ${endpoint.label}: ${error.message}`
    error.upstreamBody = text.slice(0, ERROR_BODY_PREVIEW_LENGTH)
    throw error
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, 'Método não permitido. Use POST para buscar dados da API Xtream.', { status: 405 })
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, 'Requisição inválida. Envie server, username e password em JSON.', { status: 400 })
  }

  const credentials = getCredentials(payload)
  if (!credentials) {
    return jsonResponse(400, 'Informe server, username e password para buscar dados da API Xtream.', { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const account = await fetchXtreamJson(credentials, { key: 'account', action: '', label: 'login' }, controller.signal)

    if (account?.user_info && String(account.user_info.auth) === '0') {
      return jsonResponse(401, 'Login Xtream não autorizado. Verifique usuário e senha.', { status: 401 })
    }

    const entries = await Promise.all(
      XTREAM_DATA_ENDPOINTS.map(async (endpoint) => [endpoint.key, await fetchXtreamJson(credentials, endpoint, controller.signal)]),
    )
    const catalog = { account, ...Object.fromEntries(entries) }

    console.log('[playlist] Dados da API Xtream recebidos com sucesso', {
      liveCategories: Array.isArray(catalog.liveCategories) ? catalog.liveCategories.length : 0,
      liveStreams: Array.isArray(catalog.liveStreams) ? catalog.liveStreams.length : 0,
      vodStreams: Array.isArray(catalog.vodStreams) ? catalog.vodStreams.length : 0,
      series: Array.isArray(catalog.series) ? catalog.series.length : 0,
      elapsedMs: Date.now() - startedAt,
    })

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        source: 'xtream-player-api',
        server: credentials.server,
        fetchedAt: new Date().toISOString(),
        ...catalog,
      }),
    }
  } catch (error) {
    const isTimeout = error.name === 'AbortError'
    const statusCode = isTimeout ? 504 : error.status || 502

    console.error('[playlist] Falha ao buscar dados da API Xtream', {
      message: error.message,
      name: error.name,
      status: statusCode,
      elapsedMs: Date.now() - startedAt,
    })

    return jsonResponse(
      statusCode,
      isTimeout
        ? `Timeout ao buscar dados da API Xtream após ${REQUEST_TIMEOUT_MS}ms.`
        : `Falha ao buscar dados da API Xtream: ${error.message}`,
      {
        status: statusCode,
        cause: error.name,
        upstreamBody: error.upstreamBody,
      },
    )
  } finally {
    clearTimeout(timeout)
  }
}
