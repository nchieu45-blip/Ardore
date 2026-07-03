import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import {
  FileText, Video, BookOpen, Image as ImageIcon,
  Check, ShoppingBag, Star, Users, ArrowRight, ChevronRight,
  Shield, RefreshCw, MessageCircle,
} from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import BuyButtonLarge from './BuyButtonLarge'
import ReviewSection from '@/app/creators/[slug]/ReviewSection'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF / E-Book', video: 'Video', course: 'Kurs', image: 'Bild',
}
const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText  className="h-8 w-8 text-white/90" />,
  video:  <Video     className="h-8 w-8 text-white/90" />,
  course: <BookOpen  className="h-8 w-8 text-white/90" />,
  image:  <ImageIcon className="h-8 w-8 text-white/90" />,
}
const TYPE_GRADIENTS: Record<ProductType, string> = {
  pdf:    'from-blue-500 to-blue-700',
  video:  'from-violet-500 to-violet-700',
  course: 'from-amber-400 to-orange-500',
  image:  'from-pink-500 to-rose-600',
}
const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness', ernaehrung: 'Ernährung', mental: 'Mental Health',
  abnehmen: 'Abnehmen', schlaf: 'Schlaf', yoga: 'Yoga', laufen: 'Laufen',
  krafttraining: 'Krafttraining', meditation: 'Meditation',
  stressmanagement: 'Stressmanagement', rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft: 'Schwangerschaft', mobility: 'Mobility', pilates: 'Pilates',
  muskelaufbau: 'Muskelaufbau',
}

interface ReviewProfile { full_name: string | null; avatar_url: string | null }
interface ReviewRow {
  id: string; product_id: string; buyer_id: string; rating: number
  content: string | null; created_at: string
  profiles: ReviewProfile | ReviewProfile[] | null
}
function normalizeProfile(raw: ReviewProfile | ReviewProfile[] | null): ReviewProfile | null {
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data: p } = await supabase
    .from('products')
    .select('title, description, thumbnail_url, creator_profiles(display_name)')
    .eq('id', id)
    .single()

  if (!p) return { title: 'Produkt – Ardore' }

  const cp = Array.isArray(p.creator_profiles) ? p.creator_profiles[0] : p.creator_profiles
  const title = `${p.title} – ${cp?.display_name ?? 'Ardore'}`
  const description = p.description?.slice(0, 160) ?? `Kaufe "${p.title}" auf Ardore`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: p.thumbnail_url ? [{ url: p.thumbnail_url }] : [],
    },
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: product } = await supabase
    .from('products')
    .select('*, creator_profiles(id, slug, display_name, avatar_url, bio, categories, category, is_demo)')
    .eq('id', id)
    .eq('is_published', true)
    .single()

  if (!product) notFound()

  const cpRaw = product.creator_profiles
  const creator = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw
  if (!creator) notFound()

  const { data: { user } } = await supabase.auth.getUser()

  const [reviewsRes, purchaseRes, relatedRes, profileRes, salesRes] = await Promise.all([
    supabase.from('reviews')
      .select('*, profiles(full_name, avatar_url)')
      .eq('product_id', id)
      .order('created_at', { ascending: false }),
    user
      ? supabase.from('purchases').select('id').eq('product_id', id).eq('buyer_id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase.from('products')
      .select('id, title, type, price, thumbnail_url')
      .eq('creator_id', creator.id)
      .eq('is_published', true)
      .neq('id', id)
      .limit(4),
    user
      ? supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase.from('purchases').select('id').eq('product_id', id),
  ])

  const reviews = (reviewsRes.data ?? []).map((r: ReviewRow) => ({
    ...r, profiles: normalizeProfile(r.profiles),
  }))
  const hasPurchased = !!purchaseRes.data
  const related = (relatedRes.data ?? []) as { id: string; title: string; type: ProductType; price: number; thumbnail_url: string | null }[]
  const currentProfile = profileRes.data
  const salesCount = (salesRes.data ?? []).length

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviews.length
    : null

  const type = product.type as ProductType
  const allCategories: string[] = (creator.categories as string[] | null)?.length
    ? (creator.categories as string[])
    : creator.category ? [creator.category] : []

  const trust = [
    { icon: Shield,     label: 'Sichere Zahlung', sub: 'SSL-verschlüsselt' },
    { icon: RefreshCw,  label: '14-Tage Garantie', sub: 'Geld-zurück' },
    { icon: Users,      label: 'Direkt-Download', sub: 'Sofort verfügbar' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-6" aria-label="Breadcrumb">
        <Link href="/marketplace" className="hover:text-gray-600 transition-colors">Marketplace</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/creators/${creator.slug}`} className="hover:text-gray-600 transition-colors">{creator.display_name}</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-gray-600 truncate max-w-48">{product.title}</span>
      </nav>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* ── Left: hero + description + reviews ─── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Hero image */}
          <div className="relative rounded-3xl overflow-hidden aspect-video bg-gray-100 shadow-sm animate-fade-in">
            {product.thumbnail_url ? (
              <img
                src={product.thumbnail_url}
                alt={product.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${TYPE_GRADIENTS[type]} flex items-center justify-center`}>
                <div className="opacity-40">
                  {TYPE_ICONS[type]}
                </div>
              </div>
            )}
            <div className="absolute top-4 left-4">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r ${TYPE_GRADIENTS[type]} shadow-sm`}>
                {TYPE_ICONS[type] && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{TYPE_ICONS[type]}</span>}
                {TYPE_LABELS[type]}
              </span>
            </div>
          </div>

          {/* Title + meta */}
          <div className="animate-slide-up">
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-3">{product.title}</h1>
            <div className="flex items-center gap-4 flex-wrap">
              {avgRating !== null && (
                <span className="flex items-center gap-1.5">
                  <StarRating rating={avgRating} count={reviews.length} />
                </span>
              )}
              {salesCount >= 10 && (
                <span className="flex items-center gap-1.5 text-sm text-gray-500">
                  <ShoppingBag className="h-4 w-4 text-gray-400" />
                  {salesCount} mal gekauft
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div className="animate-slide-up animate-delay-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Beschreibung</h2>
              <p className="text-gray-600 leading-relaxed whitespace-pre-line">{product.description}</p>
            </div>
          )}

          {/* Tags */}
          {(product.equipment?.length > 0 || product.level || product.duration) && (
            <div className="animate-slide-up animate-delay-150">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Details</h2>
              <div className="flex flex-wrap gap-2">
                {product.level && (
                  <Badge variant="outline">Level: {product.level}</Badge>
                )}
                {product.duration && (
                  <Badge variant="outline">Dauer: {product.duration}</Badge>
                )}
                {(product.equipment ?? []).map((eq: string) => (
                  <Badge key={eq} variant="outline">{eq}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Reviews */}
          <div className="animate-slide-up animate-delay-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              Bewertungen
              {reviews.length > 0 && (
                <span className="text-sm font-normal text-gray-400">({reviews.length})</span>
              )}
            </h2>
            {avgRating !== null && (
              <div className="flex items-center gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-100 mb-4">
                <div className="text-center">
                  <p className="text-4xl font-bold text-gray-900">{avgRating.toFixed(1)}</p>
                  <div className="flex justify-center mt-1">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className={`h-4 w-4 ${s <= Math.round(avgRating) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{reviews.length} Bewertung{reviews.length !== 1 ? 'en' : ''}</p>
                </div>
              </div>
            )}
            <Card>
              <ReviewSection
                productId={id}
                reviews={reviews}
                hasPurchased={hasPurchased}
                currentUserId={user?.id ?? null}
                currentUserName={currentProfile?.full_name ?? null}
                currentUserAvatar={currentProfile?.avatar_url ?? null}
              />
            </Card>
          </div>
        </div>

        {/* ── Right: sticky buy box + coach card ─── */}
        <div className="space-y-4">
          {/* Sticky buy box */}
          <div className="lg:sticky lg:top-24 space-y-4">
            <Card className="overflow-hidden animate-slide-up">
              <div className={`h-2 bg-gradient-to-r ${TYPE_GRADIENTS[type]}`} />
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="text-4xl font-bold text-gray-900">{formatCurrency(product.price)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">inkl. MwSt. · Einmalzahlung</p>
                </div>

                {hasPurchased ? (
                  <div className="flex items-center justify-center gap-2 w-full py-3 bg-green-50 rounded-xl border border-green-200 text-green-700 font-semibold text-sm">
                    <Check className="h-4 w-4" />
                    Bereits gekauft
                  </div>
                ) : user ? (
                  <BuyButtonLarge
                    productId={id}
                    price={product.price}
                    title={product.title}
                    type={type}
                    thumbnailUrl={product.thumbnail_url}
                    creatorId={creator.id}
                    creatorName={creator.display_name}
                    creatorSlug={creator.slug}
                    isDemo={creator.is_demo ?? false}
                  />
                ) : (
                  <Link href="/login" className="block">
                    <Button size="lg" className="w-full">Anmelden &amp; kaufen</Button>
                  </Link>
                )}

                {/* Trust badges */}
                <div className="space-y-2.5 pt-1">
                  {trust.map(({ icon: Icon, label, sub }) => (
                    <div key={label} className="flex items-center gap-3 text-xs text-gray-500">
                      <div className="h-7 w-7 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-3.5 w-3.5 text-green-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">{label}</span>
                        <span className="text-gray-400"> · {sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Coach card */}
            <Card className="animate-slide-up animate-delay-100">
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Dein Coach</p>
                <Link href={`/creators/${creator.slug}`} className="flex items-center gap-3 group mb-3">
                  <Avatar src={creator.avatar_url} name={creator.display_name} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors">{creator.display_name}</p>
                    {allCategories.length > 0 && (
                      <p className="text-xs text-gray-400 truncate">
                        {allCategories.slice(0, 2).map(c => CATEGORY_LABELS[c] ?? c).join(' · ')}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-green-600 transition-colors flex-shrink-0" />
                </Link>
                {creator.bio && (
                  <p className="text-sm text-gray-500 line-clamp-3 leading-relaxed mb-3">{creator.bio}</p>
                )}
                <Link href={`/creators/${creator.slug}`} className="block">
                  <Button variant="outline" size="sm" className="w-full gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Profil ansehen
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Related products */}
      {related.length > 0 && (
        <div className="mt-16 animate-slide-up animate-delay-300">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Weitere Produkte von {creator.display_name}</h2>
            <Link href={`/creators/${creator.slug}`} className="text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1 transition-colors">
              Alle anzeigen <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {related.map(p => (
              <Link key={p.id} href={`/products/${p.id}`} className="group">
                <Card className="overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 h-full">
                  <div className="relative h-32 overflow-hidden bg-gray-100">
                    {p.thumbnail_url ? (
                      <img src={p.thumbnail_url} alt={p.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className={`absolute inset-0 bg-gradient-to-br ${TYPE_GRADIENTS[p.type]} flex items-center justify-center opacity-80`}>
                        {TYPE_ICONS[p.type]}
                      </div>
                    )}
                  </div>
                  <CardContent className="p-3">
                    <p className="font-medium text-gray-900 text-sm line-clamp-2 leading-snug mb-1">{p.title}</p>
                    <p className="font-bold text-green-700 text-sm">{formatCurrency(p.price)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
