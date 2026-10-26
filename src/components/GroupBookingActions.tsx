'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

interface Props {
  reservationId: string
  bookingId: string | null
  status: string
  canCancel: boolean
  paid: boolean
  role?: 'buyer' | 'coach'
}

export default function GroupBookingActions({ reservationId, bookingId, status, canCancel, paid, role = 'buyer' }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function perform(action: 'retry' | 'cancel') {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const endpoint = action === 'retry'
        ? `/api/video-classes/reservations/${reservationId}/retry`
        : `/api/video-classes/bookings/${bookingId}/cancel`
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const result = await response.json()
      if (!response.ok) {
        setError(typeof result.error === 'string' ? result.error : 'Die Änderung konnte nicht bestätigt werden. Bitte lade die Buchung erneut.')
        router.refresh()
        return
      }
      if (action === 'retry' && result.url) {
        const url = new URL(result.url)
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port) throw new Error('Invalid checkout URL')
        window.location.assign(url.href)
        return
      }
      router.refresh()
    } catch {
      setError('Die Änderung konnte nicht bestätigt werden. Prüfe den aktuellen Buchungsstatus, bevor du es erneut versuchst.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <div className="mt-4 space-y-3">
    {['creating', 'open', 'processing'].includes(status) && <Button variant="secondary" loading={busy} onClick={() => perform('retry')} className="w-full sm:w-auto">{status === 'open' ? 'Zahlung fortsetzen' : 'Zahlungsstatus prüfen'}</Button>}
    {['refund_pending', 'payment_review'].includes(status) && <Button variant="secondary" disabled={busy} onClick={() => router.refresh()} className="w-full sm:w-auto">Status aktualisieren</Button>}
    {bookingId && canCancel && <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Anmeldung stornieren</summary>
      <p className="mt-3 text-sm leading-relaxed text-muted">{role === 'coach'
        ? paid ? 'Die Teilnahme wird abgesagt und der bezahlte Betrag vollständig erstattet. Sage eine laufende Teilnahme nur ab, wenn die Leistung nicht erbracht wird.' : 'Die Teilnahme wird abgesagt. Informiere den Teilnehmer über die Änderung.'
        : paid ? 'Vor Terminbeginn kannst du stornieren. Der bezahlte Betrag wird vollständig erstattet. Die Bankbearbeitung kann anschließend noch dauern.' : 'Du kannst diese Anmeldung vor Terminbeginn kostenlos stornieren.'}</p>
      <Button variant="destructive" loading={busy} onClick={() => perform('cancel')} className="mt-3 w-full sm:w-auto">{paid ? 'Stornieren und Erstattung anfordern' : 'Anmeldung verbindlich stornieren'}</Button>
    </details>}
    {error && <p role="alert" className="text-sm leading-relaxed text-red-700">{error}</p>}
  </div>
}
