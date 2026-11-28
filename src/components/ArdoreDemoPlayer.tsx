'use client'

import Image from 'next/image'
import { Captions, Maximize, Minimize, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

const videoPath = '/media/ardore-brand-motion-concept.mp4'
const posterPath = '/media/ardore-brand-motion-concept-poster.webp'
const captionsPath = '/media/ardore-brand-motion-concept.de.vtt'
const toolbarButton = 'icon-button cursor-pointer rounded-lg text-on-inverse hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50'

function formatTime(time: number) {
  const seconds = Math.floor(time)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function ArdoreDemoPlayer({ transcript }: { transcript: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLTrackElement>(null)
  const playButtonRef = useRef<HTMLButtonElement>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const fullscreenPending = useRef(false)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showCaptions, setShowCaptions] = useState(true)
  const [caption, setCaption] = useState('')
  const [fullscreen, setFullscreen] = useState<'native' | 'viewport' | null>(null)

  useEffect(() => {
    const trackElement = trackRef.current
    if (!trackElement) return

    const track = trackElement.track
    function updateCaption() {
      setCaption(Array.from(track.activeCues ?? [], cue => (cue as VTTCue).text).join('\n'))
    }

    track.addEventListener('cuechange', updateCaption)
    trackElement.addEventListener('load', updateCaption)
    track.mode = 'hidden'

    return () => {
      track.removeEventListener('cuechange', updateCaption)
      trackElement.removeEventListener('load', updateCaption)
    }
  }, [started])

  useEffect(() => {
    let wasFullscreen = false
    function syncFullscreen() {
      const isFullscreen = document.fullscreenElement === playerRef.current && playerRef.current !== null
      if (isFullscreen) setFullscreen('native')
      else if (wasFullscreen) {
        setFullscreen(null)
        fullscreenButtonRef.current?.focus({ preventScroll: true })
      }
      wasFullscreen = isFullscreen
    }

    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  useEffect(() => {
    if (fullscreen !== 'viewport') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [fullscreen])

  function play(video: HTMLVideoElement) {
    void video.play().catch((error: unknown) => {
      // The play button is available if the browser denies the first attempt.
      if (!(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError'))) setFailed(true)
    })
  }

  function startVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Mount the video before calling play so it can use the original gesture.
    flushSync(() => setStarted(true))
    playButtonRef.current?.focus({ preventScroll: true })
    if (videoRef.current) play(videoRef.current)
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) play(video)
    else video.pause()
  }

  function closeViewport() {
    const dialog = dialogRef.current
    if (!dialog?.matches(':modal')) return
    dialog.close()
    dialog.show()
    setFullscreen(null)
    fullscreenButtonRef.current?.focus({ preventScroll: true })
  }

  async function toggleFullscreen() {
    const dialog = dialogRef.current
    const player = playerRef.current
    if (!dialog || !player || fullscreenPending.current) return
    if (fullscreen === 'viewport') {
      closeViewport()
      return
    }
    if (document.fullscreenElement === player) {
      await document.exitFullscreen().catch(() => {})
      return
    }

    if (document.fullscreenEnabled && typeof player.requestFullscreen === 'function') {
      fullscreenPending.current = true
      try {
        await player.requestFullscreen()
        return
      } catch {
        // Use the same player in the viewport when element fullscreen is unavailable.
      } finally {
        fullscreenPending.current = false
      }
    }

    if (!dialog.isConnected) return
    dialog.close()
    dialog.showModal()
    setFullscreen('viewport')
    fullscreenButtonRef.current?.focus({ preventScroll: true })
  }

  function keepFullscreenFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (!fullscreen || event.key !== 'Tab') return

    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'))
      .filter(control => control.getClientRects().length > 0)
    if (controls.length === 0) return

    const current = controls.findIndex(control => control === document.activeElement)
    const next = event.shiftKey
      ? (current > 0 ? current - 1 : controls.length - 1)
      : (current + 1) % controls.length
    event.preventDefault()
    controls[next].focus()
  }

  const fullscreenLabel = fullscreen ? 'Vollbild verlassen' : 'Vollbild öffnen'

  return (
    <figure>
      {started ? (
        <dialog
          ref={dialogRef}
          open
          className="home-demo-dialog"
          aria-label="Ardore-Produktdemo"
          aria-modal={Boolean(fullscreen) || undefined}
          aria-describedby="home-product-tour-caption"
          onCancel={event => { event.preventDefault(); closeViewport() }}
          onKeyDown={keepFullscreenFocus}
        >
          <div ref={playerRef} className="home-demo-player overflow-hidden rounded-2xl border border-edge-inverse bg-inverse">
            <div className="home-demo-picture relative aspect-video">
              <video
                ref={videoRef}
                className="pointer-events-none absolute inset-0 size-full object-contain"
                playsInline
                preload="none"
                src={videoPath}
                poster={posterPath}
                onDurationChange={event => {
                  const length = event.currentTarget.duration
                  if (Number.isFinite(length)) setDuration(length)
                }}
                onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setFailed(true)}
              >
                <track ref={trackRef} kind="metadata" src={captionsPath} srcLang="de" label="Deutsch" />
              </video>
            </div>

            <div className="home-demo-subtitles grid min-h-30 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-brand-dark px-3 py-2 sm:min-h-20 sm:px-5">
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

            <div className="home-demo-toolbar flex shrink-0 items-center gap-2 px-2 py-1 sm:px-4" role="group" aria-label="Videosteuerung">
              <button ref={playButtonRef} type="button" aria-label={playing ? 'Pause' : 'Abspielen'} className={toolbarButton} onClick={togglePlayback} disabled={failed}>
                {playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                value={time}
                step={0.1}
                disabled={!duration || failed}
                aria-label="Wiedergabeposition"
                aria-valuetext={`${formatTime(time)} von ${formatTime(duration)}`}
                className="h-11 min-w-0 flex-1 cursor-pointer accent-ember-on-dark"
                onChange={event => {
                  const targetTime = event.currentTarget.valueAsNumber
                  if (videoRef.current) videoRef.current.currentTime = targetTime
                  setTime(targetTime)
                }}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-inverse max-[300px]:hidden" aria-hidden="true">{formatTime(time)} / {formatTime(duration)}</span>
              <button ref={fullscreenButtonRef} type="button" aria-label={fullscreenLabel} title={fullscreenLabel} className={toolbarButton} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize className="size-5" aria-hidden="true" /> : <Maximize className="size-5" aria-hidden="true" />}
              </button>
            </div>
            {failed && (
              <p role="alert" className="shrink-0 px-4 pb-4 text-sm text-on-inverse">
                Die Demo konnte hier nicht gestartet werden.{' '}
                <a href={videoPath} className="text-ember-on-dark underline">Video direkt öffnen</a>
              </p>
            )}
            {fullscreen && (
              <section tabIndex={0} className="home-demo-portrait-transcript border-t border-edge-inverse px-4 pb-4 pt-3 text-sm text-muted-inverse" aria-labelledby="home-demo-portrait-transcript-title">
                <h3 id="home-demo-portrait-transcript-title" className="font-semibold text-on-inverse">Video nachlesen</h3>
                {transcript}
              </section>
            )}
          </div>
        </dialog>
      ) : (
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-edge-inverse bg-inverse">
          <Image src={posterPath} alt="" fill unoptimized fetchPriority="low" />
          <form action={videoPath} onSubmit={startVideo} className="absolute inset-0 grid place-items-center">
            <button type="submit" className="home-demo-play grid size-14 cursor-pointer place-items-center rounded-full border border-edge-inverse bg-inverse text-on-inverse hover:bg-brand-dark" aria-label="Produktdemo abspielen">
              <Play className="size-5" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
      <figcaption id="home-product-tour-caption" className="mt-2 text-xs leading-relaxed text-muted-inverse">
        Fiktive Beispieldaten. Ohne Ton.
      </figcaption>
    </figure>
  )
}
