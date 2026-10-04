'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { removePurchasedFromCart } from '@/lib/cart'
import type { PurchaseStatus } from '@/lib/purchases'

const copy = {
  completed: ['Kauf bestätigt', 'Deine Produkte sind in der Bibliothek. Die gekauften Artikel wurden aus dem Warenkorb entfernt.'],
  processing: ['Kauf wird verarbeitet', 'Wir prüfen deine Zahlung und die Freischaltung. Bitte kaufe diese Produkte nicht erneut. Die Anzeige aktualisiert sich automatisch.'],
  awaiting_payment: ['Zahlung noch nicht bestätigt', 'Für diesen Checkout liegt noch kein bestätigter Kauf vor. Dein Warenkorb bleibt erhalten.'],
  payment_failed: ['Zahlung nicht abgeschlossen', 'Dieser Zahlungsversuch ist fehlgeschlagen. Es wurde kein Kauf freigeschaltet. Dein Warenkorb bleibt erhalten.'],
  canceled: ['Checkout abgelaufen', 'Es wurde kein Kauf freigeschaltet. Dein Warenkorb bleibt erhalten.'],
  refund_pending: ['Rückerstattung wird verarbeitet', 'Dieser Kauf konnte nicht freigeschaltet werden. Die Zahlung wird abgeglichen und die Rückerstattung verarbeitet.'],
  refunded: ['Kauf erstattet', 'Für diesen Kauf besteht keine aktive Freischaltung.'],
  unavailable: ['Keine aktive Freischaltung', 'Dieser Kauf bietet momentan keinen Zugriff. Bitte prüfe deine Bibliothek oder kontaktiere den Support.'],
}

export default function PurchaseConfirmation({ sessionId, returned }: { sessionId?: string; returned?: string }) {
  const [status, setStatus] = useState<PurchaseStatus | null>(null)
  const [error, setError] = useState(false)
  const [loginRequired, setLoginRequired] = useState(false)
  const [pollEnded, setPollEnded] = useState(false)
  const [revision, setRevision] = useState(0)
  const router = useRouter()

  useEffect(() => {
    if (!sessionId) return
    let active = true, attempts = 0, completed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    async function check() {
      attempts += 1
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10_000)
      try {
        const response = await fetch(`/api/stripe/purchase-status?session_id=${encodeURIComponent(sessionId!)}`, {
          cache: 'no-store', signal: controller.signal,
        })
        if (!active) return
        if (response.status === 401) { setLoginRequired(true); return }
        if (!response.ok) throw new Error('Status unavailable')
        const result: PurchaseStatus = await response.json()
        if (!Object.hasOwn(copy, result.state) || !Array.isArray(result.productIds)) throw new Error('Invalid response')
        setStatus(result); setError(false); setLoginRequired(false)
        if (result.state === 'completed') {
          if (!completed) { completed = true; removePurchasedFromCart(result.productIds); router.refresh() }
          return
        }
        if (!['processing', 'awaiting_payment', 'payment_failed', 'refund_pending'].includes(result.state)) return
      } catch { if (active) setError(true) }
      finally { clearTimeout(timeout) }
      if (active && attempts < 40) timer = setTimeout(check, 3000)
      else if (active) setPollEnded(true)
    }
    void check()
    return () => { active = false; clearTimeout(timer); controller?.abort() }
  }, [sessionId, revision, router])

  if (!sessionId && !returned) return null
  const [title, description] = status ? copy[status.state]
    : returned === 'cancel' && !sessionId
      ? ['Checkout verlassen', 'Nur eine bestätigte Zahlung schaltet einen Kauf frei. Dein Warenkorb bleibt erhalten.']
      : sessionId ? ['Kaufstatus wird geprüft', 'Wir prüfen die Zahlung und Freischaltung sicher auf dem Server.']
        : ['Kaufstatus prüfen', 'Die Rückkehr vom Checkout bestätigt noch keinen Kauf. Bereits freigeschaltete Produkte findest du unten.']
  return (
    <section role="status" aria-live="polite" className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 text-green-950 break-words">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm">{description}</p>
      {status?.testMode && <p className="mt-2 text-sm font-medium">Testkauf: Es wurde kein echter Kauf getätigt. Downloads bleiben im Testbetrieb gesperrt.</p>}
      {error && <p className="mt-2 text-sm">Der Status ist momentan nicht erreichbar. Das bedeutet nicht, dass die Zahlung fehlgeschlagen ist. Bitte nicht erneut kaufen.</p>}
      {loginRequired && <Link className="mt-3 inline-block underline" href={`/login?redirect=${encodeURIComponent(`/buyer/library?session_id=${sessionId}`)}`}>Anmelden und Kauf prüfen</Link>}
      {(error || pollEnded || (!sessionId && returned !== 'cancel')) && (
        <button type="button" className="mt-3 rounded-lg border border-green-700 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-green-700"
          onClick={() => { setPollEnded(false); setRevision(value => value + 1); router.refresh() }}>Status erneut prüfen</button>
      )}
      <Link className="ml-0 mt-3 block text-sm underline sm:ml-4 sm:inline-block" href="/marketplace">Weitere Produkte entdecken</Link>
    </section>
  )
}
