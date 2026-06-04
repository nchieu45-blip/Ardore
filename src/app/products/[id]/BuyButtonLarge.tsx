'use client'

import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'

export default function BuyButtonLarge({ productId, price }: { productId: string; price: number }) {
  const [loading, setLoading] = useState(false)

  async function handleBuy() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const { url } = await res.json()
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="lg" onClick={handleBuy} loading={loading} className="w-full gap-2 shadow-md">
      <ShoppingCart className="h-5 w-5" />
      Jetzt kaufen · {formatCurrency(price)}
    </Button>
  )
}
