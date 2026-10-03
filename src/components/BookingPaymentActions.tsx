'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export function BookingPaymentReconciliationStatus({ state }: { state: string }) {
  if (state === 'succeeded') return <p role="status" className="mt-3 text-sm text-green-700">Für diese nicht bestätigte Session hat Stripe die Erstattung bestätigt. Die Gutschrift erfolgt über die ursprüngliche Zahlungsmethode.</p>
  if (state === 'failed') return <p role="alert" className="mt-3 text-sm text-red-700">Die Zahlung konnte keiner bestätigten Session zugeordnet werden. Die vollständige Erstattung konnte noch nicht abgeschlossen werden. Bitte kontaktiere den Ardore-Support und starte keine weitere Zahlung.</p>
  if (state === 'pending') return <p role="status" className="mt-3 text-sm text-amber-800">Die Zahlung konnte keiner bestätigten Session zugeordnet werden. Die vollständige Erstattung wird bearbeitet und ist noch nicht bestätigt. Bitte starte keine weitere Zahlung.</p>
  return null
}

export default function BookingPaymentActions({ bookingId, status }: { bookingId: string; status: string }) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function retry() {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch('/api/coaching/retry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }),
      })
      const data = await response.json().catch(() => null) as {
        checkoutUrl?: string | null; error?: string; paymentPending?: boolean; refundStatus?: string; confirmed?: boolean
      } | null
      if (!response.ok) {
        setError(data?.error ?? 'Die Zahlung konnte nicht gestartet werden. Bitte versuche es erneut.')
        router.refresh()
        return
      }
      if (data?.checkoutUrl) {
        window.location.assign(data.checkoutUrl)
        return
      }
      setMessage(data?.refundStatus
        ? 'Die Buchung kann nicht bestätigt werden. Der Erstattungsstatus wird geprüft; bitte starte keine weitere Zahlung.'
        : data?.confirmed ? 'Die Zahlung wurde bestätigt. Die Buchungsübersicht wird aktualisiert.'
          : 'Die Zahlung wird noch geprüft. Bitte starte keine weitere Zahlung.')
      router.refresh()
    } catch {
      setError('Die Anfrage konnte nicht abgeschlossen werden. Bitte prüfe deine Verbindung und versuche es erneut.')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button type="button" onClick={retry} disabled={loading} aria-busy={loading}
        className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2">
        {loading ? 'Zahlung wird geprüft…' : status === 'pending_payment' ? 'Zahlung fortsetzen' : 'Zahlung erneut versuchen'}
      </button>
      {message && <p role="status" className="mt-2 text-sm text-amber-800">{message}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
