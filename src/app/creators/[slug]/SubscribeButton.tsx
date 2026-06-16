'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Tag, Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface AutoDiscount {
  id: string
  type: 'percent' | 'fixed'
  value: number
  savingsCents: number
}

interface SubscribeButtonProps {
  tierId: string
  creatorId: string
  priceMonthly?: number
  autoDiscount?: AutoDiscount | null
}

interface DiscountResult {
  id: string
  code: string | null
  type: 'percent' | 'fixed'
  value: number
  savingsCents: number
}

export default function SubscribeButton({ tierId, creatorId, priceMonthly, autoDiscount }: SubscribeButtonProps) {
  const [loading,       setLoading]       = useState(false)
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [code,          setCode]          = useState('')
  const [codeDiscount,  setCodeDiscount]  = useState<DiscountResult | null>(null)
  const [codeError,     setCodeError]     = useState('')
  const [codeLoading,   setCodeLoading]   = useState(false)

  const amountCents       = priceMonthly ? Math.round(priceMonthly * 100) : 0
  const effectiveDiscount = codeDiscount ?? autoDiscount ?? null
  const finalCents        = amountCents > 0 ? Math.max(0, amountCents - (effectiveDiscount?.savingsCents ?? 0)) : 0
  const hasDiscount       = !!effectiveDiscount && amountCents > 0

  async function validateCode() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setCodeLoading(true)
    setCodeError('')
    try {
      const res = await fetch(
        `/api/discounts/validate?creatorId=${creatorId}&type=subscriptions&code=${encodeURIComponent(trimmed)}&amount=${amountCents}&tierId=${tierId}`
      )
      const d = await res.json() as {
        valid: boolean
        discount?: { id: string; code: string | null; type: 'percent' | 'fixed'; value: number }
        savingsCents?: number
        error?: string
      }
      if (d.valid && d.discount) {
        setCodeDiscount({ ...d.discount, savingsCents: d.savingsCents ?? 0 })
      } else {
        setCodeError(d.error ?? 'Ungültiger Code')
        setCodeDiscount(null)
      }
    } catch {
      setCodeError('Netzwerkfehler beim Prüfen')
    } finally {
      setCodeLoading(false)
    }
  }

  async function handleSubscribe() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, creatorId, discountId: effectiveDiscount?.id ?? null }),
      })
      const { url } = await res.json()
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* Auto-discount banner — only when no manual code override */}
      {autoDiscount && !codeDiscount && amountCents > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-violet-700 bg-violet-50 border border-violet-100 px-3 py-2 rounded-xl">
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Automatischer Rabatt:{' '}
            <strong>
              {autoDiscount.type === 'percent'
                ? `${autoDiscount.value} % Rabatt`
                : `${formatCurrency(autoDiscount.value / 100)} Rabatt`}
            </strong>{' '}
            bereits eingerechnet
          </span>
        </div>
      )}

      <Button size="sm" className="w-full" onClick={handleSubscribe} loading={loading}>
        {hasDiscount ? (
          <>
            Jetzt für{' '}
            <span className="line-through opacity-60 mx-1">{formatCurrency(priceMonthly!)}</span>
            {formatCurrency(finalCents / 100)} /Monat abonnieren
          </>
        ) : (
          'Jetzt abonnieren'
        )}
      </Button>

      {/* Code input toggle — always available so user can override auto discount with a code */}
      {!showCodeInput && !codeDiscount && amountCents > 0 && (
        <button
          onClick={() => setShowCodeInput(true)}
          className="w-full text-center text-xs text-gray-400 hover:text-green-600 transition-colors"
        >
          Gutscheincode vorhanden?
        </button>
      )}

      {showCodeInput && !codeDiscount && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setCodeError('') }}
                onKeyDown={e => e.key === 'Enter' && validateCode()}
                placeholder="Gutscheincode"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-mono tracking-wider"
              />
            </div>
            <button
              onClick={validateCode}
              disabled={!code.trim() || codeLoading}
              className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-1"
            >
              {codeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Anwenden'}
            </button>
          </div>
          {codeError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {codeError}
            </div>
          )}
        </div>
      )}

      {codeDiscount && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
              Code <strong>{codeDiscount.code}</strong> – {formatCurrency(codeDiscount.savingsCents / 100)} Rabatt
            </span>
          </div>
          <button
            onClick={() => { setCodeDiscount(null); setCode(''); setShowCodeInput(false) }}
            className="text-gray-400 hover:text-gray-600"
          >
            Entfernen
          </button>
        </div>
      )}
    </div>
  )
}
