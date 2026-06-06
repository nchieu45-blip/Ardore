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
import { Plus, Trash2, Pencil, Eye, EyeOff, Video } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { SubscriptionTier } from '@/types'

const schema = z.object({
  name: z.string().min(2, 'Mindestens 2 Zeichen').max(50),
  description: z.string().max(300).optional(),
  price_monthly: z.coerce.number().int('Nur ganze Zahlen').min(0, 'Mindestens 0').max(999),
  included_video_sessions: z.coerce.number().int().min(0).max(100).default(0),
  video_session_period: z.enum(['week', 'month']).default('month'),
})

type FormData = z.infer<typeof schema>

const PERIOD_LABELS = { week: 'pro Woche', month: 'pro Monat' }

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
  const {
    register, handleSubmit, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
    defaultValues: {
      included_video_sessions: 0,
      video_session_period: 'month',
      ...defaultValues,
    },
  })

  const sessions = Number(watch('included_video_sessions') ?? 0)

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

      {/* Video session benefit */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
        <div className="flex items-center gap-2 mb-0.5">
          <Video className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">1:1 Video-Sessions inkludiert</span>
          <span className="text-xs text-gray-400">(optional)</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anzahl Sessions</label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="0"
              {...register('included_video_sessions')}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            {errors.included_video_sessions && (
              <p className="text-xs text-red-500 mt-1">{errors.included_video_sessions.message}</p>
            )}
          </div>
          <div className={cn('transition-opacity duration-150', sessions === 0 && 'opacity-40')}>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zeitraum</label>
            <select
              {...register('video_session_period')}
              disabled={sessions === 0}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400 disabled:cursor-not-allowed"
            >
              <option value="month">pro Monat</option>
              <option value="week">pro Woche</option>
            </select>
          </div>
        </div>
        {sessions > 0 && (
          <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs px-3 py-1.5 rounded-lg">
            <Video className="h-3 w-3" />
            <span>
              Abonnenten erhalten <strong>{sessions}</strong> kostenlose Session{sessions !== 1 ? 's' : ''} {PERIOD_LABELS[watch('video_session_period') ?? 'month']}
            </span>
          </div>
        )}
      </div>

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
      included_video_sessions: data.included_video_sessions,
      video_session_period: data.included_video_sessions > 0 ? data.video_session_period : null,
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
        included_video_sessions: data.included_video_sessions,
        video_session_period: data.included_video_sessions > 0 ? data.video_session_period : null,
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
          <p className="text-gray-500">Monatliche Abonnements — optional mit inkludierten Video-Sessions</p>
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
                      included_video_sessions: tier.included_video_sessions ?? 0,
                      video_session_period: tier.video_session_period ?? 'month',
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
                <div className={`p-5 ${!tier.is_active ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-gray-900">{tier.name}</h3>
                        <Badge variant={tier.is_active ? 'success' : 'default'}>
                          {tier.is_active ? 'Aktiv' : 'Inaktiv'}
                        </Badge>
                      </div>
                      {tier.description && (
                        <p className="text-sm text-gray-500">{tier.description}</p>
                      )}
                      {(tier.included_video_sessions ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 mt-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-0.5 rounded-full">
                          <Video className="h-3 w-3" />
                          {tier.included_video_sessions} Session{tier.included_video_sessions !== 1 ? 's' : ''} {PERIOD_LABELS[tier.video_session_period ?? 'month']}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
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
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
