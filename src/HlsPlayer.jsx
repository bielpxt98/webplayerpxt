import { useEffect, useRef } from 'react'

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
  }
}

export default function HlsPlayer({ url, title, onPlaybackUrlChange }) {
  const videoRef = useRef(null)

  useEffect(() => {
    onPlaybackUrlChange?.({ url: url || '', format: 'm3u8' })
  }, [url, onPlaybackUrlChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const logPlaybackEvent = (event) => {
      console.info(`[HLS PLAYER] ${event.type}`, getPlaybackSnapshot(video))
    }

    PLAYBACK_EVENTS.forEach((eventName) => {
      video.addEventListener(eventName, logPlaybackEvent)
    })

    return () => {
      PLAYBACK_EVENTS.forEach((eventName) => {
        video.removeEventListener(eventName, logPlaybackEvent)
      })
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !url) return undefined

    const playPromise = video.play()

    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          console.info('[HLS PLAYER] video.play() resolved', getPlaybackSnapshot(video))
        })
        .catch((error) => {
          console.info('[HLS PLAYER] video.play() rejected', {
            ...getPlaybackSnapshot(video),
            playError: {
              name: error?.name || '',
              message: error?.message || String(error),
            },
          })
        })
    } else {
      console.info('[HLS PLAYER] video.play() returned without promise', getPlaybackSnapshot(video))
    }

    return undefined
  }, [url])

  return (
    <div className="hls-player" aria-live="polite">
      <video ref={videoRef} controls playsInline title={title || 'Player LIVE TV'} src={url || ''} />
    </div>
  )
}
