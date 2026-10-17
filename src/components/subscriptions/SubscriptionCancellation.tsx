'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink } from '@/components/ui/Button'

type CancellationStatus = {
  kind: 'paid' | 'free'
  state: 'available' | 'scheduled' | 'ended'
  endsAt: string | null
  accessUntil: string | null
}

function isDateOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function isCancellationStatus(value: unknown): value is CancellationStatus {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  if ((result.kind !== 'paid' && result.kind !== 'free')
    || !['available', 'scheduled', 'ended'].includes(String(result.state))
    || !isDateOrNull(result.endsAt) || !isDateOrNull(result.accessUntil)) return false
  if (result.kind === 'paid' && result.state !== 'ended' && result.endsAt === null) return false
  return result.kind !== 'free' || result.state !== 'scheduled'
}

function formatCancellationDate(value: string) {
  return `${new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(new Date(value))} Uhr (Berlin)`
}

export function SubscriptionCancellation({ subscriptionId, creatorName, initiallyEnded = false }: {
  subscriptionId: string
  creatorName: string
  initiallyEnded?: boolean
}) {
  const router = useRouter()
  const headingId = useId()
  const descriptionId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const restoreFocusRef = useRef(false)
  const [status, setStatus] = useState<CancellationStatus | null>(null)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [pending, setPending] = useState<'read' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)

  useEffect(() => () => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => {
    if (pending) return
    if (error) errorRef.current?.focus()
    else if (status && (confirmationOpen || status.state !== 'available')) headingRef.current?.focus()
    else if (restoreFocusRef.current) {
      triggerRef.current?.focus()
      restoreFocusRef.current = false
    }
  }, [confirmationOpen, error, pending, status])

  async function requestStatus(method: 'GET' | 'POST') {
    if (busyRef.current) return
    busyRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    let responseStatus: number | null = null
    setPending(method === 'GET' ? 'read' : 'cancel')
    setError(null)
    setAuthRequired(false)

    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? '{}' : undefined,
      })
      if (controllerRef.current !== controller) return
      responseStatus = response.status
      if (!response.ok) {
        setAuthRequired(response.status === 401)
        throw new Error('Cancellation request could not be verified')
      }
      const result: unknown = await response.json()
      if (!isCancellationStatus(result) || (method === 'POST' && result.state === 'available')) {
        throw new Error('Unconfirmed cancellation response')
      }
      if (controllerRef.current !== controller) return
      setStatus(result)
      setConfirmationOpen(result.state === 'available')
      if (method === 'POST' || result.state === 'ended') router.refresh()
    } catch {
      if (controllerRef.current !== controller) return
      setStatus(null)
      setConfirmationOpen(false)
      setError(responseStatus === 409
        ? 'Dieses Abo kann derzeit nicht automatisch gekündigt werden. Bitte kontaktiere den Ardore-Support, damit deine Kündigung geprüft werden kann.'
        : responseStatus === 401
          ? 'Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an und prüfe den Kündigungsstatus.'
          : method === 'POST'
            ? 'Die Kündigung konnte nicht bestätigt werden. Sie kann bereits vorgemerkt sein. Prüfe zuerst den Kündigungsstatus, bevor du erneut kündigst.'
            : 'Der Kündigungsstatus konnte nicht geladen werden. Bitte prüfe ihn erneut. Aus dieser fehlgeschlagenen Prüfung lässt sich kein Kündigungsstatus ableiten.')
    } finally {
      window.clearTimeout(timeout)
      busyRef.current = false
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setPending(null)
      }
    }
  }

  function closeConfirmation() {
    if (busyRef.current) return
    restoreFocusRef.current = true
    setConfirmationOpen(false)
  }

  const triggerLabel = status || error || initiallyEnded ? 'Kündigung prüfen' : 'Abo kündigen'

  return (
    <div className="mt-4 border-t border-border pt-3">
      <Button ref={triggerRef} type="button" variant="ghost" size="sm"
        loading={pending === 'read'} disabled={pending !== null}
        aria-label={`${triggerLabel} – Abo bei ${creatorName}`}
        onClick={() => void requestStatus('GET')}>
        {triggerLabel}
      </Button>

      {pending === 'read' && <p className="mt-2 text-sm text-muted" role="status">Kündigungsstatus wird geprüft …</p>}

      {error && (
        <div className="mt-3 space-y-2">
          <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-[var(--danger)]">{error}</p>
          {authRequired && <ButtonLink href="/login" variant="outline" size="sm">Erneut anmelden</ButtonLink>}
        </div>
      )}

      {status && confirmationOpen && (
        <section className="mt-3 space-y-3" aria-labelledby={headingId} aria-describedby={descriptionId} aria-busy={pending === 'cancel' || undefined}>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-foreground">
            {status.kind === 'free' ? 'Kostenloses Abo beenden?' : 'Abo zum Laufzeitende kündigen?'}
          </h2>
          <div id={descriptionId} className="max-w-prose space-y-2 text-sm text-muted">
            {status.kind === 'free' ? (
              <p>Dieses kostenlose Abo endet sofort. Der Zugriff über dieses Abo wird beendet. Es gibt keinen bezahlten Zeitraum.</p>
            ) : (
              <>
                <p>Das Abo endet am {formatCancellationDate(status.endsAt!)} und verlängert sich danach nicht automatisch.</p>
                {status.accessUntil && <p>Dein bereits freigeschalteter Zugriff bleibt bis {formatCancellationDate(status.accessUntil)} bestehen.</p>}
                <p>Es erfolgt keine automatische Erstattung. Eventuell offene Rechnungen werden durch die Kündigung nicht aufgehoben.</p>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" size="sm" loading={pending === 'cancel'} disabled={pending !== null}
              onClick={() => void requestStatus('POST')}>
              {status.kind === 'free' ? 'Kostenloses Abo beenden' : 'Zum Laufzeitende kündigen'}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending !== null} onClick={closeConfirmation}>Zurück</Button>
          </div>
        </section>
      )}

      {status && status.state !== 'available' && (
        <section className="mt-3 space-y-2 text-sm" aria-labelledby={headingId} aria-live="polite">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-foreground">
            {status.state === 'scheduled' ? 'Kündigung vorgemerkt' : 'Abo beendet'}
          </h2>
          {status.state === 'scheduled' ? (
            <p className="text-muted">Enddatum: {formatCancellationDate(status.endsAt!)}. Es ist keine weitere automatische Verlängerung vorgesehen.</p>
          ) : (
            <p className="text-muted">Dieses Abo ist beendet.</p>
          )}
          {status.accessUntil && <p className="text-muted">Dein bereits freigeschalteter Zugriff bleibt bis {formatCancellationDate(status.accessUntil)} bestehen.</p>}
        </section>
      )}
    </div>
  )
}
