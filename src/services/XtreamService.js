const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_BASE_URL || '').replace(/\/+$/, '')

async function postJson(path, payload) {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

export const XtreamService = {
  getLiveCategories(credentials) {
    return postJson('/api/xtream/live-categories', {
      server: credentials?.server,
      username: credentials?.username,
      password: credentials?.password,
    })
  },
}
