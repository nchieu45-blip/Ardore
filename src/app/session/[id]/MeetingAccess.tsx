'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function MeetingAccess({ bookingId, meetingUrl, isCoach, loadFailed }: {
  bookingId: string; meetingUrl: string | null; isCoach: boolean; loadFailed: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(meetingUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [hasMeeting, setHasMeeting] = useState(Boolean(meetingUrl))
  const [requested, setRequested] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const response = await fetch(`/api/coaching/meeting/${bookingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingUrl: value }),
      })
      const data = await response.json()
      if (!response.ok) { setError(data.error ?? 'Der Link konnte nicht gespeichert werden.'); return }
      setHasMeeting(true); setSaved(true); router.refresh()
    } catch { setError('Der Link konnte nicht gespeichert werden. Bitte prüfe deine Verbindung und versuche es erneut.') }
    finally { setSaving(false) }
  }

  async function requestLink() {
    if (saving || requested) return
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/coaching/meeting/${bookingId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) { setError(data.error ?? 'Deine Anfrage konnte nicht gespeichert werden.'); return }
      setRequested(!data.ready); router.refresh()
    } catch { setError('Deine Anfrage konnte nicht gespeichert werden. Bitte versuche es erneut.') }
    finally { setSaving(false) }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="meeting-heading">
      <h2 id="meeting-heading" className="text-lg font-semibold text-gray-900">{isCoach ? 'Deine Session durchführen' : 'An deiner Session teilnehmen'}</h2>
      <p className="mt-2 text-sm text-gray-600">Die Session findet über den externen Meeting-Dienst deines Coaches statt. Alle Terminzeiten sind in der Zeitzone Europe/Berlin angegeben.</p>
      {loadFailed && <p role="alert" className="mt-3 text-sm text-red-700">Der Meeting-Link konnte nicht geladen werden. Bitte lade die Seite erneut.</p>}
      {!hasMeeting && !loadFailed && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        {isCoach ? 'Noch kein Meeting-Link: Füge vor dem Termin einen Link hinzu, damit dein Kunde teilnehmen kann.' : 'Dein Coach hat noch keinen Meeting-Link hinterlegt. Prüfe diese Seite vor deinem Termin. Du kannst deinen Coach hier um den Link bitten.'}
      </p>}
      {hasMeeting && <div className="mt-4">
        <a href={`/api/coaching/meeting/${bookingId}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 sm:w-auto">
          Meeting öffnen ↗
        </a>
        <p className="mt-2 text-xs text-gray-500">Öffnet einen externen Dienst in einem neuen Tab. Tritt zur vereinbarten Uhrzeit bei. {meetingUrl && `Dienst: ${new URL(meetingUrl).hostname}`}</p>
      </div>}
      {isCoach && <form onSubmit={save} className="mt-5 space-y-3">
        <label htmlFor="meeting-url" className="block text-sm font-medium text-gray-800">Privater Meeting-Link</label>
        <input id="meeting-url" type="url" required maxLength={2048} value={value} disabled={saving}
          onChange={event => { setValue(event.target.value); setSaved(false) }} aria-describedby="meeting-help" autoComplete="off"
          placeholder="https://meet.google.com/..." className="w-full min-w-0 rounded-xl border border-gray-300 p-3 text-sm focus-visible:outline-2 focus-visible:outline-green-700" />
        <p id="meeting-help" className="text-xs text-gray-600">Google Meet, Zoom, Microsoft Teams oder ein anderer öffentlicher HTTPS-Meeting-Link. Nur du und dein Kunde sehen diesen Link. Prüfe auch Datum und Zugangseinstellungen beim Meeting-Dienst.</p>
        <button type="submit" disabled={saving} className="min-h-11 w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 sm:w-auto">
          {saving ? 'Wird gespeichert …' : hasMeeting ? 'Meeting-Link aktualisieren' : 'Meeting-Link speichern'}
        </button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {saved && <p role="status" className="text-sm text-green-800">Meeting-Link gespeichert. Dein Kunde findet ihn auf dieser Session-Seite.</p>}
      </form>}
      {!isCoach && !hasMeeting && !loadFailed && <div className="mt-4">
        <button onClick={requestLink} disabled={saving || requested} className="min-h-11 w-full rounded-xl border border-green-700 px-4 py-3 text-sm font-semibold text-green-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 sm:w-auto">
          {saving ? 'Wird angefragt …' : requested ? 'Coach benachrichtigt' : 'Meeting-Link beim Coach anfragen'}
        </button>
        {requested && <p role="status" className="mt-2 text-sm text-green-800">Dein Coach wurde in Ardore benachrichtigt. Prüfe diese Session-Seite später erneut.</p>}
      </div>}
      {!isCoach && error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  )
}
