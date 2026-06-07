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
}

export default function BuyButtonLarge({
  productId, price, title, type, thumbnailUrl, creatorId, creatorName, creatorSlug,
}: Props) {
  const [loading, setLoading] = useState(false)

  const item: CartItem = {
    id: productId, price, title, type,
    thumbnail_url: thumbnailUrl ?? null,
    creatorId, creatorName, creatorSlug,
  }

  async function handleDirectBuy() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ productId }] }),
      })
      const { url } = await res.json()
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <AddToCartButton item={item} size="lg" />
      <button
        onClick={handleDirectBuy}
        disabled={loading}
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
    </div>
  )
}
