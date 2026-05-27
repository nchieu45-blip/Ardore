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
import { Plus, Trash2, Pencil, Eye, EyeOff } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { SubscriptionTier } from '@/types'

const schema = z.object({
  name: z.string().min(2, 'Mindestens 2 Zeichen').max(50),
  description: z.string().max(300).optional(),
  price_monthly: z.coerce.number().int('Nur ganze Zahlen').min(0, 'Mindestens 0').max(999),
})

type FormData = z.infer<typeof schema>

function TierForm({
  defaultValues,
  onSave,
  onCancel,
}: {
  defaultValues?: Partial<FormData>
  onSave: (data: FormData) => Promise<void>
  onCancel: () => void
}) {
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
    defaultValues,
  })

  async function onSubmit(data: FormData) {
    setError('')
    try {
      await onSave(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Speichern')
    }
  }

  return (
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
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" className="flex-1" loading={isSubmitting}>
          Speichern
        </Button>
      </div>
    </form>
  )
}

export default function TiersPage() {
  const router = useRouter()
  const supabase = createClient()
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [creatorId, setCreatorId] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  async function handleCreate(data: FormData) {
    const { data: tier, error } = await supabase.from('subscription_tiers').insert({
      creator_id: creatorId,
      name: data.name,
      description: data.description ?? null,
      price_monthly: data.price_monthly,
      features: [],
      is_active: true,
    }).select().single()

    if (error) throw new Error(error.message)
    setTiers((prev) => [...prev, tier])
    setShowCreateForm(false)
  }

  async function handleEdit(id: string, data: FormData) {
    const { data: updated, error } = await supabase
      .from('subscription_tiers')
      .update({
        name: data.name,
        description: data.description ?? null,
        price_monthly: data.price_monthly,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    setTiers((prev) => prev.map((t) => (t.id === id ? updated : t)))
    setEditingId(null)
  }

  async function toggleTier(id: string, currentlyActive: boolean) {
    const { data: updated, error } = await supabase
      .from('subscription_tiers')
      .update({ is_active: !currentlyActive })
      .eq('id', id)
      .select()
      .single()
    if (!error) setTiers((prev) => prev.map((t) => (t.id === id ? updated : t)))
  }

  async function deleteTier(id: string) {
    await supabase.from('subscription_tiers').delete().eq('id', id)
    setTiers((prev) => prev.filter((t) => t.id !== id))
    setEditingId(null)
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-500">Lädt...</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Abo-Preisstufen</h1>
          <p className="text-gray-500">Erstelle monatliche Abonnement-Angebote für deine Kunden</p>
        </div>
        <Button onClick={() => { setShowCreateForm(true); setEditingId(null) }}>
          <Plus className="h-4 w-4" />
          Neue Stufe
        </Button>
      </div>

      {showCreateForm && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Neue Preisstufe</h2>
          </CardHeader>
          <CardContent>
            <TierForm onSave={handleCreate} onCancel={() => setShowCreateForm(false)} />
          </CardContent>
        </Card>
      )}

      {tiers.length === 0 && !showCreateForm ? (
        <Card className="text-center py-12">
          <p className="text-gray-500">Noch keine Preisstufen. Erstelle deine erste Stufe!</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier) => (
            <Card key={tier.id}>
              {editingId === tier.id ? (
                <CardContent className="pt-5">
                  <h2 className="font-semibold text-gray-900 mb-4">Stufe bearbeiten</h2>
                  <TierForm
                    defaultValues={{
                      name: tier.name,
                      description: tier.description ?? '',
                      price_monthly: tier.price_monthly,
                    }}
                    onSave={(data) => handleEdit(tier.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <button
                      onClick={() => deleteTier(tier.id)}
                      className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Stufe löschen
                    </button>
                  </div>
                </CardContent>
              ) : (
                <div className={`flex items-center justify-between p-5 ${!tier.is_active ? 'opacity-60' : ''}`}>
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
                      onClick={() => { setEditingId(tier.id); setShowCreateForm(false) }}
                      className="text-gray-400 hover:text-blue-500 transition-colors"
                      title="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleTier(tier.id, tier.is_active)}
                      className={`transition-colors ${tier.is_active ? 'text-gray-400 hover:text-amber-500' : 'text-amber-500 hover:text-green-600'}`}
                      title={tier.is_active ? 'Deaktivieren' : 'Reaktivieren'}
                    >
                      {tier.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
