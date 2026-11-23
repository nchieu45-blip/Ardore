'use client'

import Image from 'next/image'
import { Captions, ChevronDown, Play } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'

const videoPath = '/media/ardore-brand-motion-concept.mp4'
const posterPath = '/media/ardore-brand-motion-concept-poster.webp'
const captionsPath = '/media/ardore-brand-motion-concept.de.vtt'

export default function ArdoreProductVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLTrackElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [showCaptions, setShowCaptions] = useState(true)
  const [caption, setCaption] = useState('')

  useEffect(() => {
    const video = videoRef.current
    const trackElement = trackRef.current
    if (!video || !trackElement) return

    const track = trackElement.track
    function updateCaption() {
      setCaption(Array.from(track.activeCues ?? [], cue => (cue as VTTCue).text).join('\n'))
    }

    const updateTrackPresentation = () => {
      const fullscreen = document.fullscreenElement === video
        || ('webkitDisplayingFullscreen' in video && video.webkitDisplayingFullscreen === true)
      // The native fullscreen player can't display the inline caption area.
      trackElement.kind = fullscreen ? 'captions' : 'metadata'
      track.mode = fullscreen && showCaptions ? 'showing' : 'hidden'
    }

    track.addEventListener('cuechange', updateCaption)
    trackElement.addEventListener('load', updateCaption)
    document.addEventListener('fullscreenchange', updateTrackPresentation)
    video.addEventListener('webkitbeginfullscreen', updateTrackPresentation)
    video.addEventListener('webkitendfullscreen', updateTrackPresentation)
    updateTrackPresentation()

    return () => {
      track.removeEventListener('cuechange', updateCaption)
      trackElement.removeEventListener('load', updateCaption)
      document.removeEventListener('fullscreenchange', updateTrackPresentation)
      video.removeEventListener('webkitbeginfullscreen', updateTrackPresentation)
      video.removeEventListener('webkitendfullscreen', updateTrackPresentation)
    }
  }, [started, showCaptions])

  function startVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Mount the player before calling play so the browser can use the original gesture.
    flushSync(() => setStarted(true))
    const player = videoRef.current
    if (!player) return

    player.focus({ preventScroll: true })
    void player.play().catch((error: unknown) => {
      // The native play button stays available if a browser blocks scripted playback.
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) setFailed(true)
    })
  }

  return (
    <section
      className="home-dark-band bg-inverse"
      aria-labelledby="home-product-tour-title"
    >
      <div className="ardore-container home-band-space">
        <div className="mb-6 sm:mb-8">
          <h2 id="home-product-tour-title" className="section-title">
            So einfach geht’s
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-inverse sm:text-base">
            In 14 Sekunden siehst du, wie du Coaches, Angebote und Termine findest.
          </p>
        </div>

        <figure>
          <div className="home-demo-player relative overflow-hidden rounded-2xl border border-edge-inverse bg-inverse" data-active={started || undefined}>
            <div className="relative aspect-video">
              {!started && <Image src={posterPath} alt="" fill unoptimized fetchPriority="low" />}
            </div>
            {started ? (
              <video
                ref={videoRef}
                className="home-demo-video absolute inset-0 size-full object-contain object-top"
                controls
                playsInline
                preload="none"
                src={videoPath}
                poster={posterPath}
                aria-label="Ardore-Produktdemo"
                aria-describedby="home-product-tour-caption"
                onError={() => setFailed(true)}
              >
                <track ref={trackRef} kind="metadata" src={captionsPath} srcLang="de" label="Deutsch" />
              </video>
            ) : (
              <form action={videoPath} onSubmit={startVideo} className="absolute inset-0 grid place-items-center">
                <button type="submit" className="home-demo-play grid size-14 cursor-pointer place-items-center rounded-full border border-edge-inverse bg-inverse text-on-inverse hover:bg-brand-dark" aria-label="Produktdemo abspielen">
                  <Play className="size-5" aria-hidden="true" />
                </button>
              </form>
            )}
            {started && (
              <div className="relative z-10 grid min-h-30 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-brand-dark px-3 py-2 sm:min-h-20 sm:px-5">
                <p id="home-product-tour-subtitles" className="text-center text-sm leading-snug text-on-inverse wrap-anywhere sm:text-base sm:whitespace-pre-line">
                  {showCaptions ? caption : ''}
                </p>
                <button
                  type="button"
                  aria-label="Untertitel"
                  aria-pressed={showCaptions}
                  aria-controls="home-product-tour-subtitles"
                  title="Untertitel"
                  className="icon-button cursor-pointer rounded-lg border border-edge-inverse text-on-inverse aria-pressed:border-ember-on-dark aria-pressed:bg-ember-soft aria-pressed:text-ember-deep"
                  onClick={() => setShowCaptions(current => !current)}
                >
                  <Captions className="size-5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          <figcaption
            id="home-product-tour-caption"
            className="mt-2 text-xs leading-relaxed text-muted-inverse"
          >
            Fiktive Beispieldaten. Ohne Ton.
          </figcaption>
        </figure>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-on-inverse">
            Die Demo konnte hier nicht gestartet werden.{' '}
            <a href={videoPath} className="text-ember-on-dark underline">Video direkt öffnen</a>
          </p>
        )}

        <details className="group mt-3 max-w-3xl text-sm text-muted-inverse">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg font-medium text-ember-on-dark">
            Video nachlesen
            <ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-3 pb-2 pt-2 leading-relaxed">
            <p>
              Das Video zeigt die Ardore-Oberfläche. Namen, Angebote, Preise und Termine sind erfundene Beispiele.
            </p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                <span className="font-medium text-on-inverse">Ein Coach-Profil ansehen.</span>{' '}
                Im Beispiel siehst du Lena Hoffmanns Profil. Ihre Schwerpunkte sind Krafttraining und Beweglichkeit.
                Auf dem Bildschirm steht „Dein Ziel. Dein Coach.“
              </li>
              <li>
                <span className="font-medium text-on-inverse">Angebote vergleichen.</span>{' '}
                Die Demo zeigt ein Coaching für 69 Euro und 60 Minuten. Daneben liegt der Trainingsplan
                „Stark im Alltag“ für 29 Euro. Im Kalender ist Montag, der 19. Oktober 2026, um 11 Uhr ausgewählt.
              </li>
              <li>
                <span className="font-medium text-on-inverse">Die Coach-Ansicht kennenlernen.</span>{' '}
                Der Kalender zeigt einen Beispieltermin mit Mia Berger von 11 bis 12 Uhr. Danach siehst du,
                wo Coaches Produkte, Termine, Preise und Sitzungsdauer verwalten. Die Demo speichert und bucht nichts.
              </li>
            </ol>
          </div>
        </details>
      </div>
    </section>
  )
}
