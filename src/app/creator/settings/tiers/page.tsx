'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = any
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { SubscriptionTier } from '@/types'

const schema = z.object({
  name: z.string().min(2, 'Mindestens 2 Zeichen').max(50),
  description: z.string().max(300).optional(),
  price_monthly: z.coerce.number().int('Nur ganze Zahlen').min(0, 'Mindestens 0').max(999),
})

type FormData = z.infer<typeof schema>

export default function TiersPage() {
  const router = useRouter()
  const supabase = createClient()
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [creatorId, setCreatorId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
  })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: creator } = await supabase
        .from('creator_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!creator) { router.push('/creator/onboarding'); return }

      setCreatorId(creator.id)

      const { data } = await supabase
        .from('subscription_tiers')
        .select('*')
        .eq('creator_id', creator.id)
        .order('price_monthly', { ascending: true })

      setTiers(data ?? [])
      setLoading(false)
    }
    load()
  }, [router, supabase])

  async function onSubmit(data: FormData) {
    setError('')
    const { data: tier, error: err } = await supabase.from('subscription_tiers').insert({
      creator_id: creatorId,
      name: data.name,
      description: data.description ?? null,
      price_monthly: data.price_monthly,
      features: [],
      is_active: true,
    }).select().single()

    if (err) { setError(err.message); return }

    setTiers((prev) => [...prev, tier])
    reset()
    setShowForm(false)
  }

  async function deleteTier(id: string) {
    await supabase.from('subscription_tiers').delete().eq('id', id)
    setTiers((prev) => prev.filter((t) => t.id !== id))
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-500">Lädt...</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Abo-Preisstufen</h1>
          <p className="text-gray-500">Erstelle monatliche Abonnement-Angebote für deine Kunden</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          Neue Stufe
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Neue Preisstufe</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input
                label="Name"
                placeholder="z.B. Basic, Premium, VIP"
                error={errors.name?.message}
                {...register('name')}
              />
              <Input
                label="Preis pro Monat (€)"
                type="number"
                step="1"
                min="0"
                placeholder="9"
                error={errors.price_monthly?.message}
                {...register('price_monthly')}
              />
              <Textarea
                label="Beschreibung (optional)"
                placeholder="Was ist in diesem Abo enthalten?"
                {...register('description')}
              />
              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</div>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>
                  Abbrechen
                </Button>
                <Button type="submit" className="flex-1" loading={isSubmitting}>
                  Speichern
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tiers.length === 0 && !showForm ? (
        <Card className="text-center py-12">
          <p className="text-gray-500">Noch keine Preisstufen. Erstelle deine erste Stufe!</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier) => (
            <Card key={tier.id}>
              <div className="flex items-center justify-between p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{tier.name}</h3>
                    <Badge variant={tier.is_active ? 'success' : 'default'}>
                      {tier.is_active ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  </div>
                  {tier.description && (
                    <p className="text-sm text-gray-500 mt-1">{tier.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{formatCurrency(tier.price_monthly)}/Mo.</span>
                  <button
                    onClick={() => deleteTier(tier.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
