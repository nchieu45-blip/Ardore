'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { berlinDateTimeToIso, currentBerlinDateString } from '@/lib/coaching-slots'
import { formatGroupOccurrence } from '@/lib/group-schedule'

export default function GroupRescheduleDialog({ classId, occurrenceStart, scheduledAt }: {
  classId: string; occurrenceStart: string; scheduledAt: string
}) {
  const router = useRouter(), id = useId(), dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null), requestId = useRef<string | null>(null), busy = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false), [date, setDate] = useState(''), [time, setTime] = useState('')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const node = dialog.current, opener = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node?.showModal()
    return () => { request.current?.abort(); node?.close(); document.body.style.overflow = overflow; opener?.focus() }
  }, [open])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  function edit(value: string, field: 'date' | 'time') {
    if (busy.current) return
    requestId.current = null
    setError('')
    if (field === 'date') setDate(value); else setTime(value)
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy.current) return
    if (!berlinDateTimeToIso(date, time)) { setError('Bitte wähle ein gültiges Datum und eine eindeutige Uhrzeit in Europe/Berlin.'); return }
    busy.current = true; setSaving(true); setError('')
    requestId.current ??= crypto.randomUUID()
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`/api/video-classes/${classId}/reschedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ occurrenceStart, expectedStart: scheduledAt, newDate: date, newTime: time, requestId: requestId.current }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.ok !== true) {
        setError(typeof result?.error === 'string' ? result.error : 'Die Antwort konnte nicht bestätigt werden. Bitte lade den Termin neu.'); return
      }
      setOpen(false); router.refresh()
    } catch { setError('Die Antwort konnte nicht empfangen werden. Bitte lade den Termin neu und prüfe die aktuelle Zeit. Deine Auswahl bleibt erhalten.') }
    finally { clearTimeout(timeout); busy.current = false; setSaving(false) }
  }
  const input = 'min-h-11 w-full min-w-0 rounded-xl border border-border bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
  return <div className="mb-6">
    <Button variant="secondary" onClick={() => { setError(''); requestId.current = null; setOpen(true) }}>Gruppentermin verschieben</Button>
    {open && <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={event => { event.preventDefault(); if (!busy.current) setOpen(false) }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-white p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:p-7">
      <form onSubmit={submit}>
        <h2 id={`${id}-title`} className="text-xl font-semibold">Gruppentermin verschieben</h2>
        <p id={`${id}-description`} className="mt-3 text-sm leading-relaxed text-muted">Du verschiebst diesen Termin für alle bestätigten Teilnehmer. Alle Teilnehmer und du erhalten eine E-Mail mit der alten und neuen Zeit. Andere Termine der Kursreihe bleiben unverändert.</p>
        <p className="mt-3 text-sm font-medium">Bisher: {formatGroupOccurrence(scheduledAt)}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium">Neues Datum<input className={`${input} mt-2`} type="date" value={date} min={currentBerlinDateString()} required disabled={saving} onChange={e => edit(e.target.value, 'date')} /></label>
          <label className="min-w-0 text-sm font-medium">Neue Uhrzeit<input className={`${input} mt-2`} type="time" value={time} required disabled={saving} onChange={e => edit(e.target.value, 'time')} /></label>
        </div>
        <p className="mt-2 text-xs text-muted">Alle Zeiten gelten für Europe/Berlin. Eine Verschiebung ist nur vor Öffnung des Videoraums möglich.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-800">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button type="submit" loading={saving}>Termin für alle verschieben</Button>
        </div>
        {error && <Button type="button" variant="tertiary" className="mt-3 w-full" disabled={saving} onClick={() => { setOpen(false); router.refresh() }}>Aktuellen Termin neu laden</Button>}
      </form>
    </dialog>}
  </div>
}
