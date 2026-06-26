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

  return normalizedUrl.endsWith('.m3u8') || HLS_MIME_TYPES.some((mimeType) => normalizedContentType.includes(mimeType))
}

function playVideo(video, onPlaybackUrlChange) {
  const playPromise = video.play()

  if (playPromise && typeof playPromise.then === 'function') {
    playPromise
      .then(() => {
        console.info('[HLS PLAYER] video.play() resolved', getPlaybackSnapshot(video))
        onPlaybackUrlChange?.({ playStatus: 'resolved', playError: '' })
      })
      .catch((error) => {
        const playError = `${error?.name || 'PlayError'}: ${error?.message || String(error)}`
        console.info('[HLS PLAYER] video.play() rejected', {
          ...getPlaybackSnapshot(video),
          playError,
        })
        onPlaybackUrlChange?.({ playStatus: 'rejected', playError })
      })
  } else {
    console.info('[HLS PLAYER] video.play() returned without promise', getPlaybackSnapshot(video))
    onPlaybackUrlChange?.({ playStatus: 'no-promise', playError: '' })
  }
}

export default function HlsPlayer({ url, fallbackUrl = '', contentType = '', title, onPlaybackUrlChange }) {
  const videoRef = useRef(null)
  const [fallbackPlaybackUrl, setFallbackPlaybackUrl] = useState('')
  const hlsRef = useRef(null)
  const activeUrlRef = useRef('')
  const retryingFallbackRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const logPlaybackEvent = (event) => {
      const snapshot = getPlaybackSnapshot(video)
      console.info(`[HLS PLAYER] ${event.type}`, snapshot)
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
    setFallbackPlaybackUrl('')
  }, [url])

  const effectiveUrl = fallbackPlaybackUrl || url

  useEffect(() => {
    const video = videoRef.current
    if (!video || !effectiveUrl) return undefined

    activeUrlRef.current = effectiveUrl
    retryingFallbackRef.current = false

    const hlsSupported = Hls.isSupported()
    const nativeHlsSupport = video.canPlayType('application/vnd.apple.mpegurl')
    const shouldUseHls = isHlsStream(effectiveUrl, contentType)

    console.info('[HLS PLAYER] load source', {
      originalUrl: url,
      url: effectiveUrl,
      contentType,
      hlsSupported,
      nativeHlsSupport,
      shouldUseHls,
    })

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
      const hls = new Hls({ enableWorker: true })
      hlsRef.current = hls

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.info('[HLS PLAYER] MANIFEST_PARSED', getPlaybackSnapshot(video))
        onPlaybackUrlChange?.({ manifestParsed: 'sim', loadedVideoUrl: video.currentSrc || video.src || '' })
        playVideo(video, onPlaybackUrlChange)
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.info('[HLS PLAYER] Hls.js error', data)
        const errorDetail = `${data?.type || 'unknown'}: ${data?.details || 'sem detalhes'}`
        onPlaybackUrlChange?.({
          errorSource: data?.fatal ? 'hls-fatal' : 'hls-warning',
          errorDetail,
          failedUrl: activeUrlRef.current,
          manifestParsed: data?.fatal ? 'falhou' : '',
          playStatus: data?.fatal ? 'falhou' : '',
          playError: data?.fatal ? `Hls.js fatal: ${errorDetail}` : '',
        })

        if (!data?.fatal) return

        hls.stopLoad()

        if (fallbackUrl && fallbackUrl !== activeUrlRef.current && !retryingFallbackRef.current) {
          retryingFallbackRef.current = true
          setFallbackPlaybackUrl(fallbackUrl)
          return
        }

        hls.destroy()
        if (hlsRef.current === hls) hlsRef.current = null
        video.pause()
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
    }
  }, [effectiveUrl, url, fallbackUrl, contentType, onPlaybackUrlChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const handleError = () => {
      const failedUrl = activeUrlRef.current
      const videoError = getVideoError(video)

      if (fallbackUrl && fallbackUrl !== failedUrl && !retryingFallbackRef.current) {
        retryingFallbackRef.current = true
        console.info('[HLS PLAYER] retrying fallback URL after video.error', { failedUrl, fallbackUrl, videoError })
        onPlaybackUrlChange?.({ failedUrl, errorSource: 'video-error-original', errorDetail: JSON.stringify(videoError || {}) })
        setFallbackPlaybackUrl(fallbackUrl)
        return
      }

      onPlaybackUrlChange?.({
        failedUrl,
        errorSource: fallbackUrl === failedUrl ? 'video-error-final' : 'video-error',
        errorDetail: JSON.stringify(videoError || {}),
        videoError: JSON.stringify(videoError || {}),
      })
    }

    video.addEventListener('error', handleError)
    return () => video.removeEventListener('error', handleError)
  }, [fallbackUrl, onPlaybackUrlChange])

  return (
    <div className="hls-player" aria-live="polite">
      <video ref={videoRef} controls playsInline title={title || 'Player LIVE TV'} />
    </div>
  )
}
