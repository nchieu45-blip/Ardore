import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ShoppingBag, Users, MessageCircle, Search } from 'lucide-react'

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
      .select('*, creator:creator_profiles(id, display_name, slug, avatar_url, category), tier:subscription_tiers(name, price_monthly)')
      .eq('buyer_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ])

  const purchases = purchasesRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mein Dashboard</h1>
          <p className="text-gray-500">Willkommen, {profile?.full_name ?? 'Nutzer'}</p>
        </div>
        <Link href="/creators">
          <Button variant="outline">
            <Search className="h-4 w-4" />
            Coaches entdecken
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: <ShoppingBag className="h-5 w-5 text-green-600" />, label: 'Käufe', value: purchases.length },
          { icon: <Users className="h-5 w-5 text-purple-600" />, label: 'Abonnements', value: subscriptions.length },
          { icon: <MessageCircle className="h-5 w-5 text-blue-600" />, label: 'Chats', value: subscriptions.length },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-gray-50 flex items-center justify-center">
                  {stat.icon}
                </div>
                <span className="text-sm text-gray-500">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Active Subscriptions */}
        <Card>
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Meine Abonnements</h2>
            <Link href="/buyer/subscriptions">
              <Button variant="ghost" size="sm">Alle</Button>
            </Link>
          </div>
          <CardContent className="p-0">
            {subscriptions.length === 0 ? (
              <div className="text-center py-10 px-6">
                <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Noch keine Abonnements</p>
                <Link href="/creators" className="mt-3 inline-block">
                  <Button size="sm" variant="outline">Coaches entdecken</Button>
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {subscriptions.map((sub: {
                  id: string
                  creator: { id: string; display_name: string; slug: string; avatar_url: string | null; category: string | null } | null
                  tier: { name: string; price_monthly: number } | null
                  current_period_end: string
                }) => (
                  <li key={sub.id} className="flex items-center gap-4 px-6 py-4">
                    <Avatar
                      src={sub.creator?.avatar_url}
                      name={sub.creator?.display_name ?? '?'}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{sub.creator?.display_name}</p>
                      <p className="text-xs text-gray-400">{sub.tier?.name} · bis {formatDate(sub.current_period_end)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-green-600">{formatCurrency(sub.tier?.price_monthly ?? 0)}</span>
                      <Link href={`/chat/${sub.creator?.id}`}>
                        <Button size="sm" variant="ghost">
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Purchases */}
        <Card>
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Letzte Käufe</h2>
            <Link href="/buyer/library">
              <Button variant="ghost" size="sm">Alle</Button>
            </Link>
          </div>
          <CardContent className="p-0">
            {purchases.length === 0 ? (
              <div className="text-center py-10 px-6">
                <ShoppingBag className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Noch keine Käufe</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {purchases.map((purchase: {
                  id: string
                  amount_paid: number
                  created_at: string
                  product: { title: string; type: string; creator: { display_name: string; slug: string } | null } | null
                }) => (
                  <li key={purchase.id} className="flex items-center justify-between px-6 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{purchase.product?.title}</p>
                      <p className="text-xs text-gray-400">{purchase.product?.creator?.display_name} · {formatDate(purchase.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                      <span className="text-sm font-medium">{formatCurrency(purchase.amount_paid)}</span>
                      <Badge variant="success">Gekauft</Badge>
                    </div>
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
