import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

function isHlsUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(url || '')
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
        console.warn('[LIVE TV] Primary .m3u8 failed; trying .ts fallback.')
        setActiveUrl(fallbackUrl)
        return true
      }

      return false
    }

    const handleError = () => {
      if (!isCurrent || tryFallback()) return
      setIsLoading(false)
      setError('Este canal não pôde ser reproduzido agora.')
    }

    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('playing', handleCanPlay)
    video.addEventListener('error', handleError)

    if (!isHlsUrl(activeUrl) || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = activeUrl
    } else if (Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(activeUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (isCurrent) setIsLoading(false)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
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
