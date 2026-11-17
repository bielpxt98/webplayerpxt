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

export default function HlsPlayer({ url, fallbackUrl = '', contentType = '', title, onPlaybackUrlChange }) {
  const videoRef = useRef(null)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [playerStatus, setPlayerStatus] = useState('idle')
  const hlsRef = useRef(null)
  const activeUrlRef = useRef('')

  // Lista de tentativas automáticas para contornar bloqueios de HTTP puro / Mixed Content / CORS
  const candidates = (() => {
    if (!url) return []
    const list = [url]
    if (fallbackUrl && !list.includes(fallbackUrl)) {
      list.push(fallbackUrl)
    }
    const proxiedMain = buildBackendProxyUrl(url)
    if (proxiedMain && !list.includes(proxiedMain)) {
      list.push(proxiedMain)
    }
    if (fallbackUrl) {
      const proxiedFallback = buildBackendProxyUrl(fallbackUrl)
      if (proxiedFallback && !list.includes(proxiedFallback)) {
        list.push(proxiedFallback)
      }
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
      const hls = new Hls({
        enableWorker: true,
        xhrSetup(xhr) {
          xhr.withCredentials = false
        },
      })
      hlsRef.current = hls

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerStatus('ready')
        onPlaybackUrlChange?.({ manifestParsed: 'sim', loadedVideoUrl: video.currentSrc || video.src || '' })
        playVideo(video, onPlaybackUrlChange)
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

  return (
    <div className="hls-player" aria-live="polite">
      <video ref={videoRef} controls playsInline title={title || 'Player LIVE TV'} />
      {playerStatus === 'idle' && <div className="player-overlay">Selecione um item para iniciar</div>}
      {playerStatus === 'loading' && <div className="player-overlay">Carregando player...</div>}
      {playerStatus === 'error' && (
        <div className="player-error">
          Falha na reprodução do stream. Verifique se o conteúdo está ativo no provedor.
        </div>
      )}
    </div>
  )
}
