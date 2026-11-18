import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

const PLAYBACK_EVENTS = [
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'play',
  'playing',
  'waiting',
  'stalled',
  'suspend',
  'abort',
  'error',
]

const HLS_MIME_TYPES = ['application/x-mpegurl', 'application/vnd.apple.mpegurl']

function getVideoError(video) {
  if (!video?.error) return null

  return {
    code: video.error.code,
    message: video.error.message || '',
  }
}

function getPlaybackSnapshot(video) {
  if (!video) return {}

  return {
    readyState: video.readyState,
    networkState: video.networkState,
    error: getVideoError(video),
    duration: Number.isFinite(video.duration) ? video.duration : video.duration,
    currentSrc: video.currentSrc || video.src || '',
    src: video.src || '',
  }
}

function isHlsStream(url, contentType) {
  const normalizedContentType = String(contentType || '').toLowerCase()
  const normalizedUrl = String(url || '').toLowerCase().split('?')[0]

  return (
    normalizedUrl.endsWith('.m3u8') ||
    String(url || '').toLowerCase().includes('.m3u8') ||
    HLS_MIME_TYPES.some((mimeType) => normalizedContentType.includes(mimeType))
  )
}

function buildBackendProxyUrl(targetUrl) {
  if (!targetUrl || targetUrl.startsWith('/api/stream-proxy')) return targetUrl || ''
  return `/api/stream-proxy?url=${encodeURIComponent(targetUrl)}`
}

function playVideo(video, onPlaybackUrlChange) {
  const playPromise = video.play()

  if (playPromise && typeof playPromise.then === 'function') {
    playPromise
      .then(() => {
        onPlaybackUrlChange?.({ playStatus: 'resolved', playError: '' })
      })
      .catch((error) => {
        const playError = `${error?.name || 'PlayError'}: ${error?.message || String(error)}`
        onPlaybackUrlChange?.({ playStatus: 'rejected', playError })
      })
  } else {
    onPlaybackUrlChange?.({ playStatus: 'no-promise', playError: '' })
  }
}

export default function HlsPlayer({ url, fallbackUrl = '', contentType = '', title, isLive = false, onPlaybackUrlChange }) {
  const videoRef = useRef(null)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [playerStatus, setPlayerStatus] = useState('idle')
  const hlsRef = useRef(null)
  const activeUrlRef = useRef('')

  const isLiveStream = Boolean(isLive || url?.includes('/live/') || url?.includes('.m3u8'))

  // Lista de tentativas automáticas para contornar bloqueios de HTTP puro / Mixed Content / CORS
  const candidates = (() => {
    if (!url) return []
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
    const proxiedMain = buildBackendProxyUrl(url)
    const proxiedFallback = fallbackUrl ? buildBackendProxyUrl(fallbackUrl) : ''
    const list = []

    if (isHttps) {
      // Em HTTPS (Render/mobile), usa o proxy em 1º lugar para não disparar erro de Mixed Content
      if (proxiedMain) list.push(proxiedMain)
      if (proxiedFallback && !list.includes(proxiedFallback)) list.push(proxiedFallback)
      if (!list.includes(url)) list.push(url)
      if (fallbackUrl && !list.includes(fallbackUrl)) list.push(fallbackUrl)
    } else {
      list.push(url)
      if (fallbackUrl && !list.includes(fallbackUrl)) list.push(fallbackUrl)
      if (proxiedMain && !list.includes(proxiedMain)) list.push(proxiedMain)
      if (proxiedFallback && !list.includes(proxiedFallback)) list.push(proxiedFallback)
    }
    return list
  })()

  useEffect(() => {
    setCandidateIndex(0)
  }, [url, fallbackUrl])

  const effectiveUrl = candidates[candidateIndex] || ''

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const logPlaybackEvent = (event) => {
      const snapshot = getPlaybackSnapshot(video)
      if (['loadeddata', 'canplay', 'playing'].includes(event.type)) {
        setPlayerStatus('ready')
      }
      onPlaybackUrlChange?.({
        loadedVideoUrl: snapshot.currentSrc,
        videoError: snapshot.error ? JSON.stringify(snapshot.error) : '',
      })
    }

    PLAYBACK_EVENTS.forEach((eventName) => {
      video.addEventListener(eventName, logPlaybackEvent)
    })

    return () => {
      PLAYBACK_EVENTS.forEach((eventName) => {
        video.removeEventListener(eventName, logPlaybackEvent)
      })
    }
  }, [onPlaybackUrlChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    if (!effectiveUrl) {
      setPlayerStatus('idle')
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
      return undefined
    }

    setPlayerStatus('loading')
    activeUrlRef.current = effectiveUrl

    const hlsSupported = Hls.isSupported()
    const nativeHlsSupport = video.canPlayType('application/vnd.apple.mpegurl')
    const shouldUseHls = isHlsStream(effectiveUrl, contentType)

    onPlaybackUrlChange?.({
      url: effectiveUrl,
      format: shouldUseHls ? 'm3u8' : 'native',
      hlsSupported: String(hlsSupported),
      nativeHlsSupport: nativeHlsSupport || 'no',
      loadedVideoUrl: video.currentSrc || video.src || '',
      manifestParsed: '',
      playStatus: '',
      playError: '',
      videoError: '',
    })

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    video.pause()
    video.removeAttribute('src')
    video.load()

    if (shouldUseHls && hlsSupported) {
      const hlsConfig = {
        enableWorker: true,
        autoStartLoad: true,
        capLevelToPlayerSize: false,
        abrEwmaDefaultEstimate: 3500000, // Começa em qualidade média rápida (~3.5 Mbps)
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        xhrSetup(xhr) {
          xhr.withCredentials = false
        },
      }

      if (isLiveStream) {
        Object.assign(hlsConfig, {
          liveSyncDurationCount: 2, // Mantém colado a apenas 2 segmentos do ao vivo real
          liveMaxLatencyDurationCount: 4, // Não deixa atrasar mais de 4 segmentos
          maxLiveSyncPlaybackRate: 1.15, // Recupera atrasos imperceptivelmente
          liveDurationInfinity: true, // Mostra como transmissão AO VIVO contínua (infinito)
          lowLatencyMode: true,
          backBufferLength: 30, // Mantém a memória leve e fluida
        })
      }

      const hls = new Hls(hlsConfig)
      hlsRef.current = hls

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setPlayerStatus('ready')
        onPlaybackUrlChange?.({ manifestParsed: 'sim', loadedVideoUrl: video.currentSrc || video.src || '' })

        // Se houver múltiplos níveis (ex: 480p, 720p, 1080p), começa no nível médio e sobe para o mais alto
        if (data?.levels && data.levels.length > 1) {
          const midIndex = Math.floor(data.levels.length / 2)
          hls.startLevel = midIndex
        }

        playVideo(video, onPlaybackUrlChange)
        if (isLiveStream && typeof hls.liveSyncPosition === 'number' && hls.liveSyncPosition > 0) {
          video.currentTime = hls.liveSyncPosition
        }
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        onPlaybackUrlChange?.({
          errorSource: data?.fatal ? 'hls-fatal' : 'hls-warning',
          errorDetail: `${data?.type || 'unknown'}: ${data?.details || 'sem detalhes'}`,
          failedUrl: activeUrlRef.current,
        })

        if (data?.fatal) {
          if (candidateIndex + 1 < candidates.length) {
            setCandidateIndex((prev) => prev + 1)
          } else {
            setPlayerStatus('error')
          }
        }
      })

      hls.loadSource(effectiveUrl)
      hls.attachMedia(video)
    } else {
      video.src = effectiveUrl
      video.load()
      playVideo(video, onPlaybackUrlChange)
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }

      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [effectiveUrl, candidateIndex, candidates.length, contentType, onPlaybackUrlChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const handleError = () => {
      const failedUrl = activeUrlRef.current
      const videoError = getVideoError(video)

      if (candidateIndex + 1 < candidates.length) {
        onPlaybackUrlChange?.({
          failedUrl,
          errorSource: 'video-error-retry',
          errorDetail: JSON.stringify(videoError || {}),
        })
        setCandidateIndex((prev) => prev + 1)
        return
      }

      setPlayerStatus('error')
      onPlaybackUrlChange?.({
        failedUrl,
        errorSource: 'video-error-final',
        errorDetail: JSON.stringify(videoError || {}),
        videoError: JSON.stringify(videoError || {}),
      })
    }

    video.addEventListener('error', handleError)
    return () => video.removeEventListener('error', handleError)
  }, [candidateIndex, candidates.length, onPlaybackUrlChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const handleFullscreenChange = () => {
      const isFs = document.fullscreenElement === video || document.fullscreenElement?.contains(video)
      if (isFs) {
        try {
          if (window.screen?.orientation?.lock) {
            window.screen.orientation.lock('landscape').catch(() => {})
          }
        } catch (_) {}
      }
    }

    const handleWebkitBegin = () => {
      try {
        if (window.screen?.orientation?.lock) {
          window.screen.orientation.lock('landscape').catch(() => {})
        }
      } catch (_) {}
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    video.addEventListener('webkitbeginfullscreen', handleWebkitBegin)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      video.removeEventListener('webkitbeginfullscreen', handleWebkitBegin)
    }
  }, [])

  return (
    <div className="hls-player" aria-live="polite">
      <video ref={videoRef} controls playsInline title={title || 'Player LIVE TV'} />
      {playerStatus === 'idle' && <div className="player-overlay">Selecione um item para iniciar</div>}
      {playerStatus === 'loading' && <div className="cortex-mini-spinner" aria-label="Carregando..." />}
      {playerStatus === 'error' && (
        <div className="player-error">
          Falha na reprodução do stream. Verifique se o conteúdo está ativo no provedor.
        </div>
      )}
    </div>
  )
}
