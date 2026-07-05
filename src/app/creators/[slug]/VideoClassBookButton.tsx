'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Check, Lock } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface Props {
  classId: string
  priceCents: number
  isFull: boolean
  userIsRegistered: boolean
  isLoggedIn: boolean
  loginHref?: string
}

export default function VideoClassBookButton({
  classId,
  priceCents,
  isFull,
  userIsRegistered,
  isLoggedIn,
  loginHref = '/login',
}: Props) {
  const router = useRouter()
  const [loading,  setLoading]  = useState(false)
  const [booked,   setBooked]   = useState(userIsRegistered)
  const [error,    setError]    = useState('')

  if (booked) {
    return (
      <div className="flex items-center justify-center gap-1.5 w-full py-2 text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-xl">
        <Check className="h-4 w-4" />
        Angemeldet
      </div>
    )
  }

  if (isFull) {
    return (
      <div className="flex items-center justify-center w-full py-2 text-sm font-semibold text-gray-400 bg-gray-50 border border-gray-200 rounded-xl">
        Ausgebucht
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <a
        href={loginHref}
        className="flex items-center justify-center gap-1.5 w-full py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl transition-colors"
      >
        <Lock className="h-3.5 w-3.5" />
        Anmelden um zu buchen
      </a>
    )
  }

  async function handleBook() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/video-classes/${classId}/book`, { method: 'POST' })
      const data = await res.json() as { bookingId?: string; checkoutUrl?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Fehler beim Buchen'); return }
      if (data.checkoutUrl) {
        router.push(data.checkoutUrl)
      } else {
        setBooked(true)
      }
    } catch {
      setError('Netzwerkfehler')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button size="sm" onClick={handleBook} loading={loading} className="w-full">
        {priceCents === 0 ? 'Kostenlos anmelden' : `Anmelden · ${formatCurrency(priceCents / 100)}`}
      </Button>
      {error && <p className="text-xs text-red-500 mt-1.5 text-center">{error}</p>}
    </div>
  )
}
