'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock3, ExternalLink, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  endpoint: string
  request?: { occurrenceStart: string }
  scheduledAt: string
  durationMinutes: number
  configurationReady: boolean
}

// Credentials are issued after explicit server authorization, never persisted.
export function privateVideoUrl(roomUrl: unknown, token: unknown): string | null {
  if (typeof roomUrl !== 'string' || typeof token !== 'string' || token.length > 8192
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null
  try {
    const url = new URL(roomUrl)
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.daily\.co$/.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash
      || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null
    url.searchParams.set('t', token)
    return url.href
  } catch { return null }
}

export default function ProtectedVideoRoom({ endpoint, request, scheduledAt, durationMinutes, configurationReady }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [joining, setJoining] = useState(false)
  const [callUrl, setCallUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const start = Date.parse(scheduledAt)
  const end = start + durationMinutes * 60_000
  const validWindow = Number.isFinite(start) && Number.isInteger(durationMinutes) && durationMinutes >= 5 && durationMinutes <= 480
  const ended = validWindow && now >= end
  const open = validWindow && now >= start - 15 * 60_000 && now < end

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => { clearInterval(timer); controller.current?.abort() }
  }, [])

  async function join() {
    if (pending.current || !open || !configurationReady) return
    pending.current = true
    setJoining(true)
    setError('')
    controller.current = new AbortController()
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request ?? {}), signal: controller.current.signal,
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) {
        setError(response.status === 401
          ? 'Bitte melde dich erneut an und öffne diese Session noch einmal.'
          : response.status === 409
          ? 'Der Zugang ist für diesen Termin noch nicht oder nicht mehr verfügbar. Bitte lade die Buchung erneut.'
          : 'Der Videoraum konnte nicht geöffnet werden. Versuche es erneut oder kontaktiere deinen Coach.')
        return
      }
      const url = privateVideoUrl(result.roomUrl, result.token)
      if (!url) throw new Error('Invalid video access response')
      setCallUrl(url)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError('Die Verbindung zum Videodienst ist fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.')
      }
    } finally {
      pending.current = false
      setJoining(false)
    }
  }

  if (!validWindow) return <p role="alert" className="rounded-xl border border-border p-5 text-sm text-muted">Der Termin konnte nicht geprüft werden. Bitte lade deine Buchung erneut.</p>
  if (ended) return <div className="rounded-xl border border-border p-6"><h2 className="font-semibold">Termin beendet</h2><p className="mt-2 text-sm text-muted">Der Videozugang für diesen Termin ist geschlossen.</p></div>
  if (!configurationReady) return <div role="status" className="rounded-xl border border-border p-6"><h2 className="font-semibold">Videoanrufe sind noch nicht eingerichtet</h2><p className="mt-2 text-sm leading-relaxed text-muted">Der Videodienst ist noch nicht verbunden. Bitte kläre die Durchführung mit deinem Coach, bevor der Termin beginnt.</p></div>
  if (!open) return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="h-5 w-5 text-brand" aria-hidden="true" />Der Videoraum öffnet vor deinem Termin</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">Du kannst 15 Minuten vor Beginn beitreten. Dein Zugang gilt nur für diesen Termin.</p>
      <p className="mt-3 text-sm font-medium">{new Date(start).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' })} Uhr (Berlin)</p>
    </div>
  )
  if (callUrl) return (
    <section aria-label="Videoanruf" className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Video className="h-4 w-4 text-brand" aria-hidden="true" />Videoanruf</h2>
        <div className="flex items-center gap-2">
          <a href={callUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="icon-button" aria-label="Videoraum in einem neuen Tab öffnen"><ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
          <button type="button" onClick={() => setCallUrl(null)} className="icon-button" aria-label="Videoraum schließen"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      <iframe src={callUrl} title="Privater Videoanruf" referrerPolicy="no-referrer" allow="camera; microphone; fullscreen; display-capture; autoplay" allowFullScreen className="w-full border-0" style={{ height: 'min(70svh, 640px)', minHeight: 360 }} />
    </section>
  )
  return (
    <section aria-label="Am Videoanruf teilnehmen" className="rounded-xl border border-border bg-white p-6">
      <h2 className="text-lg font-semibold">Deinem Videoanruf beitreten</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">Öffne den privaten Videoraum. Kamera und Mikrofon kannst du vor dem Beitritt prüfen.</p>
      <Button onClick={join} loading={joining} className="mt-5 w-full gap-2 sm:w-auto"><Video className="h-4 w-4" aria-hidden="true" />{joining ? 'Videoraum wird geöffnet …' : 'Videoanruf öffnen'}</Button>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  )
}
