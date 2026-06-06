import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export const metadata: Metadata = {
  title: 'Creator Dashboard',
  description: 'Verwalte deine Produkte, Abonnements und Einnahmen auf Ardore.',
}
import { Badge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { TrendingUp, Users, ShoppingBag, Plus, ExternalLink, AlertCircle, MessageCircle, Settings2, Video } from 'lucide-react'

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
    supabase.from('purchases').select('*, product:products(price)').eq('products.creator_id', creator.id),
  ])

  const products = productsRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []
  const purchases = purchasesRes.data ?? []

  const monthlyRevenue = subscriptions.reduce((sum: number, s: { tier: { price_monthly: number } | null }) => sum + (s.tier?.price_monthly ?? 0), 0)
  const totalRevenue = purchases.reduce((sum: number, p: { amount_paid: number }) => sum + p.amount_paid, 0) + monthlyRevenue

  const recentProducts = products.slice(0, 5)

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 animate-slide-up">
        <div>
          <p className="text-xs font-semibold text-green-600 uppercase tracking-widest mb-1">Creator Dashboard</p>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Willkommen, {creator.display_name} 👋</h1>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link href={`/creators/${creator.slug}`} target="_blank">
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4" />
              Mein Profil
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

      {/* Quick-action buttons */}
      <div className="flex flex-wrap gap-3 mb-6 animate-slide-up animate-delay-100">
        <Link href="/creator/chat">
          <Button>
            <MessageCircle className="h-4 w-4" />
            Mit Abonnenten chatten
          </Button>
        </Link>
        <Link href="/creator/settings/tiers">
          <Button variant="outline">
            <Settings2 className="h-4 w-4" />
            Abos verwalten
          </Button>
        </Link>
        <Link href="/creator/settings/videocoaching">
          <Button variant="outline">
            <Video className="h-4 w-4" />
            Videocoaching einrichten
          </Button>
        </Link>
      </div>

      {/* Stripe Connect Warning */}
      {!creator.stripe_account_active && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3 animate-slide-up animate-delay-150">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Stripe Connect nicht eingerichtet</p>
            <p className="text-sm text-amber-700 mt-0.5">Richte dein Stripe-Konto ein, um Auszahlungen zu erhalten.</p>
          </div>
          <Link href="/creator/settings/payout">
            <Button size="sm" variant="secondary">Einrichten</Button>
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { icon: <TrendingUp className="h-5 w-5 text-green-600" />, bg: 'bg-green-50', label: 'Gesamtumsatz', value: formatCurrency(totalRevenue), sub: 'Alle Zeit' },
          { icon: <TrendingUp className="h-5 w-5 text-blue-600" />, bg: 'bg-blue-50', label: 'Monatlich', value: formatCurrency(monthlyRevenue), sub: 'Aus Abos' },
          { icon: <Users className="h-5 w-5 text-purple-600" />, bg: 'bg-purple-50', label: 'Abonnenten', value: subscriptions.length.toString(), sub: 'Aktiv' },
          { icon: <ShoppingBag className="h-5 w-5 text-orange-600" />, bg: 'bg-orange-50', label: 'Produkte', value: products.length.toString(), sub: `${products.filter((p: { is_published: boolean }) => p.is_published).length} veröffentlicht` },
        ].map((stat, i) => (
          <Card key={stat.label} className={`animate-slide-up animate-delay-${(i + 2) * 100}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className={`h-10 w-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  {stat.icon}
                </div>
                <span className="text-xs text-gray-400 font-medium">{stat.sub}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 mb-0.5">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Products */}
        <Card>
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Meine Produkte</h2>
            <Link href="/creator/products">
              <Button variant="ghost" size="sm">Alle anzeigen</Button>
            </Link>
          </div>
          <CardContent className="p-0">
            {recentProducts.length === 0 ? (
              <div className="text-center py-10 px-6">
                <ShoppingBag className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Noch keine Produkte</p>
                <Link href="/creator/products/new" className="mt-3 inline-block">
                  <Button size="sm">Erstes Produkt erstellen</Button>
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentProducts.map((product: { id: string; title: string; type: string; price: number; is_published: boolean; created_at: string }) => (
                  <li key={product.id} className="flex items-center justify-between px-6 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(product.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <span className="text-sm font-medium">{formatCurrency(product.price)}</span>
                      <Badge variant={product.is_published ? 'success' : 'outline'}>
                        {product.is_published ? 'Live' : 'Entwurf'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Subscribers */}
        <Card>
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Aktive Abonnenten</h2>
            <Badge variant="success">{subscriptions.length} aktiv</Badge>
          </div>
          <CardContent className="p-0">
            {subscriptions.length === 0 ? (
              <div className="text-center py-10 px-6">
                <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Noch keine Abonnenten</p>
                <Link href="/creator/settings/tiers" className="mt-3 inline-block">
                  <Button size="sm" variant="outline">Abo-Preise einrichten</Button>
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {subscriptions.slice(0, 5).map((sub: { id: string; tier: { price_monthly: number } | null; current_period_end: string }) => (
                  <li key={sub.id} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Abonnent</p>
                      <p className="text-xs text-gray-400">bis {formatDate(sub.current_period_end)}</p>
                    </div>
                    <span className="text-sm font-medium text-green-600">
                      {formatCurrency(sub.tier?.price_monthly ?? 0)}/Monat
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
