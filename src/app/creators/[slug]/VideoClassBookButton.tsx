'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Lock } from 'lucide-react'
import { Button, buttonStyles } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import { formatGroupOccurrence, type GroupOccurrence } from '@/lib/group-schedule'

interface Props {
  classId: string
  priceCents: number
  listedPriceCents?: number
  occurrences: GroupOccurrence[]
  registeredOccurrences: string[]
  isLoggedIn: boolean
  loginHref?: string
}

type Availability = { occurrenceStart: string; capacity: number | null; remaining: number | null; isFull: boolean; videoReady: boolean }
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RETRYABLE = ['expired', 'failed', 'cancelled', 'refunded']
const UNRESOLVED = ['creating', 'open', 'processing', 'refund_pending', 'payment_review']

export default function VideoClassBookButton({ classId, priceCents, listedPriceCents = priceCents, occurrences, registeredOccurrences, isLoggedIn, loginHref = '/login' }: Props) {
  const router = useRouter()
  const selectorId = useId()
  const [selected, setSelected] = useState(occurrences[0]?.startsAt ?? '')
  const [loading, setLoading] = useState(false)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [availabilityError, setAvailabilityError] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle')
  const [confirmed, setConfirmed] = useState<string[]>(registeredOccurrences)
  const requestIds = useRef(new Map<string, string>())
  const pending = useRef(false)
  const booked = confirmed.some(value => Date.parse(value) === Date.parse(selected))

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    fetch(`/api/video-classes/${classId}/availability?startsAt=${encodeURIComponent(selected)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Availability unavailable')
        const value = await response.json()
        if (controller.signal.aborted) return
        const validCounts = value.capacity === null && value.remaining === null
          || Number.isSafeInteger(value.capacity) && value.capacity > 0 && Number.isSafeInteger(value.remaining) && value.remaining >= 0 && value.remaining <= value.capacity
        if (Date.parse(value.occurrenceStart) !== Date.parse(selected) || typeof value.isFull !== 'boolean' || typeof value.videoReady !== 'boolean' || !validCounts) throw new Error('Invalid availability')
        setAvailability(value)
        setAvailabilityError(false)
      })
      .catch(cause => { if (cause.name !== 'AbortError') setAvailabilityError(true) })
    return () => controller.abort()
  }, [classId, selected])

  function requestId(replace: boolean) {
    const key = `ardore:group-request:${classId}:${selected}`
    let value = replace ? null : requestIds.current.get(selected)
    try { value ??= replace ? null : sessionStorage.getItem(key) ?? undefined } catch { /* Memory fallback for restricted storage. */ }
    if (!value || !REQUEST_ID.test(value)) value = crypto.randomUUID()
    requestIds.current.set(selected, value)
    try { sessionStorage.setItem(key, value) } catch { /* The request remains stable for this page. */ }
    return value
  }

  async function handleBook() {
    if (pending.current || UNRESOLVED.includes(status) || !selected || !availability?.videoReady || availability.isFull || Date.parse(availability.occurrenceStart) !== Date.parse(selected)) return
    pending.current = true
    setLoading(true)
    setError('')
    try {
      const nextRequestId = requestId(RETRYABLE.includes(status))
      // Consume the explicit new-attempt action once. If its response is lost,
      // the next click must resume this new identity, never rotate it again.
      if (RETRYABLE.includes(status)) setStatus('idle')
      const response = await fetch(`/api/video-classes/${classId}/book`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: nextRequestId, occurrenceStart: selected, expectedPriceCents: listedPriceCents }),
      })
      const result = await response.json()
      if (typeof result.status === 'string') setStatus(result.status)
      if (!response.ok) {
        setError(typeof result.error === 'string' ? result.error : 'Die Buchung konnte nicht bestätigt werden. Versuche es erneut.')
        return
      }
      if (result.url) {
        const url = new URL(result.url)
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port) throw new Error('Invalid checkout destination')
        window.location.assign(url.href)
        return
      }
      if (result.status === 'confirmed' && result.bookingId) {
        setConfirmed(current => [...current, selected])
        router.refresh()
      } else if (UNRESOLVED.includes(result.status)) {
        setError(result.status === 'refund_pending'
          ? 'Die Erstattung wird noch bearbeitet. Du findest den aktuellen Stand unter „Meine Gruppenbuchungen“.'
          : 'Die Zahlung wird noch geprüft. Du findest den aktuellen Stand unter „Meine Gruppenbuchungen“.')
      } else {
        setError('Dieser Zahlungsversuch ist abgeschlossen. Du kannst die Buchung erneut versuchen.')
      }
    } catch {
      setError('Die Buchung konnte nicht bestätigt werden. Prüfe deine Verbindung. Ein erneuter Versuch setzt dieselbe Buchung fort.')
    } finally {
      pending.current = false
      setLoading(false)
    }
  }

  if (occurrences.length === 0) return <p className="text-sm text-muted">Zurzeit sind keine zukünftigen Termine verfügbar.</p>
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={selectorId} className="mb-1.5 block text-sm font-medium">Termin auswählen</label>
        <select id={selectorId} value={selected} disabled={loading} onChange={event => {
          setSelected(event.target.value); setAvailability(null); setAvailabilityError(false); setError(''); setStatus('idle')
        }} className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          {occurrences.map(occurrence => <option key={occurrence.startsAt} value={occurrence.startsAt}>{formatGroupOccurrence(occurrence.scheduledAt ?? occurrence.startsAt, 'compact')}</option>)}
        </select>
        <p className="mt-1.5 text-xs text-muted">Alle Terminzeiten: Europe/Berlin.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{priceCents === 0 ? 'Kostenlose Teilnahme an diesem Termin.' : `${formatCurrency(priceCents / 100)} für diesen Termin. Jeder weitere Termin wird separat gebucht.`}</p>
      </div>
      {booked ? <Link href={`/buyer/video-classes`} className={buttonStyles({ variant: 'secondary', className: 'w-full gap-2' })}><Check className="h-4 w-4" aria-hidden="true" />Gebucht · Zu meinen Gruppenbuchungen</Link>
        : !isLoggedIn ? <Link href={loginHref} className={buttonStyles({ className: 'w-full gap-2' })}><Lock className="h-4 w-4" aria-hidden="true" />Anmelden, um zu buchen</Link>
        : <>
          <Button size="sm" onClick={handleBook} loading={loading} disabled={!availability?.videoReady || availability.isFull || UNRESOLVED.includes(status)} className="w-full">
            {availabilityError ? 'Verfügbarkeit nicht erreichbar' : !availability ? 'Plätze werden geprüft …' : !availability.videoReady ? 'Video-Buchung noch nicht eingerichtet' : availability.isFull ? 'Termin ausgebucht' : status === 'refund_pending' ? 'Erstattung wird bearbeitet' : status === 'payment_review' ? 'Zahlung benötigt Prüfung' : UNRESOLVED.includes(status) ? 'Zahlung wird geprüft' : RETRYABLE.includes(status) ? 'Buchung erneut versuchen' : priceCents === 0 ? 'Diesen Termin kostenlos buchen' : `Termin buchen · ${formatCurrency(priceCents / 100)}`}
          </Button>
          {availability && availability.remaining !== null && !availability.isFull && <p className="text-xs text-muted">{availability.remaining} von {availability.capacity} Plätzen verfügbar.</p>}
          {availabilityError && <p role="alert" className="text-sm text-red-700">Die Plätze konnten nicht geprüft werden. Bitte lade die Seite erneut.</p>}
          {availability && !availability.videoReady && <p role="status" className="text-sm text-muted">Der Videodienst ist noch nicht verbunden. Für diesen Termin wird derzeit keine Zahlung angenommen.</p>}
        </>}
      {error && <p role="alert" className="text-sm leading-relaxed text-red-700">{error}</p>}
      {UNRESOLVED.includes(status) && <Link href="/buyer/video-classes" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-4">Meine Gruppenbuchungen ansehen</Link>}
    </div>
  )
}
