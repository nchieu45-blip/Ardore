import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { formatCurrency, formatDate } from '@/lib/utils'
import { MessageCircle } from 'lucide-react'

export default async function SubscriptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('*, creator:creator_profiles(id, display_name, slug, avatar_url, category), tier:subscription_tiers(name, price_monthly)')
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false })

  const subList = subscriptions ?? []

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Meine Abonnements</h1>
      <p className="text-gray-500 mb-8">{subList.filter((s: { status: string }) => s.status === 'active').length} aktive Abonnements</p>

      {subList.length === 0 ? (
        <Card className="text-center py-16">
          <p className="text-gray-500 mb-4">Du hast noch keine Abonnements.</p>
          <Link href="/creators">
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
            tier: { name: string; price_monthly: number } | null
          }) => (
            <Card key={sub.id}>
              <CardContent className="flex items-center gap-4 p-5">
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
                  <p className="text-xs text-gray-400">
                    Verlängert am {formatDate(sub.current_period_end)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
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
          ))}
        </div>
      )}
    </div>
  )
}
