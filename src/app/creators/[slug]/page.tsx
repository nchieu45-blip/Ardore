import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency, cn } from '@/lib/utils'
import {
  MessageCircle, Lock, FileText, Video, BookOpen, Image as ImageIcon,
  Check, ShoppingBag, Sparkles, Pencil, CheckCircle2, TrendingUp, Star,
  ChevronRight, GraduationCap,
} from 'lucide-react'

import Link from 'next/link'
import type { Metadata } from 'next'
import SubscribeButton from './SubscribeButton'
import BuyButton from './BuyButton'
import ReviewSection from './ReviewSection'
import BookingWidget from './BookingWidget'
import HeartButton from '@/components/HeartButton'

const CATEGORY_LABELS: Record<string, string> = {
  // current canonical keys from lib/categories
  krafttraining: 'Krafttraining',
  muskelaufbau: 'Muskelaufbau',
  abnehmen: 'Abnehmen',
  ausdauer: 'Ausdauer',
  functional: 'Functional Training',
  ernaehrungsberatung: 'Ernährungsberatung',
  gewichtsmanagement: 'Gewichtsmanagement',
  sporternaehrung: 'Sporternährung',
  mental: 'Mental Health',
  yoga: 'Yoga',
  meditation: 'Meditation',
  stressbewaeltigung: 'Stressbewältigung',
  rueckengesundheit: 'Rückengesundheit',
  physiotherapie: 'Physiotherapie',
  beweglichkeit: 'Beweglichkeit',
  schwangerschaft: 'Schwangerschaft & Postnatal',
  kampfsport: 'Kampfsport',
  laufen: 'Laufen',
  pilates: 'Pilates',
  // legacy keys (coaches onboarded before category rename)
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  schlaf: 'Schlaf',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  mobility: 'Mobility & Dehnen',
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

const SERVICE_LABELS: Record<string, string> = {
  '1to1_coaching':   '1:1 Coaching',
  'video_kurs':      'Video Kurs',
  'online_kurs':     'Online Kurs',
  'ernaehrungsplan': 'Ernährungsplan',
  'trainingsplan':   'Trainingsplan',
  'gruppencoaching': 'Gruppencoaching',
  'live_sessions':   'Live Sessions',
  'pdf_guide':       'PDF Guide',
}

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

interface SessionReviewRow {
  id: string
  rating: number
  content: string | null
  created_at: string
  profiles: ReviewProfile | ReviewProfile[] | null
}

function normalizeProfile(raw: ReviewProfile | ReviewProfile[] | null): ReviewProfile | null {
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
  const { data: c } = await supabase
    .from('creator_profiles')
    .select('display_name, bio, avatar_url')
    .eq('slug', slug)
    .single()

  if (!c) return { title: 'Coach – Ardore' }
  const title = `${c.display_name} – Coach auf Ardore`
  const description = c.bio?.slice(0, 160) ?? `Entdecke Produkte und Abonnements von ${c.display_name} auf Ardore`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: c.avatar_url ? [{ url: c.avatar_url }] : [],
    },
  }
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

  const { data: coachingOfferData } = await supabase
    .from('coaching_offers')
    .select('is_enabled, price_cents, duration_minutes, description')
    .eq('creator_id', creator.id)
    .single()

  const coachingOffer = coachingOfferData?.is_enabled ? coachingOfferData : null

  const [tiersRes, subscriptionRes, purchasesRes, reviewsRes, currentProfileRes, totalSalesRes, sessionReviewsRes] = await Promise.all([
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
    supabase
      .from('session_reviews')
      .select('id, rating, content, created_at, profiles(full_name, avatar_url)')
      .eq('creator_id', creator.id)
      .order('created_at', { ascending: false })
      .limit(20),
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

  const sessionReviews = (sessionReviewsRes.data ?? []) as SessionReviewRow[]
  const sessionReviewCount = sessionReviews.length
  const avgSessionRating = sessionReviewCount > 0
    ? sessionReviews.reduce((sum, r) => sum + r.rating, 0) / sessionReviewCount
    : null

  // Compute remaining subscription sessions for logged-in subscriber
  let subscriberSessions: {
    subscriptionId: string; remaining: number; total: number; period: 'week' | 'month'
  } | null = null

  if (activeSubscription && coachingOffer) {
    const activeTier = tiers.find((t: { id: string }) => t.id === activeSubscription.tier_id) as
      { id: string; included_video_sessions?: number; video_session_period?: string | null } | undefined
    const total  = activeTier?.included_video_sessions ?? 0
    const period = (activeTier?.video_session_period ?? 'month') as 'week' | 'month'

    if (total > 0) {
      const now = new Date()
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
        .eq('subscription_id', activeSubscription.id)
        .neq('status', 'cancelled')
        .gte('created_at', periodStart.toISOString())
      const used = count ?? 0
      subscriberSessions = { subscriptionId: activeSubscription.id, remaining: Math.max(0, total - used), total, period }
    }
  }

  const primaryCategory = (creator.categories as string[] | null)?.[0] ?? creator.category ?? null
  const allCategories: string[] = (creator.categories as string[] | null)?.length
    ? (creator.categories as string[])
    : creator.category ? [creator.category] : []
  const services: string[] = (creator.services as string[] | null) ?? []
  const qualifications: string[] = (creator.qualifications as string[] | null) ?? []
  const bannerGradient = primaryCategory
    ? (CATEGORY_GRADIENTS[primaryCategory] ?? DEFAULT_GRADIENT)
    : DEFAULT_GRADIENT

  return (
    <div className="min-h-screen bg-gray-50/40">
      {/* Full-width banner */}
      <div className={`relative w-full bg-gradient-to-br ${bannerGradient} h-56 sm:h-64 overflow-hidden animate-fade-in`}>
        {creator.banner_url && (
          <img src={creator.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute -bottom-10 -right-10 h-56 w-56 rounded-full bg-white/10" />
        <div className="absolute -top-12 -left-12 h-44 w-44 rounded-full bg-white/10" />
        {/* Breadcrumb in banner */}
        <div className="absolute top-4 left-0 right-0 max-w-5xl mx-auto px-4">
          <nav className="flex items-center gap-1.5 text-sm text-white/70" aria-label="Breadcrumb">
            <Link href="/coaches" className="hover:text-white transition-colors">Coaches</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-white/90 font-medium">{creator.display_name}</span>
          </nav>
        </div>
        {allCategories.length > 0 && (
          <div className="absolute bottom-4 right-4 flex flex-wrap gap-1.5 justify-end max-w-[60%]">
            {allCategories.slice(0, 3).map(cat => (
              <span key={cat} className="bg-white/20 backdrop-blur-sm border border-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                {CATEGORY_LABELS[cat] ?? cat}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4">
        {/* Avatar row: overlaps banner */}
        <div className="-mt-16 mb-6 flex items-end justify-between gap-4 flex-wrap">
          <Avatar
            src={creator.avatar_url}
            name={creator.display_name}
            size="xl"
            className="ring-4 ring-white shadow-xl flex-shrink-0"
          />
          {/* Visitor action buttons — right side of avatar row */}
          <div className="flex items-center gap-2 pb-1 flex-shrink-0">
            {user?.id !== creator.user_id && (
              <HeartButton type="coach" itemId={creator.id} className="h-9 w-9" />
            )}
            {user && activeSubscription && (
              <Link href={`/chat/${creator.id}`}>
                <Button size="sm" className="gap-1.5 shadow-sm">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Nachricht
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Profile header — name row with edit button right-aligned */}
        <div className="mb-6 animate-slide-up">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{creator.display_name}</h1>
              {qualifications.length > 0 && (
                <span className="inline-flex items-center gap-1 bg-green-600 text-white text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">
                  <GraduationCap className="h-3.5 w-3.5" />
                  Qualifiziert
                </span>
              )}
            </div>
            {user?.id === creator.user_id && (
              <Link
                href="/creator/settings/profile"
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900 hover:shadow-sm transition-all"
              >
                <Pencil className="h-3.5 w-3.5" />
                Profil bearbeiten
              </Link>
            )}
          </div>
          {creator.bio && (
            <p className="text-gray-600 max-w-2xl leading-relaxed">{creator.bio}</p>
          )}
        </div>

        {/* Stats strip */}
        {(products.length > 0 || tiers.length > 0 || totalSales >= 10 || overallAvgRating !== null || avgSessionRating !== null) && (
          <div className="flex flex-wrap items-center gap-6 mb-8 pb-6 border-b border-gray-100 animate-slide-up animate-delay-100">
            {products.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-8 w-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <ShoppingBag className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{products.length}</p>
                  <p className="text-gray-500 text-xs">{products.length === 1 ? 'Produkt' : 'Produkte'}</p>
                </div>
              </div>
            )}
            {totalSales >= 10 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{totalSales}</p>
                  <p className="text-gray-500 text-xs">Verkäufe</p>
                </div>
              </div>
            )}
            {overallAvgRating !== null && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{overallAvgRating.toFixed(1)}</p>
                  <p className="text-gray-500 text-xs">{totalReviewCount} Produkt-Bew.</p>
                </div>
              </div>
            )}
            {avgSessionRating !== null && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Video className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{avgSessionRating.toFixed(1)}</p>
                  <p className="text-gray-500 text-xs">{sessionReviewCount} Session-Bew.</p>
                </div>
              </div>
            )}
            {tiers.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-8 w-8 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{tiers.length}</p>
                  <p className="text-gray-500 text-xs">Abo-Stufe{tiers.length !== 1 ? 'n' : ''}</p>
                </div>
              </div>
            )}
          </div>
        )}

      {qualifications.length > 0 && (
        <div className="mb-6 animate-slide-up animate-delay-100">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Qualifikationen</h2>
            <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              <GraduationCap className="h-3 w-3" />
              Qualifiziert
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {qualifications.map((q, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-800 border border-green-200 rounded-full text-sm font-medium"
              >
                <GraduationCap className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                {q}
              </span>
            ))}
          </div>
        </div>
      )}

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

      {/* ── Adaptive content grid ──────────────────────────────── */}
      {(() => {
        const hasProducts = products.length > 0
        const hasTiers    = tiers.length > 0
        const hasSidebar  = hasTiers || !!coachingOffer

        if (!hasProducts && !hasSidebar) return null

        return (
          <div className={cn('pb-16', hasProducts && hasSidebar && 'grid lg:grid-cols-3 gap-8')}>

            {/* Products column */}
            {hasProducts && (
              <div className={cn('space-y-4 animate-slide-up animate-delay-100', hasSidebar && 'lg:col-span-2')}>
                {products.length > 0 && (
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Produkte</h2>
                )}
                {products.map((product: { id: string; title: string; description: string | null; type: ProductType; price: number; thumbnail_url: string | null }) => {
                  const owned = purchasedIds.has(product.id)
                  const stats = ratingStats[product.id]
                  const productReviews = reviewsByProduct[product.id] ?? []
                  return (
                    <Card key={product.id} className="overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="flex gap-0">
                        <div className={`w-2 bg-gradient-to-b ${TYPE_GRADIENTS[product.type]} flex-shrink-0 rounded-l-2xl`} />
                        <CardContent className="flex items-start gap-4 p-5 flex-1">
                          <Link href={`/products/${product.id}`} className="relative h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 shadow-sm block">
                            {product.thumbnail_url ? (
                              <img src={product.thumbnail_url} alt={product.title} className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <div className={`absolute inset-0 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center`}>
                                {TYPE_ICONS[product.type]}
                              </div>
                            )}
                          </Link>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Link href={`/products/${product.id}`} className="hover:text-green-700 transition-colors">
                                <h3 className="font-semibold text-gray-900 leading-snug">{product.title}</h3>
                              </Link>
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
                            {(productSalesCounts[product.id] ?? 0) >= 50 && (
                              <p className="text-xs text-gray-400 mt-1">{productSalesCounts[product.id]} mal gekauft</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className="font-bold text-gray-900 text-base">{formatCurrency(product.price)}</span>
                            {owned ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                                <Check className="h-3 w-3" /> Gekauft
                              </span>
                            ) : user ? (
                              <BuyButton
                                productId={product.id}
                                price={product.price}
                                title={product.title}
                                type={product.type}
                                thumbnailUrl={product.thumbnail_url}
                                creatorId={creator.id}
                                creatorName={creator.display_name}
                                creatorSlug={creator.slug}
                              />
                            ) : (
                              <Link href="/login"><Button size="sm">Kaufen</Button></Link>
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
                })}
              </div>
            )}

            {/* Sidebar: booking widget + subscription tiers */}
            {hasSidebar && (
              <div className="space-y-6 animate-slide-up animate-delay-200">
                {coachingOffer && (
                  <BookingWidget
                    creatorId={creator.id}
                    offer={coachingOffer}
                    currentUserEmail={user?.email ?? null}
                    currentUserName={currentProfile?.full_name ?? null}
                    subscriberSessions={subscriberSessions}
                  />
                )}

                {hasTiers && (
                  <div className="space-y-4">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Abonnements</h2>
                    {tiers.map((tier: {
                      id: string
                      name: string
                      description: string | null
                      price_monthly: number
                      features: string[]
                      included_video_sessions?: number
                      video_session_period?: 'week' | 'month' | null
                    }, i: number) => {
                      const isSubscribed     = activeSubscription?.tier_id === tier.id
                      const isFeatured       = i === 0 && tiers.length > 1
                      const tierSessions     = tier.included_video_sessions ?? 0
                      const sessionPeriod    = tier.video_session_period ?? 'month'
                      const periodLabel      = sessionPeriod === 'week' ? 'pro Woche' : 'pro Monat'
                      const remainingForTier = isSubscribed ? subscriberSessions?.remaining ?? null : null

                      return (
                        <div
                          key={tier.id}
                          className={cn(
                            'rounded-2xl border-2 overflow-hidden transition-all duration-200',
                            isSubscribed   ? 'border-green-400 shadow-md shadow-green-100'
                            : isFeatured   ? 'border-green-300 shadow-md'
                            : 'border-gray-100 hover:border-gray-200'
                          )}
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
                              <p className="text-sm text-gray-500 mb-3 leading-relaxed">{tier.description}</p>
                            )}
                            {/* Benefits */}
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2.5">
                                <MessageCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                                <span>Chat mit dem Coach freigeschaltet</span>
                              </div>
                              {tierSessions > 0 && (
                                <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 rounded-xl px-3 py-2.5">
                                  <Video className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                  <span>
                                    <strong>{tierSessions}</strong> Video-Session{tierSessions !== 1 ? 's' : ''} {periodLabel} inkludiert
                                    {remainingForTier !== null && (
                                      <span className="ml-1.5 text-blue-600 font-semibold">
                                        ({remainingForTier} verbleibend)
                                      </span>
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                            {isSubscribed ? (
                              <div className="space-y-2">
                                <Link href={`/chat/${creator.id}`} className="block">
                                  <Button className="w-full gap-2">
                                    <MessageCircle className="h-4 w-4" />
                                    Zum Chat
                                  </Button>
                                </Link>
                                {tierSessions > 0 && (
                                  <Link href={`#booking`} className="block" onClick={e => { e.preventDefault(); document.querySelector('[data-booking-widget]')?.scrollIntoView({ behavior: 'smooth' }) }}>
                                    <Button variant="outline" size="sm" className="w-full gap-1.5">
                                      <Video className="h-3.5 w-3.5" />
                                      Session buchen
                                    </Button>
                                  </Link>
                                )}
                              </div>
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
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Session reviews section */}
      {sessionReviews.length > 0 && (
        <div className="pb-16 animate-slide-up">
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Coaching-Bewertungen</h2>
            <div className="flex items-center gap-1.5 bg-violet-50 px-3 py-1 rounded-full">
              <Star className="h-4 w-4 text-violet-600 fill-violet-600" />
              <span className="text-sm font-semibold text-violet-700">{avgSessionRating!.toFixed(1)}</span>
              <span className="text-xs text-violet-500">· {sessionReviewCount} Bewertung{sessionReviewCount !== 1 ? 'en' : ''}</span>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {sessionReviews.map(review => {
              const profile = normalizeProfile(review.profiles)
              return (
                <div key={review.id} className="rounded-2xl border border-gray-100 bg-white p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-gray-500">
                          {(profile?.full_name ?? '?')[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {profile?.full_name ?? 'Anonymer Nutzer'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(review.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex gap-0.5 flex-shrink-0">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star key={s} className={`h-3.5 w-3.5 ${s <= review.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-100'}`} />
                      ))}
                    </div>
                  </div>
                  {review.content && (
                    <p className="text-sm text-gray-600 leading-relaxed">&ldquo;{review.content}&rdquo;</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  </div>
  )
}
