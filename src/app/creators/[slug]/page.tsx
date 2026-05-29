import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import {
  MessageCircle, Lock, FileText, Video, BookOpen, Image as ImageIcon,
  Check, ShoppingBag, Sparkles, Pencil, CheckCircle2, TrendingUp, Star,
} from 'lucide-react'
import { SERVICE_OPTIONS } from '@/components/ui/CategoryPicker'
import Link from 'next/link'
import SubscribeButton from './SubscribeButton'
import BuyButton from './BuyButton'
import ReviewSection from './ReviewSection'

const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  mental: 'Mental Health',
  abnehmen: 'Abnehmen',
  schlaf: 'Schlaf',
  yoga: 'Yoga',
  laufen: 'Laufen',
  krafttraining: 'Krafttraining',
  meditation: 'Meditation',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft: 'Schwangerschaft & Postnatal',
  mobility: 'Mobility & Dehnen',
  pilates: 'Pilates',
  muskelaufbau: 'Muskelaufbau',
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  fitness: 'from-orange-400 to-red-500',
  ernaehrung: 'from-green-400 to-emerald-600',
  mental: 'from-violet-400 to-purple-600',
  abnehmen: 'from-pink-400 to-rose-500',
  schlaf: 'from-blue-400 to-indigo-600',
  yoga: 'from-teal-400 to-cyan-600',
  laufen: 'from-amber-400 to-orange-500',
  krafttraining: 'from-gray-600 to-gray-800',
  meditation: 'from-violet-500 to-fuchsia-600',
  stressmanagement: 'from-sky-400 to-blue-600',
  rueckenschmerzen: 'from-red-400 to-orange-500',
  schwangerschaft: 'from-pink-300 to-rose-400',
  mobility: 'from-emerald-400 to-teal-600',
  pilates: 'from-purple-400 to-violet-600',
  muskelaufbau: 'from-zinc-500 to-gray-700',
}

const DEFAULT_GRADIENT = 'from-green-400 to-emerald-600'

const SERVICE_LABELS: Record<string, string> = Object.fromEntries(
  SERVICE_OPTIONS.map(s => [s.value, s.label])
)

type ProductType = 'pdf' | 'video' | 'course' | 'image'

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText  className="h-6 w-6 text-white/90" />,
  video:  <Video     className="h-6 w-6 text-white/90" />,
  course: <BookOpen  className="h-6 w-6 text-white/90" />,
  image:  <ImageIcon className="h-6 w-6 text-white/90" />,
}

const TYPE_GRADIENTS: Record<ProductType, string> = {
  pdf:    'from-blue-500 to-blue-700',
  video:  'from-violet-500 to-violet-700',
  course: 'from-amber-400 to-orange-500',
  image:  'from-pink-500 to-rose-600',
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

interface ReviewProfile {
  full_name: string | null
  avatar_url: string | null
}

interface ReviewRow {
  id: string
  product_id: string
  buyer_id: string
  rating: number
  content: string | null
  created_at: string
  profiles: ReviewProfile | ReviewProfile[] | null
}

function normalizeProfile(raw: ReviewProfile | ReviewProfile[] | null): ReviewProfile | null {
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
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

  const { data: productsData } = await supabase
    .from('products')
    .select('*')
    .eq('creator_id', creator.id)
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  const products = productsData ?? []
  const productIds = products.map((p: { id: string }) => p.id)

  const [tiersRes, subscriptionRes, purchasesRes, reviewsRes, currentProfileRes, totalSalesRes] = await Promise.all([
    supabase.from('subscription_tiers').select('*').eq('creator_id', creator.id).eq('is_active', true).order('price_monthly'),
    user ? supabase.from('subscriptions').select('*').eq('creator_id', creator.id).eq('buyer_id', user.id).eq('status', 'active').single() : Promise.resolve({ data: null }),
    user ? supabase.from('purchases').select('product_id').eq('buyer_id', user.id) : Promise.resolve({ data: [] }),
    productIds.length > 0
      ? supabase.from('reviews').select('*, profiles(full_name, avatar_url)').in('product_id', productIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    user ? supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single() : Promise.resolve({ data: null }),
    productIds.length > 0
      ? supabase.from('purchases').select('product_id').in('product_id', productIds)
      : Promise.resolve({ data: [] }),
  ])

  const tiers = tiersRes.data ?? []
  const activeSubscription = subscriptionRes.data
  const purchasedIds = new Set((purchasesRes.data ?? []).map((p: { product_id: string }) => p.product_id))
  const currentProfile = currentProfileRes.data

  const productSalesCounts: Record<string, number> = {}
  for (const { product_id } of (totalSalesRes.data ?? []) as { product_id: string }[]) {
    productSalesCounts[product_id] = (productSalesCounts[product_id] ?? 0) + 1
  }
  const totalSales = Object.values(productSalesCounts).reduce((sum, n) => sum + n, 0)

  const reviewsByProduct: Record<string, {
    id: string; product_id: string; buyer_id: string; rating: number; content: string | null; created_at: string
    profiles: ReviewProfile | null
  }[]> = {}

  for (const r of (reviewsRes.data ?? []) as ReviewRow[]) {
    if (!reviewsByProduct[r.product_id]) reviewsByProduct[r.product_id] = []
    reviewsByProduct[r.product_id].push({ ...r, profiles: normalizeProfile(r.profiles) })
  }

  const ratingStats: Record<string, { avg: number; count: number }> = {}
  for (const [productId, pReviews] of Object.entries(reviewsByProduct)) {
    const sum = pReviews.reduce((acc, r) => acc + r.rating, 0)
    ratingStats[productId] = { avg: sum / pReviews.length, count: pReviews.length }
  }

  const allReviewsFlat = Object.values(reviewsByProduct).flat()
  const totalReviewCount = allReviewsFlat.length
  const overallAvgRating = totalReviewCount > 0
    ? allReviewsFlat.reduce((sum, r) => sum + r.rating, 0) / totalReviewCount
    : null

  const primaryCategory = (creator.categories as string[] | null)?.[0] ?? creator.category ?? null
  const allCategories: string[] = (creator.categories as string[] | null)?.length
    ? (creator.categories as string[])
    : creator.category ? [creator.category] : []
  const services: string[] = (creator.services as string[] | null) ?? []
  const bannerGradient = primaryCategory
    ? (CATEGORY_GRADIENTS[primaryCategory] ?? DEFAULT_GRADIENT)
    : DEFAULT_GRADIENT

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Banner */}
      <div className={`relative bg-gradient-to-br ${bannerGradient} rounded-3xl h-48 mb-20 overflow-hidden animate-fade-in`}>
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute -bottom-6 -right-6 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -top-8 -left-8 h-32 w-32 rounded-full bg-white/10" />
        {allCategories.length > 0 && (
          <div className="absolute top-4 right-4 flex flex-wrap gap-1.5 justify-end max-w-[60%]">
            {allCategories.slice(0, 3).map(cat => (
              <span key={cat} className="bg-white/20 backdrop-blur-sm border border-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                {CATEGORY_LABELS[cat] ?? cat}
              </span>
            ))}
          </div>
        )}
        {/* Avatar */}
        <div className="absolute -bottom-14 left-6">
          <Avatar
            src={creator.avatar_url}
            name={creator.display_name}
            size="xl"
            className="ring-4 ring-white shadow-xl"
          />
        </div>
      </div>

      {/* Profile header */}
      <div className="flex items-start justify-between mb-8 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-1">{creator.display_name}</h1>
          {creator.bio && (
            <p className="text-gray-500 max-w-lg leading-relaxed">{creator.bio}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {products.length > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <ShoppingBag className="h-4 w-4 text-gray-400" />
                {products.length} {products.length === 1 ? 'Produkt' : 'Produkte'}
              </span>
            )}
            {tiers.length > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <Sparkles className="h-4 w-4 text-gray-400" />
                {tiers.length} Abo-Stufe{tiers.length !== 1 ? 'n' : ''}
              </span>
            )}
            {totalSales > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <TrendingUp className="h-4 w-4 text-gray-400" />
                {totalSales} {totalSales === 1 ? 'Kauf' : 'Käufe'}
              </span>
            )}
            {overallAvgRating !== null && (
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                {overallAvgRating.toFixed(1)} ({totalReviewCount} {totalReviewCount === 1 ? 'Bewertung' : 'Bewertungen'})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {user?.id === creator.user_id && (
            <Link href="/creator/settings/profile">
              <Button variant="outline" className="gap-2">
                <Pencil className="h-4 w-4" />
                Profil bearbeiten
              </Button>
            </Link>
          )}
          {user && activeSubscription && (
            <Link href={`/chat/${creator.id}`}>
              <Button className="gap-2 shadow-sm">
                <MessageCircle className="h-4 w-4" />
                Nachricht
              </Button>
            </Link>
          )}
        </div>
      </div>

      {services.length > 0 && (
        <div className="mb-8 animate-slide-up animate-delay-100">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Dienstleistungen</h2>
          <div className="flex flex-wrap gap-2">
            {services.map(s => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-800 border border-green-200 rounded-full text-sm font-medium"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                {SERVICE_LABELS[s] ?? s}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Products */}
        <div className="lg:col-span-2 space-y-4 animate-slide-up animate-delay-100">
          <h2 className="text-xl font-bold text-gray-900">Produkte</h2>

          {products.length === 0 ? (
            <Card>
              <CardContent className="text-center py-14">
                <div className="h-14 w-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                  <ShoppingBag className="h-7 w-7 text-gray-300" />
                </div>
                <p className="font-medium text-gray-700 mb-1">Noch keine Produkte</p>
                <p className="text-sm text-gray-400">Schau bald wieder vorbei!</p>
              </CardContent>
            </Card>
          ) : (
            products.map((product: { id: string; title: string; description: string | null; type: ProductType; price: number }) => {
              const owned = purchasedIds.has(product.id)
              const stats = ratingStats[product.id]
              const productReviews = reviewsByProduct[product.id] ?? []
              return (
                <Card key={product.id} className="overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="flex gap-0">
                    {/* Type thumbnail strip */}
                    <div className={`w-2 bg-gradient-to-b ${TYPE_GRADIENTS[product.type]} flex-shrink-0 rounded-l-2xl`} />
                    <CardContent className="flex items-start gap-4 p-5 flex-1">
                      <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                        {TYPE_ICONS[product.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900 leading-snug">{product.title}</h3>
                          <span className="flex-shrink-0 text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {TYPE_LABELS[product.type]}
                          </span>
                        </div>
                        {product.description && (
                          <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">{product.description}</p>
                        )}
                        {stats && stats.count > 0 && (
                          <div className="mt-2 mb-1">
                            <StarRating rating={stats.avg} count={stats.count} size="sm" />
                          </div>
                        )}
                        {(productSalesCounts[product.id] ?? 0) > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            {productSalesCounts[product.id]} mal gekauft
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <span className="font-bold text-gray-900 text-base">{formatCurrency(product.price)}</span>
                        {owned ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                            <Check className="h-3 w-3" /> Gekauft
                          </span>
                        ) : user ? (
                          <BuyButton productId={product.id} price={product.price} />
                        ) : (
                          <Link href="/login">
                            <Button size="sm">Kaufen</Button>
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  </div>
                  <ReviewSection
                    productId={product.id}
                    reviews={productReviews}
                    hasPurchased={owned}
                    currentUserId={user?.id ?? null}
                    currentUserName={currentProfile?.full_name ?? null}
                    currentUserAvatar={currentProfile?.avatar_url ?? null}
                  />
                </Card>
              )
            })
          )}
        </div>

        {/* Subscription tiers */}
        <div className="space-y-4 animate-slide-up animate-delay-200">
          <h2 className="text-xl font-bold text-gray-900">Abonnements</h2>

          {tiers.length === 0 ? (
            <Card>
              <CardContent className="text-center py-10">
                <p className="text-sm text-gray-400">Kein Abo verfügbar.</p>
              </CardContent>
            </Card>
          ) : (
            tiers.map((tier: {
              id: string
              name: string
              description: string | null
              price_monthly: number
              features: string[]
            }, i: number) => {
              const isSubscribed = !!activeSubscription
              const isFeatured = i === 0 && tiers.length > 1

              return (
                <div
                  key={tier.id}
                  className={`rounded-2xl border-2 overflow-hidden transition-all duration-200 ${
                    isSubscribed
                      ? 'border-green-400 shadow-md shadow-green-100'
                      : isFeatured
                      ? 'border-green-300 shadow-md'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  {isFeatured && !isSubscribed && (
                    <div className="bg-gradient-to-r from-green-600 to-emerald-500 text-white text-xs font-semibold text-center py-1.5 flex items-center justify-center gap-1">
                      <Sparkles className="h-3 w-3" /> Beliebt
                    </div>
                  )}
                  {isSubscribed && (
                    <div className="bg-gradient-to-r from-green-600 to-emerald-500 text-white text-xs font-semibold text-center py-1.5 flex items-center justify-center gap-1">
                      <Check className="h-3 w-3" /> Aktives Abo
                    </div>
                  )}
                  <div className="bg-white p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-gray-900">{tier.name}</h3>
                      <div className="text-right">
                        {tier.price_monthly === 0 ? (
                          <span className="text-lg font-bold text-green-600">Kostenlos</span>
                        ) : (
                          <>
                            <span className="text-2xl font-bold text-gray-900">{tier.price_monthly}€</span>
                            <span className="text-xs text-gray-400">/Mo</span>
                          </>
                        )}
                      </div>
                    </div>
                    {tier.description && (
                      <p className="text-sm text-gray-500 mb-4 leading-relaxed">{tier.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-4 bg-gray-50 rounded-xl px-3 py-2.5">
                      <MessageCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span>Chat mit dem Coach freigeschaltet</span>
                    </div>
                    {isSubscribed ? (
                      <Link href={`/chat/${creator.id}`} className="block">
                        <Button className="w-full gap-2">
                          <MessageCircle className="h-4 w-4" />
                          Zum Chat
                        </Button>
                      </Link>
                    ) : user ? (
                      <SubscribeButton tierId={tier.id} creatorId={creator.id} />
                    ) : (
                      <Link href="/login" className="block">
                        <Button size="sm" className="w-full gap-1.5">
                          <Lock className="h-3.5 w-3.5" />
                          Anmelden zum Abonnieren
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
