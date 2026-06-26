const REQUEST_TIMEOUT_MS = 25000
const ERROR_BODY_PREVIEW_LENGTH = 2000

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

function buildXtreamUrl({ server, username, password }) {
  const normalizedServer = normalizeServer(server)
  const cleanUsername = String(username || '').trim()
  const cleanPassword = String(password || '').trim()

  if (!normalizedServer || !cleanUsername || !cleanPassword) return ''

  const params = new URLSearchParams({
    username: cleanUsername,
    password: cleanPassword,
    type: 'm3u_plus',
    output: 'ts',
  })

  return `${normalizedServer}/get.php?${params.toString()}`
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, 'Método não permitido. Use POST para buscar a playlist.', {
      status: 405,
    })
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, 'Requisição inválida. Envie server, username e password em JSON.', {
      status: 400,
    })
  }

  const { server, username, password } = payload
  const xtreamUrl = buildXtreamUrl({ server, username, password })

  if (!xtreamUrl) {
    return jsonResponse(400, 'Informe server, username e password para buscar a playlist.', {
      status: 400,
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()

  console.log('[playlist] Buscando playlist Xtream', {
    url: safeLogUrl(xtreamUrl),
    timeoutMs: REQUEST_TIMEOUT_MS,
  })

  try {
    const response = await fetch(xtreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/plain, application/x-mpegURL, application/vnd.apple.mpegurl, */*',
        'User-Agent': 'webplayerpxt-netlify-playlist-proxy/1.0',
      },
      signal: controller.signal,
    })

    console.log('[playlist] Resposta do servidor Xtream', {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      elapsedMs: Date.now() - startedAt,
    })

    if (!response.ok) {
      const upstreamBody = await readErrorPreview(response)
      console.error('[playlist] Erro HTTP do servidor Xtream', {
        status: response.status,
        bodyPreview: upstreamBody,
      })

      return jsonResponse(response.status, `Servidor IPTV retornou erro HTTP ${response.status}.`, {
        status: response.status,
        upstreamStatus: response.status,
        upstreamBody,
      })
    }

    const playlistText = await response.text()

    if (!playlistText.trim()) {
      console.error('[playlist] Playlist vazia retornada pelo servidor Xtream', {
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      })

      return jsonResponse(502, 'Servidor IPTV retornou uma playlist vazia.', {
        status: 502,
        upstreamStatus: response.status,
      })
    }

    console.log('[playlist] Playlist Xtream recebida com sucesso', {
      chars: playlistText.length,
      elapsedMs: Date.now() - startedAt,
    })

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: playlistText,
    }
  } catch (error) {
    const isTimeout = error.name === 'AbortError'
    const statusCode = isTimeout ? 504 : 502

    console.error('[playlist] Falha ao buscar playlist Xtream', {
      message: error.message,
      name: error.name,
      status: statusCode,
      elapsedMs: Date.now() - startedAt,
    })

    return jsonResponse(
      statusCode,
      isTimeout
        ? `Timeout ao buscar playlist no servidor IPTV após ${REQUEST_TIMEOUT_MS}ms.`
        : `Falha ao buscar playlist no servidor IPTV: ${error.message}`,
      {
        status: statusCode,
        cause: error.name,
      },
    )
  } finally {
    clearTimeout(timeout)
  }
}
