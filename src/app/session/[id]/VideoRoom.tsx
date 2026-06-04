'use client'

import { useState, useEffect } from 'react'
import { Video, Clock, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  roomUrl: string | null
  isLive: boolean
  isOver: boolean
  scheduledAt: string
  durationMinutes: number
}

export default function VideoRoom({ roomUrl, isLive, isOver, scheduledAt, durationMinutes }: Props) {
  const [joined,     setJoined]     = useState(false)
  const [msUntil,    setMsUntil]    = useState(() => new Date(scheduledAt).getTime() - Date.now())
  const [nowLive,    setNowLive]    = useState(isLive)

  // Live countdown ticker
  useEffect(() => {
    if (isOver) return
    const tick = setInterval(() => {
      const until = new Date(scheduledAt).getTime() - Date.now()
      setMsUntil(until)
      const start = new Date(scheduledAt).getTime()
      const end   = start + durationMinutes * 60_000
      const n     = Date.now()
      setNowLive(n >= start - 15 * 60_000 && n <= end)
    }, 5_000)
    return () => clearInterval(tick)
  }, [scheduledAt, durationMinutes, isOver])

  function formatCountdown(ms: number) {
    if (ms <= 0) return 'gleich'
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    if (h > 0) return `${h} Std. ${m} Min.`
    if (m > 0) return `${m} Min.`
    return 'weniger als 1 Min.'
  }

  if (isOver) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center">
        <Video className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="font-medium text-gray-700 mb-1">Session beendet</p>
        <p className="text-sm text-gray-400">Danke für die Session!</p>
      </div>
    )
  }

  if (!nowLive) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-10 text-center">
        <Clock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="font-medium text-gray-700 mb-1">Session startet in {formatCountdown(msUntil)}</p>
        <p className="text-sm text-gray-400">
          Der Videoraum öffnet 15 Minuten vor Beginn.
        </p>
        <p className="text-sm text-gray-400 mt-1">
          {new Date(scheduledAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr ·{' '}
          {new Date(scheduledAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}
        </p>
      </div>
    )
  }

  if (!roomUrl) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <p className="font-medium text-amber-800 mb-1">Videoraum wird vorbereitet</p>
        <p className="text-sm text-amber-700">
          Der Link wird in Kürze verfügbar sein. Bitte lade die Seite neu oder kontaktiere den Coach.
        </p>
      </div>
    )
  }

  if (!joined) {
    return (
      <div className="rounded-2xl border-2 border-green-200 bg-white p-10 text-center shadow-sm">
        <div className="h-16 w-16 rounded-full bg-green-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Video className="h-8 w-8 text-white" />
        </div>
        <p className="text-xl font-bold text-gray-900 mb-2">Session ist bereit</p>
        <p className="text-sm text-gray-500 mb-6">
          Stelle sicher, dass Kamera und Mikrofon erlaubt sind, bevor du beitrittst.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => setJoined(true)} className="gap-2 px-6">
            <Video className="h-4 w-4" />
            Session beitreten
          </Button>
          <a href={roomUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2 w-full sm:w-auto">
              <ExternalLink className="h-4 w-4" />
              In neuem Tab öffnen
            </Button>
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <div className="bg-gray-900 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-white text-sm font-medium">Live</span>
        </div>
        <a
          href={roomUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <iframe
        src={roomUrl}
        allow="camera; microphone; fullscreen; display-capture; autoplay"
        className="w-full"
        style={{ height: '520px', border: 'none' }}
        title="Video-Session"
      />
    </div>
  )
}
