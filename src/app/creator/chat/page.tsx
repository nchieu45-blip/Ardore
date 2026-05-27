import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { MessageCircle, Users } from 'lucide-react'

export default async function CreatorChatOverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!creator) redirect('/creator/onboarding')

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('id, buyer_id, created_at, tier:subscription_tiers(name)')
    .eq('creator_id', creator.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  const subs = subscriptions ?? []
  const buyerIds = subs.map((s) => s.buyer_id)

  const profiles: Record<string, { id: string; full_name: string | null; avatar_url: string | null }> = {}
  if (buyerIds.length > 0) {
    const { data: buyerProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', buyerIds)

    for (const p of buyerProfiles ?? []) {
      profiles[p.id] = p
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Abonnenten-Chat</h1>
        <p className="text-gray-500">{subs.length} aktive{subs.length !== 1 ? ' Abonnenten' : 'r Abonnent'}</p>
      </div>

      {subs.length === 0 ? (
        <Card className="text-center py-12">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Noch keine aktiven Abonnenten.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {subs.map((sub) => {
            const buyer = profiles[sub.buyer_id]
            const name = buyer?.full_name ?? 'Abonnent'
            const tierName = (sub.tier as unknown as { name: string } | null)?.name ?? null

            return (
              <Link key={sub.id} href={`/creator/chat/${sub.buyer_id}`}>
                <Card className="hover:border-green-300 hover:shadow-sm transition-all cursor-pointer">
                  <CardContent className="flex items-center gap-4 p-4">
                    <Avatar src={buyer?.avatar_url ?? null} name={name} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{name}</p>
                      {tierName && <p className="text-xs text-gray-400">{tierName}</p>}
                    </div>
                    <MessageCircle className="h-5 w-5 text-gray-300 flex-shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
