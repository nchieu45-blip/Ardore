import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { TrendingUp, Users, ShoppingBag, Plus, AlertCircle, ArrowRight, ExternalLink } from 'lucide-react'
import { RevenueChart } from '@/components/creator/RevenueChart'
import type { DayRevenue } from '@/components/creator/RevenueChart'

export const metadata: Metadata = {
  title: 'Creator Dashboard',
  description: 'Verwalte deine Produkte, Abonnements und Einnahmen auf Ardore.',
}

export default async function CreatorDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (!creator) redirect('/creator/onboarding')

  const [productsRes, subscriptionsRes, purchasesRes] = await Promise.all([
    supabase.from('products').select('*').eq('creator_id', creator.id).order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('*, tier:subscription_tiers(price_monthly)').eq('creator_id', creator.id).eq('status', 'active'),
    supabase.from('purchases').select('amount_paid, created_at').eq('products.creator_id', creator.id),
  ])

  const products = productsRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []
  const purchases = purchasesRes.data ?? []

  const monthlyRevenue = subscriptions.reduce(
    (sum: number, s: { tier: { price_monthly: number } | null }) => sum + (s.tier?.price_monthly ?? 0),
    0,
  )
  const totalRevenue = purchases.reduce(
    (sum: number, p: { amount_paid: number }) => sum + p.amount_paid,
    0,
  ) + monthlyRevenue

  // Header date label
  const today = new Date()
  const weekday = today.toLocaleDateString('de-DE', { weekday: 'long' })
  const dayMonth = today.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
  const dateLabel = `${weekday}, ${dayMonth}`

  // 7-day revenue chart
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(today.getDate() - 6)
  const chartData: DayRevenue[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo)
    d.setDate(sevenDaysAgo.getDate() + i)
    return {
      day: d.toLocaleDateString('de-DE', { weekday: 'short' }),
      date: d.toISOString().split('T')[0],
      revenue: 0,
    }
  })
  purchases.forEach((p: { amount_paid: number; created_at: string }) => {
    const pDate = (p.created_at ?? '').split('T')[0]
    const slot = chartData.find(d => d.date === pDate)
    if (slot) slot.revenue += p.amount_paid
  })

  const recentProducts = products.slice(0, 5)

  return (
    <div className="bg-gray-50/40 min-h-full">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-gray-400 mb-0.5">{dateLabel}</p>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{creator.display_name}</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href={`/creators/${creator.slug}`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink className="h-4 w-4" />
                Profil aus Kundensicht ansehen
              </Button>
            </Link>
            <Link href="/creator/products/new">
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Produkt hinzufügen
              </Button>
            </Link>
          </div>
        </div>

        {/* Stripe Connect banner — slim, low-weight */}
        {!creator.stripe_account_active && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-400 rounded-lg">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-800 flex-1">
              Stripe Connect nicht eingerichtet – richte dein Konto ein, um Auszahlungen zu erhalten.
            </p>
            <Link href="/creator/settings/payout" className="flex-shrink-0">
              <Button size="sm" variant="secondary">Einrichten</Button>
            </Link>
          </div>
        )}

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { Icon: TrendingUp,  label: 'Gesamtumsatz', value: formatCurrency(totalRevenue),                                                     sub: 'Alle Zeit' },
            { Icon: TrendingUp,  label: 'Monatlich',    value: formatCurrency(monthlyRevenue),                                                   sub: 'Aus Abos' },
            { Icon: Users,       label: 'Abonnenten',   value: subscriptions.length.toString(),                                                  sub: 'Aktiv' },
            { Icon: ShoppingBag, label: 'Produkte',     value: products.length.toString(), sub: `${products.filter((p: { is_published: boolean }) => p.is_published).length} veröffentlicht` },
          ].map(({ Icon, label, value, sub }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                <Icon className="h-4 w-4 text-gray-300 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
              <p className="text-xs text-gray-400 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* Revenue chart */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-5">Einnahmen – letzte 7 Tage</h2>
          <RevenueChart data={chartData} />
        </div>

        {/* Products + Subscribers */}
        <div className="grid lg:grid-cols-2 gap-6">

          {/* Products */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Meine Produkte</h2>
              <Link href="/creator/products" className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 transition-colors">
                Alle anzeigen <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recentProducts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-10 px-6">
                <ShoppingBag className="h-8 w-8 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Noch keine Produkte</p>
                <Link href="/creator/products/new" className="mt-3">
                  <Button size="sm">Erstes Produkt erstellen</Button>
                </Link>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-gray-50">
                {recentProducts.map((product: { id: string; title: string; price: number; is_published: boolean; created_at: string }) => (
                  <li key={product.id} className="flex items-center justify-between px-6 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(product.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <span className="text-sm font-medium text-gray-900">{formatCurrency(product.price)}</span>
                      <Badge variant={product.is_published ? 'success' : 'outline'}>
                        {product.is_published ? 'Live' : 'Entwurf'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Subscribers */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Aktive Abonnenten</h2>
              <Link href="/creator/settings/tiers" className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 transition-colors">
                Alle anzeigen <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {subscriptions.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-10 px-6">
                <Users className="h-8 w-8 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Noch keine Abonnenten</p>
                <Link href="/creator/settings/tiers" className="mt-3">
                  <Button size="sm" variant="outline">Abo-Preise einrichten</Button>
                </Link>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-gray-50">
                {subscriptions.slice(0, 5).map((sub: { id: string; tier: { price_monthly: number } | null; current_period_end: string }) => (
                  <li key={sub.id} className="flex items-center justify-between px-6 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Abonnent</p>
                      <p className="text-xs text-gray-400 mt-0.5">bis {formatDate(sub.current_period_end)}</p>
                    </div>
                    <span className="text-sm font-semibold text-green-600">
                      {formatCurrency(sub.tier?.price_monthly ?? 0)}/Mo.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
