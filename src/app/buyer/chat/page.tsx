import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageCircle, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'

export const metadata = {
  title: 'Nachrichten',
  description: 'Deine Unterhaltungen mit Coaches auf Ardore.',
}

function formatMessageTime(value: string): string {
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()

  return new Intl.DateTimeFormat('de-DE', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' }
  ).format(date)
}

export default async function BuyerChatInboxPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/buyer/chat')

  const { data: conversations, error } = await supabase
    .from('chat_conversations')
    .select('id, creator_id, created_at, updated_at')
    .eq('buyer_id', user.id)
    .eq('kind', 'direct')
    .order('updated_at', { ascending: false })

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Nachrichten</h1>
        <Card className="mt-8">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            Deine Nachrichten konnten gerade nicht geladen werden. Bitte versuche es später erneut.
          </CardContent>
        </Card>
      </div>
    )
  }

  const conversationList = conversations ?? []
  const creatorIds = [...new Set(conversationList.map((conversation) => conversation.creator_id))]

  const [creatorsResult, subscriptionsResult, latestMessages] = await Promise.all([
    creatorIds.length > 0
      ? supabase
          .from('creator_profiles')
          .select('id, display_name, avatar_url')
          .in('id', creatorIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase
          .from('subscriptions')
          .select('creator_id')
          .eq('buyer_id', user.id)
          .eq('status', 'active')
          .in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
    Promise.all(conversationList.map(async (conversation) => {
      const { data } = await supabase
        .from('messages')
        .select('content, created_at, sender_id')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return [conversation.id, data] as const
    })),
  ])

  const creators = new Map((creatorsResult.data ?? []).map((creator) => [creator.id, creator]))
  const activeCreatorIds = new Set((subscriptionsResult.data ?? []).map((subscription) => subscription.creator_id))
  const lastMessageByConversation = new Map(latestMessages)

  if (conversationList.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Nachrichten</h1>
          <p className="text-gray-500 mt-1">Deine Unterhaltungen mit Coaches.</p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="h-7 w-7 text-green-300" />
            </div>
            <p className="font-medium text-gray-800 mb-1">Noch keine Unterhaltungen</p>
            <p className="text-sm text-gray-500 mb-5">Mit einem aktiven Coach-Abo erhältst du Zugang zum persönlichen Chat.</p>
            <Link href="/coaches">
              <Button size="sm" className="gap-2">
                <Search className="h-4 w-4" />
                Coaches entdecken
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Nachrichten</h1>
        <p className="text-gray-500 mt-1">{conversationList.length} {conversationList.length === 1 ? 'Unterhaltung' : 'Unterhaltungen'}</p>
      </div>

      <div className="space-y-2" aria-label="Unterhaltungen">
        {conversationList.map((conversation) => {
          const creator = creators.get(conversation.creator_id)
          const lastMessage = lastMessageByConversation.get(conversation.id)
          const isActive = activeCreatorIds.has(conversation.creator_id)
          const timestamp = lastMessage?.created_at ?? conversation.updated_at ?? conversation.created_at

          return (
            <Link
              key={conversation.id}
              href={`/chat/${conversation.creator_id}`}
              className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              aria-label={`Unterhaltung mit ${creator?.display_name ?? 'Coach'} öffnen${isActive ? '' : ', nur Lesezugriff'}`}
            >
              <Card className="transition-all hover:border-green-300 hover:shadow-sm">
                <CardContent className="flex items-center gap-3 sm:gap-4 p-4">
                  <Avatar src={creator?.avatar_url ?? null} name={creator?.display_name ?? 'Coach'} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-gray-900 truncate">{creator?.display_name ?? 'Coach'}</p>
                      <time dateTime={timestamp} className="text-xs text-gray-400 flex-shrink-0">
                        {formatMessageTime(timestamp)}
                      </time>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm text-gray-500 truncate flex-1">
                        {lastMessage?.content ?? 'Noch keine Nachrichten'}
                      </p>
                      {!isActive && (
                        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">
                          Nur lesen
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
