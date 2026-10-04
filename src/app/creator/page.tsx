import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadCoachEarnings } from '@/lib/coach-earnings-server'
import EarningsSummary from '@/components/creator/EarningsSummary'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Users, ShoppingBag, Plus, AlertCircle, ArrowRight, ExternalLink } from 'lucide-react'
import { RevenueChart } from '@/components/creator/RevenueChart'

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

  const [productsRes, subscriptionsRes, earnings] = await Promise.all([
    supabase.from('products').select('*').eq('creator_id', creator.id).order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('*, tier:subscription_tiers(price_monthly)').eq('creator_id', creator.id).eq('status', 'active'),
    loadCoachEarnings(supabase, user.id).catch(() => null),
  ])
  const products = productsRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []
  const dateLabel = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' })
  const recentProducts = products.slice(0, 5)

  return (
    <div className="bg-gray-50/40 min-h-full">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-gray-400 mb-0.5">{dateLabel}</p>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{creator.display_name}</h1>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center flex-shrink-0">
            <Link href="/creator/calendar" className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 focus-visible:ring-2 focus-visible:ring-green-600">Kalender öffnen</Link>
            {creator.is_published && <Link href={`/creators/${creator.slug}`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="w-full sm:w-auto">
                <ExternalLink className="h-4 w-4" />
                Profil aus Kundensicht ansehen
              </Button>
            </Link>}
            <Link href="/creator/products/new">
              <Button size="sm" className="w-full sm:w-auto">
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

        {earnings ? <EarningsSummary report={earnings} compact /> : <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Einnahmen konnten nicht vollständig geladen werden. Bitte lade die Seite erneut; es werden keine unvollständigen Summen angezeigt.</p>}
        <div className="grid grid-cols-2 gap-4">
          {[
            { Icon: Users, label: 'Abonnenten', value: subscriptions.length.toString(), sub: 'Aktiv – keine Umsatzprognose' },
            { Icon: ShoppingBag, label: 'Produkte', value: products.length.toString(), sub: `${products.filter((p: { is_published: boolean }) => p.is_published).length} veröffentlicht` },
          ].map(({ Icon, label, value, sub }) => <div key={label} className="rounded-xl border border-gray-100 bg-white p-5">
            <Icon className="mb-2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <p className="text-sm text-gray-600">{label}</p><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-gray-500">{sub}</p>
          </div>)}
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold">Bruttoumsatz nach Erstattungen – letzte 7 Tage</h2>
          {earnings && <RevenueChart data={earnings.days} />}
          <p className="mt-3 text-xs text-gray-500">Alle Zahlungsquellen im Ledger; Zuordnung nach Erfassungsdatum in Europe/Berlin.</p>
        </div>

        {/* Products + Subscribers */}
        <div className="grid lg:grid-cols-2 gap-6">

          {/* Products */}
          <div className="min-w-0 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
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
                  <li key={product.id} className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between px-6 py-3.5">
                    <div className="min-w-0 w-full sm:w-auto">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(product.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 sm:ml-4">
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
          <div className="min-w-0 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
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
                      Tarifpreis: {formatCurrency(sub.tier?.price_monthly ?? 0)}/Mo.
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
