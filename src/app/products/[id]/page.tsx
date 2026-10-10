import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProductThumbnail } from '@/components/ui/Media'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import {
  FileText, Video, BookOpen, Image as ImageIcon,
  Check, ShoppingBag, Star, Users, ArrowRight,
  Shield, Lock, MessageCircle,
} from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import BuyButtonLarge from './BuyButtonLarge'
import ReviewSection from '@/app/creators/[slug]/ReviewSection'
import { showSalesCount } from '@/lib/salesCount'
import { VALID_PURCHASE_STATUS } from '@/lib/purchases'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF / E-Book', video: 'Video', course: 'Kurs', image: 'Bild',
}
const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText  className="h-8 w-8 text-muted" />,
  video:  <Video     className="h-8 w-8 text-muted" />,
  course: <BookOpen  className="h-8 w-8 text-muted" />,
  image:  <ImageIcon className="h-8 w-8 text-muted" />,
}
const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness', ernaehrung: 'Ernährung', mental: 'Mental Health',
  abnehmen: 'Abnehmen', schlaf: 'Schlaf', yoga: 'Yoga', laufen: 'Laufen',
  krafttraining: 'Krafttraining', meditation: 'Meditation',
  stressmanagement: 'Stressmanagement', rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft: 'Schwangerschaft', mobility: 'Mobility', pilates: 'Pilates',
  muskelaufbau: 'Muskelaufbau',
}

interface ReviewRow {
  id: string; product_id: string; rating: number
  content: string | null; created_at: string
  is_own: boolean
  reviewer_name: string | null; reviewer_avatar_url: string | null
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
    supabase.from('public_product_reviews')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: false }),
    user
      ? supabase.from('purchases').select('id').eq('product_id', id).eq('buyer_id', user.id).eq('payment_status', VALID_PURCHASE_STATUS).eq('stripe_livemode', true).single()
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
    supabase.rpc('get_public_product_sales_counts', { requested_product_ids: [id] }),
  ])

  const reviews = (reviewsRes.data ?? []).map((r: ReviewRow) => ({
    ...r, profiles: { full_name: r.reviewer_name, avatar_url: r.reviewer_avatar_url },
  }))
  const hasPurchased = !!purchaseRes.data
  const { data: testPurchase } = user && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
    ? await supabase.from('purchases').select('id').eq('product_id', id).eq('buyer_id', user.id)
      .eq('payment_status', VALID_PURCHASE_STATUS).eq('stripe_livemode', false).maybeSingle()
    : { data: null }
  const alreadyOwned = hasPurchased || !!testPurchase
  const related = (relatedRes.data ?? []) as { id: string; title: string; type: ProductType; price: number; thumbnail_url: string | null }[]
  const currentProfile = profileRes.data
  const salesCount = Number((salesRes.data?.[0] as { sales_count: number } | undefined)?.sales_count ?? 0)

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviews.length
    : null

  const type = product.type as ProductType
  const allCategories: string[] = (creator.categories as string[] | null)?.length
    ? (creator.categories as string[])
    : creator.category ? [creator.category] : []

  const trust = [
    { icon: Shield,     label: 'Sichere Zahlung', sub: 'SSL-verschlüsselt' },
    { icon: Lock,       label: 'Sichere Zahlung',  sub: 'via Stripe' },
    { icon: Users,      label: 'Direkt-Download', sub: 'Sofort verfügbar' },
  ]

  return (
    <div className="ardore-container py-6 sm:py-10">
      <Breadcrumb items={[{ label: 'Marktplatz', href: '/marketplace' }, { label: creator.display_name, href: `/creators/${creator.slug}` }, { label: product.title }]} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)] lg:gap-x-8">
        <header className="min-w-0 lg:col-span-2">
          <h1 className="max-w-4xl break-words text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">{product.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Badge icon={TYPE_ICONS[type]}>{TYPE_LABELS[type]}</Badge>
            {avgRating !== null && <StarRating rating={avgRating} count={reviews.length} />}
            {showSalesCount(product, salesCount) && salesCount >= 10 && (
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {salesCount} mal gekauft
              </span>
            )}
          </div>
        </header>

        <ProductThumbnail
          src={product.thumbnail_url}
          alt={product.title}
          fallback={TYPE_ICONS[type]}
          className="rounded-2xl border border-border lg:col-start-1 lg:row-start-2"
          sizes="(max-width: 1023px) 100vw, 66vw"
        />

        <aside className="min-w-0 lg:col-start-2 lg:row-start-2 lg:row-span-2">
          <div className="space-y-4 lg:sticky lg:top-24">
            <Card>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">{formatCurrency(product.price)}</p>
                  <p className="mt-2 text-sm text-muted">inkl. MwSt. · Einmalzahlung</p>
                </div>
                {alreadyOwned ? (
                  <ButtonLink href="/buyer/library" variant="soft" className="w-full">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {testPurchase ? 'Testkauf in deiner Bibliothek' : 'In deiner Bibliothek'}
                  </ButtonLink>
                ) : (
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
                )}
                <ul className="space-y-3 border-t border-border pt-4">
                  {trust.map(({ icon: Icon, label, sub }) => (
                    <li key={`${label}-${sub}`} className="flex items-start gap-3 text-sm text-muted">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                      <span><span className="font-medium text-foreground">{label}</span> · {sub}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <h2 className="mb-4 text-lg font-semibold">Dein Coach</h2>
                <Link href={`/creators/${creator.slug}`} className="group mb-4 flex min-h-11 items-center gap-3">
                  <Avatar src={creator.avatar_url} name={creator.display_name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-foreground group-hover:text-brand">{creator.display_name}</p>
                    {allCategories.length > 0 && (
                      <p className="mt-1 text-sm text-muted">{allCategories.slice(0, 2).map(c => CATEGORY_LABELS[c] ?? c).join(' · ')}</p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                </Link>
                {creator.bio && <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-muted">{creator.bio}</p>}
                <ButtonLink href={`/creators/${creator.slug}`} variant="secondary" className="w-full">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Profil ansehen
                </ButtonLink>
              </CardContent>
            </Card>
          </div>
        </aside>

        <div className="min-w-0 space-y-8 lg:col-start-1">
          {product.description && (
            <section className="border-t border-border pt-6">
              <h2 className="mb-3 text-xl font-semibold tracking-tight">Beschreibung</h2>
              <p className="max-w-prose whitespace-pre-line text-base leading-relaxed text-muted">{product.description}</p>
            </section>
          )}
          {(product.equipment?.length > 0 || product.level || product.duration) && (
            <section className="border-t border-border pt-6">
              <h2 className="mb-3 text-xl font-semibold tracking-tight">Details</h2>
              <div className="flex flex-wrap gap-2">
                {product.level && <Badge variant="outline">Level: {product.level}</Badge>}
                {product.duration && <Badge variant="outline">Dauer: {product.duration}</Badge>}
                {(product.equipment ?? []).map((eq: string) => <Badge key={eq} variant="outline">{eq}</Badge>)}
              </div>
            </section>
          )}
          <section className="border-t border-border pt-6">
            <h2 className="mb-4 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              Bewertungen
              {reviews.length > 0 && <span className="text-sm font-normal text-muted">({reviews.length})</span>}
            </h2>
            {avgRating !== null && (
              <div className="mb-4 flex items-center gap-4 rounded-xl border border-border bg-surface-muted p-4">
                <p className="text-3xl font-semibold tabular-nums">{avgRating.toFixed(1)}</p>
                <div>
                  <div className="flex gap-1">
                    {[1,2,3,4,5].map(s => <Star key={s} aria-hidden="true" className={`h-4 w-4 ${s <= Math.round(avgRating) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`} />)}
                  </div>
                  <p className="mt-1 text-sm text-muted">{reviews.length} Bewertung{reviews.length !== 1 ? 'en' : ''}</p>
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
          </section>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-10 border-t border-border pt-8 sm:mt-16">
          <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <h2 className="section-title max-w-3xl">Weitere Produkte von {creator.display_name}</h2>
            <Link href={`/creators/${creator.slug}`} className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-brand hover:text-brand-dark">
              Alle anzeigen <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map(p => (
              <Link key={p.id} href={`/products/${p.id}`} className="group min-w-0">
                <Card hover className="h-full overflow-hidden">
                  <ProductThumbnail src={p.thumbnail_url} alt={p.title} fallback={TYPE_ICONS[p.type]} />
                  <CardContent className="p-4">
                    <p className="mb-2 line-clamp-2 text-base font-semibold leading-snug">{p.title}</p>
                    <p className="font-semibold tabular-nums text-brand">{formatCurrency(p.price)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
