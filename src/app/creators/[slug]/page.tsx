import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import { MessageCircle, Lock } from 'lucide-react'
import Link from 'next/link'
import SubscribeButton from './SubscribeButton'
import ProductsFilter from './ProductsFilter'

const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  yoga: 'Yoga',
  mental: 'Mental Health',
  laufen: 'Laufen',
  abnehmen: 'Abnehmen',
  muskelaufbau: 'Muskelaufbau',
  allgemein: 'Gesundheit',
}

export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!creator) notFound()

  const { data: { user } } = await supabase.auth.getUser()

  const [productsRes, tiersRes, subscriptionRes, purchasesRes] = await Promise.all([
    supabase.from('products').select('*').eq('creator_id', creator.id).eq('is_published', true).order('created_at', { ascending: false }),
    supabase.from('subscription_tiers').select('*').eq('creator_id', creator.id).eq('is_active', true).order('price_monthly'),
    user ? supabase.from('subscriptions').select('*').eq('creator_id', creator.id).eq('buyer_id', user.id).eq('status', 'active').single() : Promise.resolve({ data: null }),
    user ? supabase.from('purchases').select('product_id').eq('buyer_id', user.id) : Promise.resolve({ data: [] }),
  ])

  const products = productsRes.data ?? []
  const tiers = tiersRes.data ?? []
  const activeSubscription = subscriptionRes.data
  const purchasedIds = new Set((purchasesRes.data ?? []).map((p: { product_id: string }) => p.product_id))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-400 to-green-600 rounded-2xl h-40 mb-16 relative">
        <div className="absolute bottom-0 left-6 translate-y-1/2">
          <Avatar src={creator.avatar_url} name={creator.display_name} size="xl" className="ring-4 ring-white" />
        </div>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{creator.display_name}</h1>
            {creator.category && (
              <Badge variant="success">{CATEGORY_LABELS[creator.category] ?? creator.category}</Badge>
            )}
          </div>
          {creator.bio && <p className="text-gray-600 max-w-lg">{creator.bio}</p>}
        </div>
        {user && activeSubscription && (
          <Link href={`/chat/${creator.id}`}>
            <Button variant="outline" className="gap-2">
              <MessageCircle className="h-4 w-4" />
              Nachricht
            </Button>
          </Link>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Products */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Produkte</h2>
          {products.length === 0 ? (
            <Card>
              <CardContent className="text-center py-10">
                <p className="text-gray-500">Noch keine Produkte verfügbar.</p>
              </CardContent>
            </Card>
          ) : (
            <ProductsFilter
              products={products.map((p: { id: string; title: string; description: string | null; type: 'pdf' | 'video' | 'course' | 'image'; price: number }) => ({
                id: p.id,
                title: p.title,
                description: p.description,
                type: p.type,
                price: p.price,
              }))}
              purchasedIds={[...purchasedIds]}
              isLoggedIn={!!user}
            />
          )}
        </div>

        {/* Subscriptions */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Abonnements</h2>
          {tiers.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-sm text-gray-500">Kein Abo verfügbar.</p>
              </CardContent>
            </Card>
          ) : (
            tiers.map((tier: {
              id: string
              name: string
              description: string | null
              price_monthly: number
              features: string[]
            }) => {
              const isSubscribed = !!activeSubscription
              return (
                <Card key={tier.id} className={isSubscribed ? 'border-green-300' : ''}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900">{tier.name}</h3>
                      <span className="text-lg font-bold text-green-600">{formatCurrency(tier.price_monthly)}<span className="text-sm font-normal text-gray-500">/Mo</span></span>
                    </div>
                    {tier.description && (
                      <p className="text-sm text-gray-500 mb-3">{tier.description}</p>
                    )}
                    <div className="mb-4 text-sm text-gray-600 flex items-center gap-1.5">
                      <MessageCircle className="h-4 w-4 text-green-500" />
                      Chat mit dem Coach freigeschaltet
                    </div>
                    {isSubscribed ? (
                      <Badge variant="success" className="w-full justify-center py-1.5">Aktives Abo</Badge>
                    ) : user ? (
                      <SubscribeButton tierId={tier.id} creatorId={creator.id} />
                    ) : (
                      <Link href="/login" className="block">
                        <Button size="sm" className="w-full">
                          <Lock className="h-3.5 w-3.5 mr-1" />
                          Anmelden zum Abonnieren
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
