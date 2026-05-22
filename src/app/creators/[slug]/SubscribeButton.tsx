'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

interface SubscribeButtonProps {
  tierId: string
  creatorId: string
}

export default function SubscribeButton({ tierId, creatorId }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleSubscribe() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, creatorId }),
      })
      const { url } = await res.json()
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="sm" className="w-full" onClick={handleSubscribe} loading={loading}>
      Jetzt abonnieren
    </Button>
  )
}
