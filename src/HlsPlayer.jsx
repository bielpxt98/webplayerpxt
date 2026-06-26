import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

function maskDiagnosticUrl(url) {
  return url || ''
}

function getErrorMessage(errorType) {
  if (errorType === Hls.ErrorTypes.NETWORK_ERROR) return 'Não foi possível carregar o canal. Verifique a URL ou tente outro canal.'
  if (errorType === Hls.ErrorTypes.MEDIA_ERROR) return 'O navegador não conseguiu reproduzir este canal.'
  return 'Este canal não pôde ser reproduzido agora.'
}

function getMediaError(video) {
  return video.error ? {
    code: video.error.code,
    message: video.error.message,
  } : null
}

async function playVideo(video, context) {
  try {
    await video.play()
    console.debug('[LIVE TV] video.play() resolved', context)
  } catch (error) {
    console.error('[LIVE TV] video.play() rejected', {
      ...context,
      error,
    })
  }
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

    const nativeHlsSupport = video.canPlayType('application/vnd.apple.mpegurl')
    const hlsJsSupport = Hls.isSupported()
    const isTransportStreamUrl = /\.ts(?:[?#].*)?$/i.test(activeUrl)
    const shouldUseNativePlayback = Boolean(nativeHlsSupport) || activeUrl === fallbackUrl || isTransportStreamUrl
    const diagnosticContext = {
      url: maskDiagnosticUrl(activeUrl),
      fallbackUrl: maskDiagnosticUrl(fallbackUrl),
      hlsJsSupport,
      nativeHlsSupport,
      shouldUseNativePlayback,
      isTransportStreamUrl,
    }

    console.debug('[LIVE TV] HLS playback support', diagnosticContext)

    const logVideoEvent = (event) => {
      console.debug(`[LIVE TV] video event: ${event.type}`, {
        ...diagnosticContext,
        readyState: video.readyState,
        networkState: video.networkState,
        currentSrc: maskDiagnosticUrl(video.currentSrc),
        mediaError: getMediaError(video),
      })
    }
    const handleCanPlay = (event) => {
      logVideoEvent(event)
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

    const handleError = (event) => {
      logVideoEvent(event)
      if (!isCurrent || tryFallback()) return
      setIsLoading(false)
      console.error('[LIVE TV] Native video playback error', {
        ...diagnosticContext,
        mediaError: getMediaError(video),
      })
      setError('Este canal não pôde ser reproduzido agora.')
    }

    video.addEventListener('loadedmetadata', logVideoEvent)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('playing', handleCanPlay)
    video.addEventListener('error', handleError)

    if (shouldUseNativePlayback) {
      video.src = activeUrl
      playVideo(video, {
        ...diagnosticContext,
        mode: 'native',
      })
    } else if (hlsJsSupport) {
      hls = new Hls()
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.debug('[LIVE TV] Hls.js MANIFEST_PARSED', {
          ...diagnosticContext,
          levels: data?.levels?.length,
          audioTracks: data?.audioTracks?.length,
          subtitleTracks: data?.subtitleTracks?.length,
        })
        if (isCurrent) setIsLoading(false)
        playVideo(video, {
          ...diagnosticContext,
          mode: 'hls.js',
          event: Hls.Events.MANIFEST_PARSED,
        })
      })
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        console.debug('[LIVE TV] Hls.js LEVEL_LOADED', {
          ...diagnosticContext,
          level: data?.level,
          live: data?.details?.live,
          fragments: data?.details?.fragments?.length,
          targetduration: data?.details?.targetduration,
        })
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[LIVE TV] Hls.js ERROR', {
          ...diagnosticContext,
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
      hls.loadSource(activeUrl)
      hls.attachMedia(video)
    } else {
      setIsLoading(false)
      setError('Seu navegador não oferece suporte para reprodução HLS.')
    }

    return () => {
      isCurrent = false
      video.removeEventListener('loadedmetadata', logVideoEvent)
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
