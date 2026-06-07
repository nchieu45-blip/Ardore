import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { formatCurrency, formatDate } from '@/lib/utils'
import { MessageCircle, Video } from 'lucide-react'

export default async function SubscriptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('*, creator:creator_profiles(id, display_name, slug, avatar_url, category), tier:subscription_tiers(name, price_monthly, included_video_sessions, video_session_period)')
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false })

  const subList = subscriptions ?? []

  // Compute remaining sessions for active subs that include video sessions
  const now = new Date()
  const sessionsMap: Record<string, { remaining: number; total: number; period: string }> = {}

  await Promise.all(
    subList
      .filter((s: { status: string; tier: { included_video_sessions?: number } | null }) =>
        s.status === 'active' && (s.tier?.included_video_sessions ?? 0) > 0
      )
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Meine Abonnements</h1>
      <p className="text-gray-500 mb-8">{subList.filter((s: { status: string }) => s.status === 'active').length} aktive Abonnements</p>

      {subList.length === 0 ? (
        <Card className="text-center py-16">
          <p className="text-gray-500 mb-4">Du hast noch keine Abonnements.</p>
          <Link href="/coaches">
            <Button>Coaches entdecken</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {subList.map((sub: {
            id: string
            status: string
            current_period_end: string
            creator: { id: string; display_name: string; slug: string; avatar_url: string | null; category: string | null } | null
            tier: { name: string; price_monthly: number; included_video_sessions?: number; video_session_period?: string | null } | null
          }) => {
            const sessions = sessionsMap[sub.id] ?? null
            const periodLabel = sessions?.period === 'week' ? 'diese Woche' : 'diesen Monat'

            return (
              <Card key={sub.id}>
                <CardContent className="flex items-start gap-4 p-5">
                  <Avatar
                    src={sub.creator?.avatar_url}
                    name={sub.creator?.display_name ?? '?'}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <Link href={`/creators/${sub.creator?.slug}`} className="font-semibold text-gray-900 hover:text-green-600">
                      {sub.creator?.display_name}
                    </Link>
                    <p className="text-sm text-gray-500">{sub.tier?.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Verlängert am {formatDate(sub.current_period_end)}
                    </p>
                    {sessions && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          sessions.remaining > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          <Video className="h-3 w-3" />
                          {sessions.remaining > 0
                            ? `Noch ${sessions.remaining} von ${sessions.total} Session${sessions.total !== 1 ? 's' : ''} ${periodLabel}`
                            : `${sessions.total} Session${sessions.total !== 1 ? 's' : ''} ${periodLabel} (verbraucht)`}
                        </span>
                        {sessions.remaining > 0 && (
                          <Link
                            href={`/creators/${sub.creator?.slug}#booking`}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                          >
                            Jetzt buchen →
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(sub.tier?.price_monthly ?? 0)}/Mo.</p>
                      <Badge variant={sub.status === 'active' ? 'success' : sub.status === 'past_due' ? 'warning' : 'default'}>
                        {sub.status === 'active' ? 'Aktiv' : sub.status === 'past_due' ? 'Zahlung ausstehend' : 'Gekündigt'}
                      </Badge>
                    </div>
                    {sub.status === 'active' && (
                      <Link href={`/chat/${sub.creator?.id}`}>
                        <Button variant="outline" size="sm">
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
