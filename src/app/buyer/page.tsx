import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

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
  pdf:    'bg-blue-50',
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
    .single()

  const [purchasesRes, subscriptionsRes] = await Promise.all([
    supabase
      .from('purchases')
      .select('*, product:products(title, type, creator:creator_profiles(display_name, slug))')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('subscriptions')
      .select('*, creator:creator_profiles(id, display_name, slug, avatar_url, category), tier:subscription_tiers(name, price_monthly, included_video_sessions, video_session_period)')
      .eq('buyer_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ])

  const purchases = purchasesRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []

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
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 px-4 py-14">
        <div className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full bg-green-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative max-w-7xl mx-auto flex items-center justify-between gap-6 flex-wrap">
          <div className="animate-slide-up">
            <p className="text-green-300 text-sm font-medium mb-1">Mein Bereich</p>
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              Hallo, {firstName}! 👋
            </h1>
            <p className="text-green-100/70 mt-2">Deine Käufe, Abonnements und Chats auf einen Blick.</p>
          </div>
          <div className="animate-slide-up animate-delay-200 flex gap-2">
            <Link href="/coaches">
              <Button className="bg-white text-green-800 hover:bg-green-50 shadow-lg gap-2">
                <Compass className="h-4 w-4" />
                Coaches entdecken
              </Button>
            </Link>
            <Link href="/buyer/library">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 bg-transparent">
                Meine Bibliothek
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { icon: <ShoppingBag className="h-5 w-5 text-green-600" />,  bg: 'bg-green-50',  label: 'Käufe',        value: purchases.length,      sub: 'gesamt',    href: '/buyer/library' },
            { icon: <Users        className="h-5 w-5 text-purple-600" />, bg: 'bg-purple-50', label: 'Abonnements', value: subscriptions.length,  sub: 'aktiv',     href: '/buyer/subscriptions' },
            { icon: <MessageCircle className="h-5 w-5 text-blue-600" />, bg: 'bg-blue-50',   label: 'Chats',       value: subscriptions.length,  sub: 'verfügbar', href: '#subscriptions' },
          ].map((stat, i) => (
            <Link key={stat.label} href={stat.href}>
              <Card className={`animate-slide-up cursor-pointer hover:-translate-y-0.5 transition-all duration-200 hover:shadow-md animate-delay-${(i + 1) * 100}`}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`h-10 w-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                      {stat.icon}
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-300" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 mb-0.5">{stat.value}</p>
                  <p className="text-sm text-gray-500">{stat.label} <span className="text-gray-400">· {stat.sub}</span></p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Active Subscriptions */}
          <div id="subscriptions">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Meine Abonnements</h2>
              <Link href="/buyer/subscriptions" className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors flex items-center gap-1">
                Alle <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {subscriptions.length === 0 ? (
              <Card>
                <CardContent className="text-center py-14">
                  <div className="h-14 w-14 rounded-2xl bg-purple-50 flex items-center justify-center mx-auto mb-4">
                    <Users className="h-7 w-7 text-purple-300" />
                  </div>
                  <p className="font-medium text-gray-700 mb-1">Noch keine Abonnements</p>
                  <p className="text-sm text-gray-400 mb-4">Abonniere einen Coach für exklusive Inhalte und Chat-Zugang.</p>
                  <Link href="/coaches">
                    <Button size="sm" variant="outline">
                      <Search className="h-3.5 w-3.5" />
                      Coaches entdecken
                    </Button>
                  </Link>
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
                    <Card key={sub.id} className="hover:-translate-y-0.5 transition-all duration-200 hover:shadow-md hover:border-green-200">
                      <CardContent className="flex items-start gap-4 p-4">
                        <Avatar src={sub.creator?.avatar_url} name={sub.creator?.display_name ?? '?'} size="md" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{sub.creator?.display_name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {sub.tier?.name}
                            {sub.tier?.price_monthly ? ` · ${formatCurrency(sub.tier.price_monthly)}/Mo` : ' · Kostenlos'}
                            {' · bis '}{formatDate(sub.current_period_end)}
                          </p>
                          {sessions && (
                            <span className={`inline-flex items-center gap-1 mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                              sessions.remaining > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                              <Video className="h-3 w-3" />
                              {sessions.remaining > 0
                                ? `${sessions.remaining}/${sessions.total} Sessions ${periodLabel}`
                                : `Sessions ${periodLabel} verbraucht`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {sessions && sessions.remaining > 0 && (
                            <Link href={`/creators/${sub.creator?.slug}`}>
                              <Button size="sm" variant="outline" className="gap-1.5">
                                <Video className="h-3.5 w-3.5" />
                                Buchen
                              </Button>
                            </Link>
                          )}
                          <Link href={`/chat/${sub.creator?.id}`}>
                            <Button size="sm" variant="outline" className="gap-1.5">
                              <MessageCircle className="h-3.5 w-3.5" />
                              Chat
                            </Button>
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Purchases */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Letzte Käufe</h2>
              <Link href="/buyer/library" className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors flex items-center gap-1">
                Bibliothek <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {purchases.length === 0 ? (
              <Card>
                <CardContent className="text-center py-14">
                  <div className="h-14 w-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
                    <ShoppingBag className="h-7 w-7 text-green-300" />
                  </div>
                  <p className="font-medium text-gray-700 mb-1">Noch keine Käufe</p>
                  <p className="text-sm text-gray-400 mb-4">Entdecke Premium-Inhalte von unseren Coaches.</p>
                  <Link href="/">
                    <Button size="sm" variant="outline">
                      <Search className="h-3.5 w-3.5" />
                      Produkte entdecken
                    </Button>
                  </Link>
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
                    <Card key={purchase.id} className="hover:-translate-y-0.5 transition-all duration-200 hover:shadow-md">
                      <CardContent className="flex items-center gap-4 p-4">
                        <div className={`h-10 w-10 rounded-xl ${TYPE_BG[type] ?? 'bg-gray-50'} flex items-center justify-center flex-shrink-0`}>
                          {TYPE_ICONS[type] ?? <FileText className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">{purchase.product?.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{purchase.product?.creator?.display_name} · {formatDate(purchase.created_at)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-sm font-bold text-gray-900">{formatCurrency(purchase.amount_paid)}</span>
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
