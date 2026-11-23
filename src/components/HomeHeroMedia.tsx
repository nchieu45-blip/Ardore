'use client'

import Image from 'next/image'
import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const posterPath = '/media/hero/poster.webp'
type Connection = EventTarget & { saveData?: boolean; effectiveType?: string }
type Variant = 'mobile' | 'desktop'

function BackgroundLoop({ variant, poster, userPaused, onUserPause }: {
  variant: Variant
  poster: string
  userPaused: boolean
  onUserPause: (paused: boolean) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return <>
    <video ref={video} aria-hidden="true" className="home-hero-photo home-hero-video"
      autoPlay={!userPaused} muted loop playsInline preload="metadata" poster={poster}
      onLoadedMetadata={() => setReady(true)} onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onError={event => {
        // React also propagates source errors. Let the browser try the MP4.
        if (event.target === event.currentTarget) setFailed(true)
      }}>
      <source src={`/media/hero/${variant}.webm`} type="video/webm" />
      <source src={`/media/hero/${variant}.mp4`} type="video/mp4" onError={() => setFailed(true)} />
    </video>
    {ready && <button type="button" className="home-hero-playback"
      aria-label={playing ? 'Hintergrundvideo pausieren' : 'Hintergrundvideo abspielen'}
      onClick={() => {
        const element = video.current
        if (!element) return
        if (element.paused) {
          void element.play().then(() => onUserPause(false), () => setPlaying(false))
        } else {
          element.pause()
          onUserPause(true)
        }
      }}>
      {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
    </button>}
  </>
}

export default function HomeHeroMedia() {
  const image = useRef<HTMLImageElement>(null)
  const [poster, setPoster] = useState(posterPath)
  const [variant, setVariant] = useState<Variant | null>(null)
  const [userPaused, setUserPaused] = useState(false)

  useEffect(() => {
    const available = process.env.NEXT_PUBLIC_HERO_VARIANTS?.split(',') ?? []
    if (!available.some(Boolean)) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const narrow = window.matchMedia('(max-width: 767px)')
    const connection = (navigator as Navigator & { connection?: Connection }).connection
    let painted = false
    let disposed = false
    let frame = 0
    let timer = 0
    function update() {
      const selected = narrow.matches ? 'mobile' : 'desktop'
      const slow = ['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '')
      setVariant(painted && !reduced.matches && !connection?.saveData && !slow &&
        available.includes(selected) ? selected : null)
    }
    const afterDecode = () => {
      if (disposed) return
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          setPoster(image.current?.currentSrc || posterPath)
          painted = true
          update()
        })
      })
    }
    function startAfterLoad() {
      // Give the poster, fonts and initial render priority over video bytes.
      timer = window.setTimeout(() => {
        void (image.current?.decode() ?? Promise.resolve()).then(afterDecode, afterDecode)
      }, 1500)
    }
    if (document.readyState === 'complete') startAfterLoad()
    else window.addEventListener('load', startAfterLoad, { once: true })
    reduced.addEventListener('change', update)
    narrow.addEventListener('change', update)
    connection?.addEventListener('change', update)
    return () => {
      disposed = true
      window.removeEventListener('load', startAfterLoad)
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      reduced.removeEventListener('change', update)
      narrow.removeEventListener('change', update)
      connection?.removeEventListener('change', update)
    }
  }, [])

  return <>
    <Image ref={image} src={posterPath} alt="" fill preload fetchPriority="high" quality={55}
      sizes="100vw" className="home-hero-photo" />
    {variant && <BackgroundLoop key={variant} variant={variant} poster={poster}
      userPaused={userPaused} onUserPause={setUserPaused} />}
  </>
}
