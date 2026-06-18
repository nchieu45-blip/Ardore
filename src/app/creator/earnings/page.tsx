import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils'
import { TrendingUp, Users, ShoppingBag } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Einnahmen' }

export default async function EarningsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!creator) redirect('/creator/onboarding')

  const [subscriptionsRes, purchasesRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('*, tier:subscription_tiers(price_monthly)')
      .eq('creator_id', creator.id)
      .eq('status', 'active'),
    supabase
      .from('purchases')
      .select('amount_paid')
      .eq('products.creator_id', creator.id),
  ])

  const subscriptions = subscriptionsRes.data ?? []
  const purchases = purchasesRes.data ?? []

  const monthlyRevenue = subscriptions.reduce(
    (sum: number, s: { tier: { price_monthly: number } | null }) =>
      sum + (s.tier?.price_monthly ?? 0),
    0,
  )
  const totalRevenue = purchases.reduce(
    (sum: number, p: { amount_paid: number }) => sum + p.amount_paid,
    0,
  ) + monthlyRevenue

  const stats = [
    {
      label: 'Gesamtumsatz',
      value: formatCurrency(totalRevenue),
      sub: 'Alle Zeit',
      icon: TrendingUp,
      bg: 'bg-green-50',
      color: 'text-green-600',
    },
    {
      label: 'Monatlich (Abos)',
      value: formatCurrency(monthlyRevenue),
      sub: 'Aktive Abos',
      icon: TrendingUp,
      bg: 'bg-blue-50',
      color: 'text-blue-600',
    },
    {
      label: 'Abonnenten',
      value: subscriptions.length.toString(),
      sub: 'Aktiv',
      icon: Users,
      bg: 'bg-purple-50',
      color: 'text-purple-600',
    },
    {
      label: 'Einzelkäufe',
      value: purchases.length.toString(),
      sub: 'Gesamt',
      icon: ShoppingBag,
      bg: 'bg-orange-50',
      color: 'text-orange-600',
    },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Einnahmen</h1>
      <p className="text-sm text-gray-500 mb-8">Übersicht deiner Einnahmen auf Ardore</p>

      <div className="grid grid-cols-2 gap-4 mb-10">
        {stats.map(stat => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className={`h-10 w-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <span className="text-xs text-gray-400 font-medium">{stat.sub}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 mb-0.5">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Detaillierter Einnahmen-Report mit Zeitverlauf und Auszahlungshistorie folgt in Kürze.
      </p>
    </div>
  )
}
