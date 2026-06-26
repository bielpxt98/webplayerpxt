import { useEffect } from 'react'

export default function HlsPlayer({ url, title, onPlaybackUrlChange }) {
  useEffect(() => {
    onPlaybackUrlChange?.({ url: url || '', format: 'm3u8' })
  }, [url, onPlaybackUrlChange])

  return (
    <div className="hls-player" aria-live="polite">
      <video controls playsInline title={title || 'Player LIVE TV'} src={url || ''} />
    </div>
  )
}
