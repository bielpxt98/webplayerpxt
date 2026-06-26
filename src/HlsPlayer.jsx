import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

function maskDiagnosticUrl(url) {
  if (!url) return ''

  try {
    const parsedUrl = new URL(url)
    const parts = parsedUrl.pathname.split('/')
    const credentialIndex = parts.findIndex((part) => ['live', 'movie', 'series'].includes(part.toLowerCase()))

    if (credentialIndex >= 0 && parts[credentialIndex + 2]) {
      parts[credentialIndex + 2] = '••••••'
      parsedUrl.pathname = parts.join('/')
      return parsedUrl.toString()
    }
  } catch {
    return url.replace(/(\/(?:live|movie|series)\/[^/]+\/)([^/]+)(\/)/i, '$1••••••$3')
  }

  return url
}

function getErrorMessage(errorType) {
  if (errorType === Hls.ErrorTypes.NETWORK_ERROR) return 'Não foi possível carregar o canal. Verifique a URL ou tente outro canal.'
  if (errorType === Hls.ErrorTypes.MEDIA_ERROR) return 'O navegador não conseguiu reproduzir este canal.'
  return 'Este canal não pôde ser reproduzido agora.'
}

export default function HlsPlayer({ url, fallbackUrl, title }) {
  const videoRef = useRef(null)
  const [activeUrl, setActiveUrl] = useState(url || '')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setActiveUrl(url || '')
  }, [url])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    let hls
    let isCurrent = true

    setError('')
    setIsLoading(Boolean(activeUrl))
    video.pause()
    video.removeAttribute('src')
    video.load()

    if (!activeUrl) {
      setIsLoading(false)
      return undefined
    }

    const handleCanPlay = () => {
      if (isCurrent) setIsLoading(false)
    }
    const tryFallback = () => {
      const canFallback = fallbackUrl && activeUrl !== fallbackUrl
      if (canFallback) {
        console.warn('[LIVE TV] Primary playback URL failed; trying fallback URL.', {
          failedUrl: maskDiagnosticUrl(activeUrl),
          fallbackUrl: maskDiagnosticUrl(fallbackUrl),
        })
        setActiveUrl(fallbackUrl)
        return true
      }

      return false
    }

    const handleError = () => {
      if (!isCurrent || tryFallback()) return
      setIsLoading(false)
      console.error('[LIVE TV] Native video playback error', {
        url: maskDiagnosticUrl(activeUrl),
        fallbackUrl: maskDiagnosticUrl(fallbackUrl),
        mediaError: video.error ? {
          code: video.error.code,
          message: video.error.message,
        } : null,
      })
      setError('Este canal não pôde ser reproduzido agora.')
    }

    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('playing', handleCanPlay)
    video.addEventListener('error', handleError)

    const isTransportStreamUrl = /\.ts(?:[?#].*)?$/i.test(activeUrl)

    if (video.canPlayType('application/vnd.apple.mpegurl') || activeUrl === fallbackUrl || isTransportStreamUrl) {
      video.src = activeUrl
    } else if (Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(activeUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (isCurrent) setIsLoading(false)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[LIVE TV] HlsPlayer error detail', {
          url: maskDiagnosticUrl(activeUrl),
          fallbackUrl: maskDiagnosticUrl(fallbackUrl),
          type: data?.type,
          details: data?.details,
          fatal: data?.fatal,
          response: data?.response,
          error: data?.error,
        })
        if (!isCurrent || !data?.fatal) return
        if (tryFallback()) return
        setIsLoading(false)
        setError(getErrorMessage(data.type))
      })
    } else {
      setIsLoading(false)
      setError('Seu navegador não oferece suporte para reprodução HLS.')
    }

    return () => {
      isCurrent = false
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('playing', handleCanPlay)
      video.removeEventListener('error', handleError)
      if (hls) hls.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [activeUrl, fallbackUrl])

  return (
    <div className="hls-player" aria-live="polite">
      <video ref={videoRef} controls playsInline title={title || 'Player LIVE TV'} />
      {isLoading && <div className="player-overlay">Carregando conteúdo...</div>}
      {error && <div className="player-error" role="alert">{error}</div>}
    </div>
  )
}
