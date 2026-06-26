function jsonResponse(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ error: message }),
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
    output: 'hls',
  })

  return `${normalizedServer}/get.php?${params.toString()}`
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, 'Método não permitido. Use POST para buscar a playlist.')
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, 'Requisição inválida. Envie server, username e password em JSON.')
  }

  const { server, username, password } = payload
  const xtreamUrl = buildXtreamUrl({ server, username, password })

  if (!xtreamUrl) {
    return jsonResponse(400, 'Informe server, username e password para buscar a playlist.')
  }

  try {
    const response = await fetch(xtreamUrl, { method: 'GET' })
    const playlistText = await response.text()

    if (!response.ok) {
      return jsonResponse(response.status, `Servidor IPTV retornou erro HTTP ${response.status}.`)
    }

    if (!playlistText.trim()) {
      return jsonResponse(502, 'Servidor IPTV retornou uma playlist vazia.')
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' },
      body: playlistText,
    }
  } catch (error) {
    return jsonResponse(502, `Falha ao buscar playlist no servidor IPTV: ${error.message}`)
  }
}
