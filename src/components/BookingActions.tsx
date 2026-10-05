'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import RescheduleModal from '@/components/RescheduleModal'

export type BookingRefundState = 'not_requested' | 'pending' | 'succeeded' | 'failed'
export interface BookingRefund {
  booking_id: string
  state: BookingRefundState
  amount_cents: number | null
}

export function BookingRefundStatus({ refund }: { refund: BookingRefund | null }) {
  if (!refund || refund.state === 'not_requested') return null
  if (refund.state === 'succeeded') {
    return <p role="status" className="mt-3 text-sm text-green-700">Die Erstattung wurde von Stripe bestätigt. Die Gutschrift erfolgt über die ursprüngliche Zahlungsmethode.</p>
  }
  if (refund.state === 'failed') {
    return <p role="alert" className="mt-3 text-sm text-red-700">Die Buchung ist abgesagt. Die vollständige Erstattung konnte noch nicht abgeschlossen werden. Bitte versuche es erneut oder kontaktiere den Ardore-Support.</p>
  }
  return <p role="status" className="mt-3 text-sm text-amber-800">Die Buchung ist abgesagt. Die vollständige Erstattung wird bearbeitet und ist noch nicht bestätigt.</p>
}

interface Props {
  bookingId: string
  scheduledAt: string
  creatorId: string
  coachName: string
  policyHours: number | null
  role: 'buyer' | 'creator'
  paid?: boolean
  canReschedule?: boolean
  refund?: BookingRefund | null
  refundRetry?: boolean
}

export default function BookingActions({
  bookingId, scheduledAt, creatorId, coachName, policyHours, role,
  paid = false, canReschedule = true, refund = null, refundRetry = false,
}: Props) {
  const [showReschedule, setShowReschedule] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescheduleConfirmation, setRescheduleConfirmation] = useState<string | null>(null)
  const cancelDialogRef = useRef<HTMLDivElement>(null)
  const cancelTriggerRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  const msUntil = useMemo(() => new Date(scheduledAt).getTime() - Date.now(), [scheduledAt]) // eslint-disable-line react-hooks/purity
  const missingPolicy = policyHours === null
  const withinPolicy = policyHours !== null && msUntil < policyHours * 3_600_000
  const customerCancelBlocked = !refundRetry && role === 'buyer' && (missingPolicy || withinPolicy)
  const rescheduleBlocked = missingPolicy || withinPolicy || msUntil <= 0
  const retryLabel = refund?.state === 'pending' ? 'Erstattung prüfen' : 'Erstattung erneut versuchen'

  useEffect(() => {
    if (!showCancel) return
    const dialog = cancelDialogRef.current
    const trigger = cancelTriggerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog?.querySelector<HTMLButtonElement>('button')?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !cancelling) {
        event.preventDefault()
        setShowCancel(false)
      }
      if (event.key !== 'Tab' || !dialog) return
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      trigger?.focus()
    }
  }, [showCancel, cancelling])

  async function handleCancel() {
    setCancelling(true)
    setError(null)
    try {
      const res = await fetch('/api/coaching/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      })
      const data = await res.json().catch(() => null) as { error?: string; refundStatus?: BookingRefundState } | null
      if (!res.ok) {
        setError(data?.error ?? 'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.')
        // A cancelled appointment and a failed refund are separate states. Reload
        // the trusted refund status without claiming that money was returned.
        if (data?.refundStatus === 'failed' || data?.refundStatus === 'pending') {
          setShowCancel(false)
          router.refresh()
        }
        return
      }
      setShowCancel(false)
      router.refresh()
    } catch {
      setError('Die Anfrage konnte nicht abgeschlossen werden. Bitte prüfe deine Verbindung und versuche es erneut.')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
        {!refundRetry && canReschedule && (
          <button
            onClick={() => { setError(null); setRescheduleConfirmation(null); setShowReschedule(true) }}
            disabled={rescheduleBlocked}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Verschieben
          </button>
        )}
        <button
          ref={cancelTriggerRef}
          onClick={() => { setError(null); setShowCancel(true) }}
          disabled={customerCancelBlocked || cancelling}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {refundRetry ? retryLabel : 'Stornieren'}
        </button>
      </div>
      {!refundRetry && missingPolicy && (
        <p className="mt-2 text-xs text-amber-800">Die bei Buchung vereinbarte Stornierungsfrist ist nicht verfügbar. Bitte kontaktiere den Ardore-Support für eine Stornierung oder Verschiebung.{role === 'creator' ? ' Eine Coach-Absage bleibt möglich.' : ''}</p>
      )}
      {!refundRetry && !missingPolicy && (
        <p className="mt-2 text-xs text-gray-500">
          Vereinbarte Frist: {policyHours} Stunden vor dem Termin.
          {customerCancelBlocked ? ' Die Frist für eine kostenlose Stornierung ist abgelaufen; eine automatische Erstattung ist nicht möglich.' : ''}
        </p>
      )}
      {error && !showCancel && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {rescheduleConfirmation && <p role="status" aria-live="polite" className="mt-3 text-sm text-green-700">{rescheduleConfirmation}</p>}

      {showCancel && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget && !cancelling) setShowCancel(false) }}>
          <div ref={cancelDialogRef} role="dialog" aria-modal="true" aria-labelledby={`cancel-title-${bookingId}`} aria-describedby={`cancel-description-${bookingId}`} className="surface-dialog w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-4.5 w-4.5 text-red-500" aria-hidden="true" />
              </div>
              <div>
                <h3 id={`cancel-title-${bookingId}`} className="font-semibold text-gray-900 mb-1">{refundRetry ? retryLabel : 'Session stornieren?'}</h3>
                <p id={`cancel-description-${bookingId}`} className="text-sm text-gray-500">
                  {refundRetry
                    ? 'Die Buchung ist bereits abgesagt. Wir prüfen beziehungsweise wiederholen die bestehende Erstattungsanfrage. Du musst die Session nicht noch einmal absagen.'
                    : `Diese Aktion kann nicht rückgängig gemacht werden. ${role === 'buyer' ? 'Der Coach' : 'Der Kunde'} wird per E-Mail benachrichtigt.`}
                </p>
              </div>
            </div>
            {!refundRetry && role === 'creator' && (
              <p className="mb-4 text-sm text-gray-700">Storniere nur, wenn die gebuchte Leistung noch nicht vollständig erbracht wurde. Abgeschlossene Sessions sind von dieser Stornierung ausgeschlossen.</p>
            )}
            {!refundRetry && paid && (
              <p className="mb-4 text-sm text-gray-700">Der tatsächlich bezahlte Betrag wird vollständig über die ursprüngliche Zahlungsmethode erstattet. Die Erstattung ist erst abgeschlossen, sobald Stripe sie bestätigt hat.</p>
            )}
            {error && <p role="alert" className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">{error}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowCancel(false)} disabled={cancelling} className="flex-1">Abbrechen</Button>
              <Button onClick={handleCancel} disabled={cancelling || customerCancelBlocked} aria-busy={cancelling} className="flex-1 bg-red-600 hover:bg-red-700 focus:ring-red-500">
                {cancelling ? 'Wird bearbeitet…' : refundRetry ? retryLabel : 'Ja, stornieren'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showReschedule && (
        <RescheduleModal
          bookingId={bookingId}
          creatorId={creatorId}
          coachName={coachName}
          onClose={() => setShowReschedule(false)}
          onSuccess={() => { setRescheduleConfirmation('Dein Termin wurde erfolgreich verschoben.'); setShowReschedule(false); router.refresh() }}
        />
      )}
    </>
  )
}
