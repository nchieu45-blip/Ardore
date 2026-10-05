'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { addDaysToDateString, currentBerlinDateString } from '@/lib/coaching-slots'
import { bookingsForDate, calendarDates, calendarDateLabel, calendarSegments, calendarTime, type CalendarBooking, type CalendarData } from '@/lib/coach-calendar'
import { BOOKING_STATUS_STYLES, bookingPaymentSummary, bookingStatusLabel } from '@/lib/booking-presentation'

const subscribe = (fn: () => void) => { const query = window.matchMedia('(min-width: 768px)'); query.addEventListener('change', fn); return () => query.removeEventListener('change', fn) }
const control = 'rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600'
const styles = { available: 'border-green-300 bg-green-50 text-green-900', unavailable: 'border-gray-200 bg-gray-50 text-gray-600', buffer: 'border-amber-300 bg-amber-50 text-amber-900' }
const labels = { available: 'Verfügbar', unavailable: 'Nicht verfügbar', buffer: 'Pufferzeit · gesperrt' }

function BookingCard({ booking: b, now }: { booking: CalendarBooking; now: number }) {
  const ended = Date.parse(b.scheduled_at) + b.duration_minutes * 60_000 <= now
  return <Link href={`/session/${b.id}`} className={`block rounded-lg border p-3 text-xs break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${BOOKING_STATUS_STYLES[b.status] ?? 'bg-gray-50 border-gray-200'}`}>
    <span className="block font-semibold">{b.buyer_name || 'Kunde'} · {bookingStatusLabel(b.status)}</span>
    <span className="block mt-1">{calendarTime(Date.parse(b.scheduled_at))} – {calendarTime(Date.parse(b.scheduled_at) + b.duration_minutes * 60_000)}</span>
    <span className="block mt-1">1:1 Coaching · {b.duration_minutes} Min</span>
    <span className="block mt-1">{bookingPaymentSummary(b)}</span>
    {ended && <span className="block mt-1">Vergangener Termin</span>}
    <span className="block mt-2 underline">Sessiondetails →</span>
  </Link>
}

export default function CoachCalendar() {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia('(min-width: 768px)').matches, () => false)
  const [chosenView, setView] = useState<'day' | 'week' | null>(null)
  const view = chosenView ?? (desktop ? 'week' : 'day')
  const [date, setDate] = useState(currentBerlinDateString)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRetry(v => v + 1) }
    const interval = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const [result, setResult] = useState<{ key: string; data?: CalendarData; error?: string } | null>(null)
  const key = `${date}:${view}:${retry}`
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    async function load() {
      let message = 'Der Kalender konnte nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut.'
      try {
        const response = await fetch(`/api/coaching/calendar?date=${date}&view=${view}`, { signal: controller.signal, cache: 'no-store' })
        const body = await response.json()
        if (!response.ok) {
          if (typeof body.error === 'string') message = body.error
          throw new Error(message)
        }
        if (!controller.signal.aborted) setResult({ key, data: body })
      } catch {
        if (!controller.signal.aborted) setResult({ key, error: message })
        else if (!disposed) setResult({ key, error: 'Das Laden dauert zu lange. Bitte versuche es erneut.' })
      } finally { clearTimeout(timeout) }
    }
    let disposed = false
    void load()
    return () => { disposed = true; clearTimeout(timeout); controller.abort() }
  }, [date, view, key])
  const current = result?.key === key ? result : null
  const dates = calendarDates(date, view)
  const data = current?.data
  return <div className="ardore-workspace py-8">
    <h1 className="section-title">Dein Kalender</h1>
    <p className="mt-2 text-sm text-gray-600">Verfügbarkeit und 1:1 Termine · Europe/Berlin. Terminaktionen und Meeting-Status findest du in den Details.</p>
    <div className="mt-4 flex flex-wrap gap-3 text-sm text-green-700">
      <Link className="underline focus-visible:ring-2" href="/creator/settings/videocoaching">Verfügbarkeit bearbeiten</Link>
      <Link className="underline focus-visible:ring-2" href="/creator/sessions">Alle Buchungen</Link>
    </div>
    <div className="my-5 flex flex-wrap items-center gap-2" aria-label="Kalendernavigation">
      <button className={control} onClick={() => setDate(currentBerlinDateString())}>Heute</button>
      <button className={control} aria-label={view === 'week' ? 'Vorherige Woche' : 'Vorheriger Tag'} onClick={() => setDate(addDaysToDateString(date, view === 'week' ? -7 : -1))}>←</button>
      <button className={control} aria-label={view === 'week' ? 'Nächste Woche' : 'Nächster Tag'} onClick={() => setDate(addDaysToDateString(date, view === 'week' ? 7 : 1))}>→</button>
      <label className="text-sm">Datum <input type="date" min="1900-01-01" max="2100-12-31" value={date} onChange={e => { if (e.target.value) setDate(e.target.value) }} className={`${control} max-w-full`} /></label>
      <div className="flex gap-2" role="group" aria-label="Ansicht">
        {(['day', 'week'] as const).map(v => <button key={v} className={`${control} ${view === v ? 'bg-green-50 text-green-800' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'day' ? 'Tag' : 'Woche'}</button>)}
      </div>
      <button className={control} onClick={() => setRetry(v => v + 1)}>Aktualisieren</button>
    </div>
    <h2 className="mb-3 font-semibold" aria-live="polite">{calendarDateLabel(dates[0])}{view === 'week' ? ` – ${calendarDateLabel(dates[6])}` : ''}</h2>
    <p className="mb-4 text-xs text-gray-600">Grün: verfügbar · Bestätigt/Reserviert: belegt · Gelb: Puffer · Grau: nicht verfügbar. Verfügbarkeit berücksichtigt Vorlauf, Buchungshorizont und Angebotsstatus; konkrete Slots prüft weiterhin die Buchungsfunktion.</p>
    {!current && <p role="status">Kalender wird geladen …</p>}
    {current?.error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p>{current.error}</p><button className={`${control} mt-3`} onClick={() => setRetry(v => v + 1)}>Erneut versuchen</button></div>}
    {data && <>
      {!data.availability.offer?.is_enabled && <p className="mb-4 text-sm text-amber-800">Dein Coaching-Angebot ist deaktiviert. Bestehende Termine bleiben sichtbar.</p>}
      <div className={`grid items-start gap-3 ${view === 'week' ? 'md:grid-cols-7' : ''}`}>
        {dates.map(d => {
          const bookings = bookingsForDate(d, data.bookings)
          const segments = calendarSegments(d, data)
          const history = bookings.filter(b => !['confirmed', 'pending_payment'].includes(b.status))
          return <section key={d} aria-label={calendarDateLabel(d)} className="min-w-0 surface-card p-3">
            <h3 className="mb-3 text-sm font-semibold">{calendarDateLabel(d)}</h3>
            {!bookings.length && <p className="mb-2 text-xs text-gray-600">Keine Termine</p>}
            {!segments.some(s => s.kind === 'available') && <p className="mb-2 text-xs text-gray-600">Keine freie Verfügbarkeit</p>}
            <ol className="space-y-2" aria-label="Tagesverlauf">{segments.map(s => <li key={s.start}>
              {s.kind === 'booking' ? s.bookingIds.map(id => <BookingCard key={id} booking={data.bookings.find(b => b.id === id)!} now={data.loadedAt} />) : <div className={`rounded-lg border p-2 text-xs ${styles[s.kind]}`}>
                <p className="font-medium">{labels[s.kind]}</p><p>{calendarTime(s.start)} – {s.end === segments.at(-1)?.end ? '24:00' : calendarTime(s.end)}</p>
              </div>}
            </li>)}</ol>
            {history.length > 0 && <div className="mt-4 space-y-2"><h4 className="text-xs font-semibold">Weitere Termine · keine Slotsperre</h4>{history.map(b => <BookingCard key={b.id} booking={b} now={data.loadedAt} />)}</div>}
          </section>
        })}
      </div>
    </>}
  </div>
}
