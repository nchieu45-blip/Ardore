'use client'

import { useState, useEffect, useRef, useId } from 'react'
import { useRouter } from 'next/navigation'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { currentBerlinDateString } from '@/lib/coaching-slots'
import { rescheduleDays, rescheduleSlots, submitReschedule } from '@/lib/reschedule-ui'

interface Props { bookingId: string; creatorId: string; coachName: string; onClose: () => void; onSuccess: () => void }
const MONTH_LABELS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const control = 'rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

export default function RescheduleModal({ bookingId, creatorId, coachName, onClose, onSuccess }: Props) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), errorRef = useRef<HTMLParagraphElement>(null)
  const busy = useRef(false), requestRef = useRef<AbortController | null>(null), router = useRouter()
  const today = currentBerlinDateString()
  const [period, setPeriod] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })
  const { year, month } = period
  const [availDays, setAvailDays] = useState<number[]>([]), [daysLoading, setDaysLoading] = useState(true), [daysError, setDaysError] = useState<string | null>(null), [daysRetry, setDaysRetry] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<string[]>([]), [slotsLoading, setSlotsLoading] = useState(false), [slotsError, setSlotsError] = useState<string | null>(null), [slotsRetry, setSlotsRetry] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  useEffect(() => {
    const node = dialog.current, opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node?.showModal() // Native top layer: focus trap and inert background.
    node?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      requestRef.current?.abort()
      node?.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000)
    let disposed = false
    setDaysLoading(true); setDaysError(null)
    async function load() {
      try {
        const response = await fetch(`/api/coaching/available-days?creatorId=${creatorId}&year=${year}&month=${month}&excludeBookingId=${bookingId}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Availability unavailable')
        const days = rescheduleDays(await response.json(), lastDay)
        if (!disposed) setAvailDays(days)
      } catch { if (!disposed) { setAvailDays([]); setDaysError('Die verfügbaren Tage konnten nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut.') } }
      finally { clearTimeout(timeout); if (!disposed) setDaysLoading(false) }
    }
    void load()
    return () => { disposed = true; clearTimeout(timeout); controller.abort() }
  }, [bookingId, creatorId, year, month, lastDay, daysRetry])
  useEffect(() => {
    if (!selectedDate) { setSlots([]); setSlotsError(null); setSlotsLoading(false); return }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000)
    let disposed = false
    setSlotsLoading(true); setSlotsError(null)
    async function load() {
      try {
        const response = await fetch(`/api/coaching/slots?creatorId=${creatorId}&date=${selectedDate}&excludeBookingId=${bookingId}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Slots unavailable')
        const nextSlots = rescheduleSlots(await response.json())
        if (!disposed) { setSlots(nextSlots); setSelectedSlot(current => current && nextSlots.includes(current) ? current : null) }
      } catch { if (!disposed) { setSlots([]); setSlotsError('Die Uhrzeiten konnten nicht geladen werden. Bitte prüfe deine Verbindung und lade sie erneut.') } }
      finally { clearTimeout(timeout); if (!disposed) setSlotsLoading(false) }
    }
    void load()
    return () => { disposed = true; clearTimeout(timeout); controller.abort() }
  }, [bookingId, creatorId, selectedDate, slotsRetry])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy.current || uncertain) return
    if (!selectedDate || !selectedSlot) { setError('Bitte wähle ein Datum und eine Uhrzeit.'); return }
    busy.current = true; setSubmitting(true); setError(null)
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30_000)
    requestRef.current = controller
    const result = await submitReschedule({ bookingId, date: selectedDate, time: selectedSlot, signal: controller.signal })
    clearTimeout(timeout); busy.current = false; setSubmitting(false)
    if (result.ok) { onSuccess(); return }
    setError(result.message); setUncertain(result.uncertain)
    if (result.conflict) { setSelectedSlot(null); setSlotsRetry(v => v + 1); setDaysRetry(v => v + 1) }
  }
  function changeMonth(delta: number) {
    if (busy.current) return
    const next = new Date(Date.UTC(year, month + delta, 1))
    setPeriod({ year: next.getUTCFullYear(), month: next.getUTCMonth() })
    setAvailDays([]); setSelectedDate(null); setSlots([]); setSelectedSlot(null); setError(null)
  }
  const cells: (number | null)[] = [...Array<null>((new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7).fill(null), ...Array.from({ length: lastDay }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const dateError = daysError ? `${id}-days-error` : ''
  const slotError = slotsError ? `${id}-slots-error` : ''
  const submissionError = error ? `${id}-error` : ''
  return <dialog ref={dialog} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); if (!busy.current) onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === errorRef.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}
    onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && !busy.current && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose() }}
    style={{ width: 'min(28rem, calc(100% - 2rem))' }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border-0 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm">
    <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
      <h2 id={`${id}-title`} className="font-semibold">Session verschieben</h2>
      <button type="button" aria-label="Dialog schließen" disabled={submitting} className={control} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></button>
    </header>
    <form noValidate onSubmit={handleSubmit} className="space-y-5 p-5">
      <p id={`${id}-description`} className="text-sm text-gray-600">Wähle einen neuen Termin mit {coachName}. Pflichtfelder: Datum und Uhrzeit. Alle Zeiten: Europe/Berlin.</p>
      <fieldset disabled={submitting} role="radiogroup" aria-required="true" aria-labelledby={`${id}-date-label`} aria-describedby={[`${id}-date-help`, dateError, submissionError].filter(Boolean).join(' ')} aria-invalid={Boolean(daysError)}>
        <legend id={`${id}-date-label`} className="mb-2 text-sm font-semibold">Neues Datum (Pflichtfeld)</legend>
        <p id={`${id}-date-help`} className="mb-2 text-xs text-gray-500">Mit Tab zur Datumsauswahl; mit den Pfeiltasten einen verfügbaren Tag wählen.</p>
        <div className="mb-3 flex items-center justify-between">
          <button type="button" aria-label="Vorheriger Monat" disabled={`${year}-${String(month + 1).padStart(2, '0')}` <= today.slice(0, 7) || submitting} className={control} onClick={() => changeMonth(-1)}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
          <span aria-live="polite" className="text-sm font-semibold">{MONTH_LABELS[month]} {year}</span>
          <button type="button" aria-label="Nächster Monat" disabled={submitting} className={control} onClick={() => changeMonth(1)}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-0.5" aria-hidden="true">{DAY_LABELS.map(d => <span key={d} className="py-1 text-center text-xs text-gray-500">{d}</span>)}</div>
        {daysLoading ? <p role="status" className="py-5 text-center text-sm">Verfügbare Tage werden geladen …</p> : <div className="grid grid-cols-7 gap-0.5">{cells.map((day, i) => {
          if (!day) return <div key={i} />
          const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, enabled = date >= today && availDays.includes(day)
          const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })
          return <div key={day} className="relative">
            <input type="radio" id={`${id}-date-${day}`} name={`${id}-date`} value={date} required disabled={!enabled || submitting} checked={selectedDate === date} onChange={() => { setSelectedDate(date); setSelectedSlot(null); setSlots([]); setError(null) }} className="peer sr-only" aria-describedby={[`${id}-date-help`, dateError, submissionError].filter(Boolean).join(' ')} />
            <label htmlFor={`${id}-date-${day}`} className={`flex aspect-square cursor-pointer items-center justify-center rounded-xl text-sm peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-green-700 peer-focus-visible:ring-inset ${selectedDate === date ? 'bg-green-600 text-white' : enabled ? 'text-gray-900 hover:bg-green-50' : 'cursor-not-allowed text-gray-400'}`}><span aria-hidden="true">{day}</span><span className="sr-only">{label}</span></label>
          </div>
        })}</div>}
        {!daysLoading && !daysError && availDays.length === 0 && <p role="status" className="mt-2 text-sm text-gray-600">In diesem Monat sind keine freien Termine verfügbar. Wähle einen anderen Monat.</p>}
      </fieldset>
      {daysError && <div><p id={`${id}-days-error`} role="alert" className="text-sm text-red-700">{daysError}</p><button type="button" disabled={submitting} className={`${control} mt-2 border border-gray-300`} onClick={() => setDaysRetry(v => v + 1)}>Tage erneut laden</button></div>}
      {selectedDate && <fieldset disabled={submitting} role="radiogroup" aria-required="true" aria-labelledby={`${id}-time-label`} aria-describedby={[`${id}-time-help`, slotError, submissionError].filter(Boolean).join(' ')} aria-invalid={Boolean(slotsError || error)}>
        <legend id={`${id}-time-label`} className="mb-2 text-sm font-semibold">Uhrzeit (Pflichtfeld)</legend><p id={`${id}-time-help`} className="mb-2 text-xs text-gray-500">Europe/Berlin. Mit den Pfeiltasten eine freie Uhrzeit wählen.</p>
        {slotsLoading ? <p role="status" className="py-3 text-sm">Uhrzeiten werden geladen …</p> : slots.length === 0 && !slotsError ? <p role="status" className="text-sm text-gray-600">Keine freien Uhrzeiten an diesem Tag. Bitte wähle ein anderes Datum.</p> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{slots.map((slot, i) => <div key={slot} className="relative">
          <input type="radio" id={`${id}-slot-${i}`} name={`${id}-slot`} value={slot} required checked={selectedSlot === slot} disabled={submitting} onChange={() => { setSelectedSlot(slot); setError(null) }} className="peer sr-only" aria-describedby={[`${id}-time-help`, slotError, submissionError].filter(Boolean).join(' ')} />
          <label htmlFor={`${id}-slot-${i}`} className={`block cursor-pointer rounded-xl border px-1 py-2 text-center text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-green-700 peer-focus-visible:ring-offset-2 ${selectedSlot === slot ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 hover:bg-green-50'}`}>{slot} Uhr</label>
        </div>)}</div>}
      </fieldset>}
      {slotsError && <div><p id={`${id}-slots-error`} role="alert" className="text-sm text-red-700">{slotsError}</p><button type="button" disabled={submitting} className={`${control} mt-2 border border-gray-300`} onClick={() => setSlotsRetry(v => v + 1)}>Uhrzeiten erneut laden</button></div>}
      {error && <p ref={errorRef} tabIndex={-1} id={`${id}-error`} role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 focus-visible:ring-2 focus-visible:ring-red-700">{error}</p>}
      {submitting && <p role="status" aria-live="polite" className="text-sm">Dein Termin wird verschoben. Bitte warte auf die Bestätigung.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={submitting} onClick={onClose} className={`${control} border border-gray-300`}>Abbrechen</button>
        {uncertain ? <button type="button" className={`${control} bg-green-600 text-white`} onClick={() => { onClose(); router.refresh() }}>Buchung neu laden</button> : <button type="submit" disabled={!selectedDate || !selectedSlot || daysLoading || slotsLoading || Boolean(daysError || slotsError) || submitting} aria-busy={submitting} className={`${control} flex-1 bg-green-600 text-white hover:bg-green-700`}>{submitting ? 'Wird verschoben …' : 'Neuen Termin bestätigen'}</button>}
      </div>
    </form>
  </dialog>
}
