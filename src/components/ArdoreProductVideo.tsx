'use client'

import Image from 'next/image'
import { ChevronDown, Play } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'

const videoPath = '/media/ardore-brand-motion-concept.mp4'
const posterPath = '/media/ardore-brand-motion-concept-poster.webp'

export default function ArdoreProductVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)

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
                <track kind="captions" src="/media/ardore-brand-motion-concept.de.vtt" srcLang="de" label="Deutsch" />
              </video>
            ) : (
              <form action={videoPath} onSubmit={startVideo} className="absolute inset-0 grid place-items-center">
                <button type="submit" className="home-demo-play grid size-14 cursor-pointer place-items-center rounded-full border border-edge-inverse bg-inverse text-on-inverse hover:bg-brand-dark" aria-label="Produktdemo abspielen">
                  <Play className="size-5" aria-hidden="true" />
                </button>
              </form>
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
