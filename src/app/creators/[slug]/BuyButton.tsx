'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

interface BuyButtonProps {
  productId: string
  price: number
}

export default function BuyButton({ productId }: BuyButtonProps) {
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
    <Button size="sm" onClick={handleBuy} loading={loading}>
      Kaufen
    </Button>
  )
}
