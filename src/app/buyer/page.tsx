import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { subscriptionPriceLabels } from '@/lib/subscription-price'
import { VALID_PURCHASE_STATUS } from '@/lib/purchases'
import { Card, CardContent } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'

export const metadata: Metadata = {
  title: 'Mein Bereich',
  description: 'Deine gekauften Produkte, Abonnements und Bibliothek auf Ardore.',
}
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ShoppingBag, Users, MessageCircle, Search, Compass,
  BookOpen, FileText, Video, Image as ImageIcon, ArrowRight,
} from 'lucide-react'

const TYPE_ICONS: Record<string, React.ReactNode> = {
  pdf:    <FileText  className="h-4 w-4 text-blue-500" />,
  video:  <Video     className="h-4 w-4 text-violet-500" />,
  course: <BookOpen  className="h-4 w-4 text-amber-500" />,
  image:  <ImageIcon className="h-4 w-4 text-pink-500" />,
}

const TYPE_BG: Record<string, string> = {
  pdf:    'bg-brand-soft',
  video:  'bg-violet-50',
  course: 'bg-amber-50',
  image:  'bg-pink-50',
}

export default async function BuyerDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  const [purchasesRes, subscriptionsRes] = await Promise.all([
    supabase
      .from('purchases')
      .select('*, product:products(title, type, creator:creator_profiles(display_name, slug))')
      .eq('buyer_id', user.id)
      .eq('payment_status', VALID_PURCHASE_STATUS)
      .eq('stripe_livemode', true)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('subscriptions')
      .select('*, creator:creator_profiles(id, display_name, slug, avatar_url, category), tier:subscription_tiers(name, price_monthly, included_video_sessions, video_session_period)')
      .eq('buyer_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ])

  if (purchasesRes.error || subscriptionsRes.error) throw new Error('Dein Bereich konnte nicht geladen werden')

  const purchases = purchasesRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []
  const priceLabels = await subscriptionPriceLabels(await createServiceClient(), user.id, subscriptions)

  // Compute remaining sessions for subscriptions that include video sessions
  const now = new Date()
  const sessionsMap: Record<string, { remaining: number; total: number; period: string }> = {}
  await Promise.all(
    subscriptions
      .filter((s: { tier: { included_video_sessions?: number } | null }) => (s.tier?.included_video_sessions ?? 0) > 0)
      .map(async (sub: { id: string; tier: { included_video_sessions: number; video_session_period: string | null } | null }) => {
        const tier   = sub.tier!
        const total  = tier.included_video_sessions
        const period = tier.video_session_period ?? 'month'
        let periodStart: Date
        if (period === 'week') {
          const daysToMon = (now.getDay() + 6) % 7
          periodStart = new Date(now)
          periodStart.setDate(now.getDate() - daysToMon)
          periodStart.setHours(0, 0, 0, 0)
        } else {
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        }
        const { count } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('subscription_id', sub.id)
          .neq('status', 'cancelled')
          .gte('created_at', periodStart.toISOString())
        const used = count ?? 0
        sessionsMap[sub.id] = { remaining: Math.max(0, total - used), total, period }
      })
  )

  const firstName = profile?.full_name?.split(' ')[0] ?? 'dort'

  return (
    <div>
      <section className="border-b border-border bg-surface">
        <div className="ardore-workspace flex flex-col items-start justify-between gap-6 py-8 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">Hallo, {firstName}! 👋</h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">Deine Käufe, Abonnements und Chats auf einen Blick.</p>
            <p className="mt-2 text-sm font-medium text-brand">Mein Bereich</p>
          </div>
          <div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap">
            <ButtonLink href="/coaches"><Compass className="h-4 w-4" aria-hidden="true" />Coaches entdecken</ButtonLink>
            <ButtonLink href="/buyer/library" variant="secondary">Meine Bibliothek</ButtonLink>
          </div>
        </div>
      </section>

      <div className="ardore-workspace py-6 sm:py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-3 mb-8 sm:grid-cols-3 sm:gap-4">
          {[
            { icon: <ShoppingBag className="h-5 w-5 text-green-600" />,  bg: 'bg-green-50',  label: 'Käufe',        value: purchases.length,      sub: 'gesamt',    href: '/buyer/library' },
            { icon: <Users        className="h-5 w-5 text-brand" />, bg: 'bg-brand-soft', label: 'Abonnements', value: subscriptions.length,  sub: 'aktiv',     href: '/buyer/subscriptions' },
            { icon: <MessageCircle className="h-5 w-5 text-brand" />, bg: 'bg-brand-soft',   label: 'Chats',       value: subscriptions.length,  sub: 'verfügbar', href: '/buyer/chat' },
          ].map(stat => (
            <Link key={stat.label} href={stat.href} className="min-w-0">
              <Card hover className="h-full">
                <CardContent className="flex min-w-0 items-center gap-3 p-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${stat.bg}`}>{stat.icon}</div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-foreground">{stat.label}</p>
                    <p className="text-sm text-muted">{stat.sub}</p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Subscriptions */}
          <div id="subscriptions" className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Meine Abonnements</h2>
              <Link href="/buyer/subscriptions" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:text-brand-dark">
                Alle <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {subscriptions.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8 sm:py-10">
                  <div className="h-14 w-14 rounded-2xl bg-brand-soft flex items-center justify-center mx-auto mb-4">
                    <Users className="h-7 w-7 text-brand" />
                  </div>
                  <p className="font-medium text-gray-700 mb-1">Noch keine Abonnements</p>
                  <p className="text-sm leading-relaxed text-muted mb-4">Abonniere einen Coach für exklusive Inhalte und Chat-Zugang.</p>
                  <ButtonLink href="/coaches" size="sm" variant="outline">
                      <Search className="h-3.5 w-3.5" />
                      Coaches entdecken
                    </ButtonLink>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {subscriptions.map((sub: {
                  id: string
                  creator: { id: string; display_name: string; slug: string; avatar_url: string | null; category: string | null } | null
                  tier: { name: string; price_monthly: number; included_video_sessions?: number; video_session_period?: string | null } | null
                  current_period_end: string
                }) => {
                  const sessions = sessionsMap[sub.id] ?? null
                  const periodLabel = sessions?.period === 'week' ? 'diese Woche' : 'diesen Monat'
                  return (
                    <Card key={sub.id} >
                      <CardContent className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-4 sm:flex sm:gap-4">
                        <Avatar src={sub.creator?.avatar_url} name={sub.creator?.display_name ?? '?'} size="md" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground break-words">{sub.creator?.display_name}</p>
                          <p className="text-sm leading-relaxed text-muted mt-1">
                            {sub.tier?.name}
                            {' · '}{priceLabels[sub.id]}
                            {' · bis '}{formatDate(sub.current_period_end)}
                          </p>
                          {sessions && (
                            <span className={`inline-flex items-center gap-1 mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                              sessions.remaining > 0 ? 'bg-brand-soft text-blue-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                              <Video className="h-3 w-3" />
                              {sessions.remaining > 0
                                ? `${sessions.remaining}/${sessions.total} Sessions ${periodLabel}`
                                : `Sessions ${periodLabel} verbraucht`}
                            </span>
                          )}
                        </div>
                        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
                          {sessions && sessions.remaining > 0 && (
                            <ButtonLink href={`/creators/${sub.creator?.slug}`} size="sm" variant="outline" className="gap-1.5">
                                <Video className="h-3.5 w-3.5" />
                                Buchen
                              </ButtonLink>
                          )}
                          <ButtonLink href={`/chat/${sub.creator?.id}`} size="sm" variant="outline" className="gap-1.5">
                              <MessageCircle className="h-3.5 w-3.5" />
                              Chat
                            </ButtonLink>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Purchases */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Letzte Käufe</h2>
              <Link href="/buyer/library" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:text-brand-dark">
                Bibliothek <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {purchases.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8 sm:py-10">
                  <div className="h-14 w-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
                    <ShoppingBag className="h-7 w-7 text-brand" />
                  </div>
                  <p className="font-medium text-gray-700 mb-1">Noch keine Käufe</p>
                  <p className="text-sm leading-relaxed text-muted mb-4">Entdecke Premium-Inhalte von unseren Coaches.</p>
                  <ButtonLink href="/" size="sm" variant="outline">
                      <Search className="h-3.5 w-3.5" />
                      Produkte entdecken
                    </ButtonLink>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {purchases.map((purchase: {
                  id: string
                  amount_paid: number
                  created_at: string
                  product: { title: string; type: string; creator: { display_name: string; slug: string } | null } | null
                }) => {
                  const type = purchase.product?.type ?? 'pdf'
                  return (
                    <Card key={purchase.id} >
                      <CardContent className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-4 sm:flex sm:gap-4">
                        <div className={`h-10 w-10 rounded-xl ${TYPE_BG[type] ?? 'bg-gray-50'} flex items-center justify-center flex-shrink-0`}>
                          {TYPE_ICONS[type] ?? <FileText className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground text-sm break-words">{purchase.product?.title}</p>
                          <p className="text-sm leading-relaxed text-muted mt-1">{purchase.product?.creator?.display_name} · {formatDate(purchase.created_at)}</p>
                        </div>
                        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
                          <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(purchase.amount_paid)}</span>
                          <Badge variant="success">Gekauft</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
