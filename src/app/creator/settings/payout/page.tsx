'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'

export default function PayoutPage() {
  const supabase = createClient()
  const [stripeActive, setStripeActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: creator } = await supabase
        .from('creator_profiles')
        .select('stripe_account_active')
        .eq('user_id', user.id)
        .single()

      setStripeActive(creator?.stripe_account_active ?? false)
      setLoading(false)
    }
    load()
  }, [supabase])

  async function connectStripe() {
    setConnecting(true)
    try {
      const res = await fetch('/api/stripe/connect', { method: 'POST' })
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch {
      setConnecting(false)
    }
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-500">Lädt...</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Auszahlungen</h1>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Stripe Connect</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            {stripeActive ? (
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium text-gray-900">
                {stripeActive ? 'Stripe Connect aktiv' : 'Stripe Connect einrichten'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {stripeActive
                  ? 'Dein Stripe-Konto ist verbunden. Einnahmen werden automatisch auf dein Bankkonto überwiesen.'
                  : 'Verbinde dein Stripe-Konto, um Zahlungen von Kunden zu empfangen und Auszahlungen zu erhalten.'}
              </p>
            </div>
          </div>

          {!stripeActive && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-medium text-gray-900">Was du brauchst:</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Gültige IBAN / Bankkonto</li>
                <li>• Steuerliche Informationen</li>
                <li>• Personalausweis oder Reisepass</li>
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={connectStripe}
              loading={connecting}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              {stripeActive ? 'Stripe Dashboard öffnen' : 'Mit Stripe verbinden'}
            </Button>
          </div>

          <p className="text-xs text-gray-400">
            Ardore berechnet 5% Plattformgebühr auf alle Transaktionen. Stripe erhebt zusätzliche Zahlungsgebühren.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
