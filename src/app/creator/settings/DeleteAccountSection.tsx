'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const CONFIRM_WORD = 'LÖSCHEN'

interface Props {
  isCreator:               boolean
  activeSubscribersCount:  number
  upcomingBookingsCount:   number
  activeSubscriptionsCount: number
}

export default function DeleteAccountSection({
  isCreator,
  activeSubscribersCount,
  upcomingBookingsCount,
  activeSubscriptionsCount,
}: Props) {
  const [open,    setOpen]    = useState(false)
  const [input,   setInput]   = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error,   setError]   = useState('')
  const router  = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const deletingRef = useRef(false)

  useEffect(() => {
    if (open) {
      setInput('') // eslint-disable-line react-hooks/set-state-in-effect
      setError('')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deletingRef.current) setOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  async function handleDelete() {
    if (input !== CONFIRM_WORD || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setError('')
    try {
      const res  = await fetch('/api/account/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRM_WORD }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || json.ok !== true) throw new Error(json.error ?? 'Die Kontolöschung konnte nicht bestätigt werden. Bitte prüfe den Status erneut.')

      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/konto-geloescht')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Löschen des Kontos')
      setDeleting(false)
      deletingRef.current = false
    }
  }

  const hasSeriousWarnings = activeSubscribersCount > 0 || upcomingBookingsCount > 0 || activeSubscriptionsCount > 0

  return (
    <>
      {/* Danger zone card */}
      <div className="rounded-2xl border border-red-200 bg-red-50/30 overflow-hidden">
        <div className="px-5 py-4 border-b border-red-200/60 flex items-center gap-2">
          <AlertTriangle className="h-4.5 w-4.5 text-red-500 flex-shrink-0" />
          <h2 className="font-semibold text-red-700 text-sm">Gefahrenzone</h2>
        </div>
        <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium text-gray-900">Konto dauerhaft löschen</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Löscht dein Konto dauerhaft. Bei Buchungs-, Kauf- oder Zahlungsaufzeichnungen hilft dir der Ardore-Support.
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-xl hover:bg-red-50 hover:border-red-400 transition-colors flex-shrink-0"
          >
            <Trash2 className="h-4 w-4" />
            Konto löschen
          </button>
        </div>
      </div>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={e => { if (e.target === e.currentTarget && !deletingRef.current) setOpen(false) }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white rounded-2xl shadow-2xl animate-scale-in">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </div>
                <h3 id="delete-account-title" className="font-bold text-gray-900">Konto dauerhaft löschen</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Dialog schließen"
                disabled={deleting}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* What gets deleted */}
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Folgendes wird gelöscht:</p>
                <ul className="space-y-1.5">
                  {[
                    'Dein Profil und zugehörige Kontodaten',
                    isCreator && 'Alle deine Produkte und Inhalte',
                    isCreator && 'Alle Abo-Preisstufen',
                    isCreator && 'Videocoaching-Einstellungen',
                    'Alle Nachrichten und Chats',
                    'Deine Abonnements (nach bestätigter Beendigung)',
                  ].filter(Boolean).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-red-400 flex-shrink-0 mt-0.5">✕</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-sm text-gray-600">
                Bei Buchungen, Käufen oder Zahlungsaufzeichnungen ist keine automatische Löschung möglich. Bitte kontaktiere dafür den Ardore-Support. Kann Stripe die Beendigung nicht bestätigen, bleibt dein Konto erhalten; einzelne Abos können bereits beendet sein.
              </p>

              {/* Active subscribers warning */}
              {activeSubscribersCount > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    <strong>Achtung:</strong> Du hast noch{' '}
                    <strong>{activeSubscribersCount} aktive{activeSubscribersCount === 1 ? 'n Abonnenten' : ' Abonnenten'}</strong>.
                    {' '}Ihre Abonnements werden sofort gekündigt und sie werden per E-Mail benachrichtigt.
                  </p>
                </div>
              )}

              {/* Upcoming bookings warning */}
              {upcomingBookingsCount > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    <strong>Achtung:</strong> Du hast noch{' '}
                    <strong>{upcomingBookingsCount} bevorstehende{upcomingBookingsCount === 1 ? ' Session' : ' Sessions'}</strong>.
                    {' '}Bitte kläre diese vor der Kontolöschung mit dem Ardore-Support.
                  </p>
                </div>
              )}

              {/* Buyer subscriptions warning */}
              {activeSubscriptionsCount > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    <strong>Achtung:</strong> Deine{' '}
                    <strong>{activeSubscriptionsCount} aktive{activeSubscriptionsCount === 1 ? 's Abonnement' : 'n Abonnements'}</strong>{' '}
                    {activeSubscriptionsCount === 1 ? 'wird' : 'werden'} sofort gekündigt.
                  </p>
                </div>
              )}

              {!hasSeriousWarnings && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
                  Diese Aktion ist <strong>unwiderruflich</strong>. Es gibt keine Möglichkeit, dein Konto oder deine Daten wiederherzustellen.
                </p>
              )}

              {/* Confirmation input */}
              <div>
                <label htmlFor="delete-account-confirmation" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Schreibe <span className="font-mono font-bold text-red-600">{CONFIRM_WORD}</span> zum Bestätigen:
                </label>
                <input
                  ref={inputRef}
                  id="delete-account-confirmation"
                  disabled={deleting}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  className={cn(
                    'w-full px-3.5 py-2.5 rounded-xl border text-sm font-mono focus:outline-none focus:ring-2 transition-colors',
                    input === CONFIRM_WORD
                      ? 'border-red-400 focus:ring-red-300'
                      : 'border-gray-200 focus:ring-gray-300'
                  )}
                  onKeyDown={e => { if (e.key === 'Enter' && input === CONFIRM_WORD) handleDelete() }}
                />
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                  <p role="alert" className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setOpen(false)}
                  disabled={deleting}
                >
                  Abbrechen
                </Button>
                <button
                  onClick={handleDelete}
                  disabled={input !== CONFIRM_WORD || deleting}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all',
                    input === CONFIRM_WORD && !deleting
                      ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  )}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Wird gelöscht…
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      Unwiderruflich löschen
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
