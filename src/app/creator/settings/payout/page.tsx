'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'

const settlementLabels = {
  awaiting_fulfillment: 'Zahlung wird zugeordnet',
  pending: 'Überweisung ausstehend',
  held: 'Überweisung zurückgestellt',
  transferring: 'Überweisung wird geprüft',
  settled: 'Auf Stripe-Guthaben überwiesen',
  reversing: 'Rücküberweisung wird geprüft',
  refund_pending: 'Erstattung in Bearbeitung',
  refunded: 'Erstattet',
  failed: 'Erneute Prüfung erforderlich',
} as const
const kindLabels = { booking: 'Coaching', products: 'Produkte', subscription: 'Abo' } as const

type ConnectStatus = { connected: boolean; payoutReady: boolean }
type Settlement = {
  id: string
  kind: keyof typeof kindLabels
  state: keyof typeof settlementLabels
  grossCents: number
  feeCents: number
  coachNetCents: number
  transferredCents: number
  refundedCents: number
  createdAt: string
}

function validSettlement(value: unknown): value is Settlement {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && typeof row.kind === 'string' && Object.hasOwn(kindLabels, row.kind)
    && typeof row.state === 'string' && Object.hasOwn(settlementLabels, row.state)
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
    && ['grossCents', 'feeCents', 'coachNetCents', 'transferredCents', 'refundedCents']
      .every(key => typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && (row[key] as number) >= 0)
}

const money = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export default function PayoutPage() {
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null)
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [settlementError, setSettlementError] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')

  const loadConnect = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/stripe/connect', { cache: 'no-store', signal })
      const data: unknown = await res.json()
      if (!res.ok || !data || typeof data !== 'object' || !('connected' in data) || !('payoutReady' in data)
        || typeof data.connected !== 'boolean' || typeof data.payoutReady !== 'boolean') throw new Error('connect_status_unavailable')
      if (signal?.aborted) return
      setConnectStatus({ connected: data.connected, payoutReady: data.payoutReady })
      setConnectError('')
    } catch {
      if (signal?.aborted) return
      setConnectStatus(null)
      setConnectError('Der aktuelle Stripe-Status konnte nicht geladen werden. Bitte versuche es erneut.')
    }
  }, [])

  const loadSettlements = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/stripe/settlements', { cache: 'no-store', signal })
      const data: unknown = await res.json()
      if (!res.ok || !data || typeof data !== 'object' || !('settlements' in data)
        || !Array.isArray(data.settlements) || !data.settlements.every(validSettlement)) throw new Error('settlements_unavailable')
      if (signal?.aborted) return
      setSettlements(data.settlements)
      setSettlementError('')
    } catch {
      if (signal?.aborted) return
      setSettlementError('Abrechnungen konnten nicht geladen werden. Bitte versuche es erneut.')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      return Promise.all([loadConnect(controller.signal), loadSettlements(controller.signal)])
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [loadConnect, loadSettlements])

  async function connectStripe() {
    setConnecting(true)
    setConnectError('')
    try {
      const res = await fetch('/api/stripe/connect', { method: 'POST' })
      const data: unknown = await res.json().catch(() => null)
      const url = data && typeof data === 'object' && 'url' in data ? data.url : null
      if (!res.ok || typeof url !== 'string' || !url.trim()) {
        setConnectError('Stripe Connect konnte nicht geöffnet werden. Bitte versuche es erneut.')
        return
      }
      const destination = new URL(url)
      if (destination.protocol !== 'https:') {
        setConnectError('Stripe Connect hat keine gültige Weiterleitung zurückgegeben. Bitte versuche es erneut.')
        return
      }
      window.location.href = destination.href
    } catch {
      setConnectError('Stripe Connect ist momentan nicht erreichbar. Bitte versuche es erneut.')
    } finally {
      setConnecting(false)
    }
  }

  async function recoverSettlements() {
    setRecovering(true)
    setRecoveryMessage('')
    setSettlementError('')
    try {
      const res = await fetch('/api/stripe/settlements', { method: 'POST' })
      const data: unknown = await res.json()
      if (!res.ok || !data || typeof data !== 'object') throw new Error('settlement_recovery_unavailable')
      const result = data as Record<string, unknown>
      if (!['checked', 'settled', 'held', 'refunded', 'failed'].every(key =>
        typeof result[key] === 'number' && Number.isSafeInteger(result[key]) && (result[key] as number) >= 0)) {
        throw new Error('settlement_recovery_unavailable')
      }
      setRecoveryMessage(Number(result.held) + Number(result.failed) > 0
        ? 'Prüfung abgeschlossen. Einige Abrechnungen bleiben offen; ihr aktueller Status ist unten sichtbar.'
        : 'Prüfung abgeschlossen. Die Abrechnungen wurden aktualisiert.')
      await Promise.all([loadConnect(), loadSettlements()])
    } catch {
      setSettlementError('Offene Abrechnungen konnten nicht geprüft werden. Bitte versuche es erneut.')
    } finally {
      setRecovering(false)
    }
  }

  const payoutReady = connectStatus?.payoutReady === true
  const pending = settlements.some(row => row.state !== 'settled' && row.state !== 'refunded')

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-500">Lädt...</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Auszahlungen</h1>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Stripe Connect</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            {payoutReady ? (
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <div>
              <p className="font-medium text-gray-900">
                {!connectStatus ? 'Stripe-Status nicht verfügbar' : payoutReady ? 'Stripe Connect bereit' : connectStatus.connected ? 'Stripe Connect prüfen' : 'Stripe Connect einrichten'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {!connectStatus ? 'Lade den aktuellen Stripe-Status erneut, um die Bereitschaft deines Kontos zu prüfen.' : payoutReady
                  ? 'Dein Stripe-Konto ist für Überweisungen und Auszahlungen bereit.'
                  : connectStatus?.connected
                    ? 'Dein Stripe-Konto ist verbunden, aber noch nicht für alle Auszahlungen bereit. Prüfe deine Angaben bei Stripe.'
                    : 'Verbinde dein Stripe-Konto, um Zahlungen von Kunden zu empfangen und Auszahlungen zu erhalten.'}
              </p>
            </div>
          </div>

          {connectStatus?.connected === false && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-medium text-gray-900">Was du brauchst:</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Gültige IBAN / Bankkonto</li>
                <li>• Steuerliche Informationen</li>
                <li>• Personalausweis oder Reisepass</li>
              </ul>
            </div>
          )}

          <Button onClick={connectStripe} loading={connecting} className="gap-2">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {connectStatus?.connected ? 'Stripe Connect-Angaben öffnen' : 'Mit Stripe verbinden'}
          </Button>
          {connectError && <p role="alert" className="text-sm text-red-600">{connectError}</p>}
          <p className="text-xs text-gray-500">
            Ardore berechnet 10% Plattformgebühr auf alle Transaktionen. Stripe erhebt zusätzliche Zahlungsgebühren.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Abrechnungen</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Eine Überweisung in Ardore schreibt deinen Anteil dem Stripe-Guthaben gut. Die anschließende Bankauszahlung erfolgt durch Stripe entsprechend deinen Stripe-Einstellungen. Der Status unten bestätigt keine Bankauszahlung.
          </p>
          {pending && <p className="text-sm text-amber-800 bg-amber-50 rounded-xl p-3">
            Es gibt offene Abrechnungen. Du kannst ihre Verarbeitung erneut prüfen lassen; der aktuelle Status wird danach aktualisiert.
          </p>}
          <Button variant="outline" onClick={recoverSettlements} loading={recovering}>
            Offene Abrechnungen prüfen
          </Button>
          {recoveryMessage && <p role="status" className="text-sm text-gray-600">{recoveryMessage}</p>}
          {settlementError && <p role="alert" className="text-sm text-red-600">{settlementError}</p>}
          {!settlementError && settlements.length === 0 && <p className="text-sm text-gray-500">Noch keine Abrechnungen vorhanden.</p>}
          {settlements.length > 0 && <div className="space-y-3">
            <p className="text-xs text-gray-500">Die letzten {settlements.length} Abrechnungen, maximal 50.</p>
            {settlements.map(row => <div key={row.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium text-gray-900">{kindLabels[row.kind]}</span>
                <span className="text-sm text-gray-600">{new Date(row.createdAt).toLocaleDateString('de-DE')}</span>
              </div>
              <p className={`text-sm font-medium ${row.state === 'settled' ? 'text-green-700' : row.state === 'refunded' ? 'text-gray-600' : 'text-amber-800'}`}>{settlementLabels[row.state]}</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Kundenzahlung', row.grossCents], ['Ardore-Plattformgebühr', row.feeCents],
                  ['Coach-Anteil vor Erstattungen', row.coachNetCents], ['Aktuell auf Stripe-Guthaben überwiesen', row.transferredCents],
                  ['An Kunden erstattet', row.refundedCents],
                ].map(([label, cents]) => <div key={label} className="flex justify-between gap-3">
                  <dt className="text-gray-600">{label}</dt>
                  <dd className="font-medium text-gray-900 whitespace-nowrap">{money(cents as number)}</dd>
                </div>)}
              </dl>
            </div>)}
          </div>}
        </CardContent>
      </Card>
    </div>
  )
}
