'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import RescheduleModal from '@/components/RescheduleModal'

interface Props {
  bookingId: string
  scheduledAt: string
  creatorId: string
  coachName: string
  policyHours: number
  role: 'buyer' | 'creator'
}

export default function BookingActions({ bookingId, scheduledAt, creatorId, coachName, policyHours, role }: Props) {
  const [showReschedule,  setShowReschedule]  = useState(false)
  const [showCancel,      setShowCancel]      = useState(false)
  const [cancelling,      setCancelling]      = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const router = useRouter()

  const msUntil   = new Date(scheduledAt).getTime() - Date.now()
  const withinPolicy = role === 'buyer' && msUntil < policyHours * 3_600_000

  async function handleCancel() {
    setCancelling(true)
    setError(null)
    try {
      const res = await fetch('/api/coaching/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Fehler beim Stornieren'); return }
      setShowCancel(false)
      router.refresh()
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
        <button
          onClick={() => { setError(null); setShowReschedule(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Verschieben
        </button>
        <button
          onClick={() => { setError(null); setShowCancel(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Stornieren
        </button>
      </div>

      {/* Cancel confirmation modal */}
      {showCancel && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowCancel(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-4.5 w-4.5 text-red-500" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Session stornieren?</h3>
                <p className="text-sm text-gray-500">
                  Diese Aktion kann nicht rückgängig gemacht werden. {role === 'buyer' ? 'Der Coach' : 'Der Kunde'} wird per E-Mail benachrichtigt.
                </p>
              </div>
            </div>

            {withinPolicy && (
              <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Stornierungen sind laut Stornierungsrichtlinie des Coaches bis {policyHours} Stunden vor dem Termin kostenlos möglich.
                  Du bist bereits innerhalb dieser Frist.
                </span>
              </div>
            )}

            {error && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">{error}</p>
            )}

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowCancel(false)} disabled={cancelling} className="flex-1">
                Abbrechen
              </Button>
              <Button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 bg-red-600 hover:bg-red-700 focus:ring-red-500"
              >
                {cancelling ? 'Wird storniert…' : 'Ja, stornieren'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {showReschedule && (
        <RescheduleModal
          bookingId={bookingId}
          creatorId={creatorId}
          coachName={coachName}
          onClose={() => setShowReschedule(false)}
          onSuccess={() => { setShowReschedule(false); router.refresh() }}
        />
      )}
    </>
  )
}
