'use client'

import { useState } from 'react'
import { Zap } from 'lucide-react'
import AddToCartButton from '@/components/AddToCartButton'
import type { CartItem } from '@/lib/cart'

interface Props {
  productId: string
  price: number
  title: string
  type: CartItem['type']
  thumbnailUrl?: string | null
  creatorId: string
  creatorName: string
  creatorSlug: string
  isDemo?: boolean
}

// All product types handled here are digital content.
const DIGITAL_TYPES = new Set<CartItem['type']>(['pdf', 'video', 'course', 'image'])

export default function BuyButtonLarge({
  productId, price, title, type, thumbnailUrl, creatorId, creatorName, creatorSlug, isDemo = false,
}: Props) {
  const [loading,           setLoading]           = useState(false)
  const [withdrawalConsent, setWithdrawalConsent] = useState(false)
  const [error,             setError]             = useState<string | null>(null)

  const isDigital = DIGITAL_TYPES.has(type)

  const item: CartItem = {
    id: productId, price, title, type,
    thumbnail_url: thumbnailUrl ?? null,
    creatorId, creatorName, creatorSlug,
  }

  async function handleDirectBuy() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items:             [{ productId }],
          withdrawalConsent: withdrawalConsent,
        }),
      })
      if (res.status === 401) {
        window.location.assign('/login?redirect=' + encodeURIComponent(window.location.pathname))
        return
      }
      const data: unknown = await res.json().catch(() => null)
      const result = data && typeof data === 'object'
        ? data as { url?: unknown; error?: unknown }
        : null
      if (!res.ok) {
        setError(typeof result?.error === 'string' && result.error.trim()
          ? result.error
          : 'Der Checkout konnte nicht geöffnet werden. Bitte versuche es erneut.')
        return
      }
      if (typeof result?.url !== 'string' || !result.url.trim()) {
        setError('Der Checkout konnte nicht geöffnet werden. Bitte versuche es erneut.')
        return
      }
      let checkoutUrl: URL
      try {
        checkoutUrl = new URL(result.url)
      } catch {
        setError('Der Checkout konnte nicht geöffnet werden. Bitte versuche es erneut.')
        return
      }
      if (checkoutUrl.protocol !== 'https:') {
        setError('Der Checkout konnte nicht geöffnet werden. Bitte versuche es erneut.')
        return
      }
      window.location.assign(checkoutUrl.href)
    } catch {
      setError('Der Checkout ist momentan nicht erreichbar. Bitte versuche es erneut.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <AddToCartButton item={item} size="lg" isDemo={isDemo} />
      {!isDemo && (
        <>
          {isDigital && (
            <label className="flex items-start gap-2.5 cursor-pointer group pt-1">
              <input
                type="checkbox"
                checked={withdrawalConsent}
                onChange={e => setWithdrawalConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 accent-green-600 cursor-pointer"
              />
              <span className="text-[11px] text-gray-500 leading-relaxed group-hover:text-gray-700 transition-colors">
                Ich stimme ausdrücklich zu, dass mit der Ausführung des Vertrags vor Ablauf der Widerrufsfrist begonnen wird. Mir ist bekannt, dass ich dadurch mein Widerrufsrecht verliere, sobald die Bereitstellung der digitalen Inhalte begonnen hat.
              </span>
            </label>
          )}
          <button
            onClick={handleDirectBuy}
            disabled={loading || (isDigital && !withdrawalConsent)}
            aria-busy={loading}
            aria-label={loading ? 'Checkout wird geöffnet' : 'Direkt kaufen'}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            {loading ? (
              <span className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                Direkt kaufen
              </>
            )}
          </button>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  )
}
