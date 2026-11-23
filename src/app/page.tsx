import localFont from 'next/font/local'
import { LAUNCH_TEST_COACH_SLUG } from '@/lib/features'
import { createClient } from '@/lib/supabase/server'
import { publicPageMetadata } from '@/lib/public-page-metadata'
import MarketplaceClient, { type MarketplaceProduct } from './MarketplaceClient'
import { loadPublicCoaches } from '@/lib/publicCoaches'
import { aggregateProductRatings } from '@/lib/productRatings'
import HomeFounderStory from '@/components/HomeFounderStory'
import HomeTestimonials from '@/components/HomeTestimonials'
import { homeTestimonials } from './home-testimonials'

const editorialFont = localFont({
  src: './fonts/fraunces-600-latin.woff2',
  variable: '--font-fraunces',
  weight: '600',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
  preload: false,
})

export const dynamic = 'force-dynamic'

export const metadata = publicPageMetadata(
  '/',
  'Ardore – Coaching für Bewegung und Ernährung',
  'Entdecke Coaches und digitale Angebote für Fitness, Yoga, Pilates, Ernährung und Kampfsport.',
)

export default async function MarketplacePage() {
  const supabase = await createClient()

  const [productsData, coaches] = await Promise.all([
    supabase.from('products')
      .select('id, title, description, type, price, created_at, creator_id, thumbnail_url, categories, equipment, level, duration, show_sales_count, creator_profiles!inner(display_name, avatar_url, slug, category, categories)')
      .eq('is_published', true)
      .eq('creator_profiles.is_published', true)
      .eq('creator_profiles.is_demo', false)
      .neq('creator_profiles.slug', LAUNCH_TEST_COACH_SLUG)
      .order('created_at', { ascending: false }),
    loadPublicCoaches(),
  ])
  if (productsData.error) throw new Error('Angebote konnten nicht geladen werden')

  const products: MarketplaceProduct[] = (productsData.data ?? []).map((p: {
    id: string
    title: string
    description: string | null
    type: 'pdf' | 'video' | 'course' | 'image'
    price: number
    creator_id: string
    created_at: string
    thumbnail_url: string | null
    categories: string[] | null
    equipment: string[] | null
    level: string | null
    duration: string | null
    show_sales_count: boolean
    creator_profiles: { display_name: string; avatar_url: string | null; slug: string; category: string | null; categories: string[] } | { display_name: string; avatar_url: string | null; slug: string; category: string | null; categories: string[] }[]
  }) => {
    const cp = Array.isArray(p.creator_profiles) ? p.creator_profiles[0] : p.creator_profiles
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      type: p.type,
      price: p.price,
      createdAt: p.created_at,
      thumbnail_url: p.thumbnail_url ?? null,
      categories: p.categories ?? [],
      equipment: p.equipment ?? [],
      level: p.level ?? null,
      duration: p.duration ?? null,
      show_sales_count: p.show_sales_count,
      creator: {
        id: p.creator_id,
        display_name: cp?.display_name ?? '',
        avatar_url: cp?.avatar_url ?? null,
        slug: cp?.slug ?? '',
        category: cp?.category ?? null,
        categories: cp?.categories ?? [],
      },
    }
  })

  const productIds = products.map(p => p.id)

  const [salesRes, reviewsRes] = await Promise.all([
    productIds.length > 0
      ? supabase.rpc('get_public_product_sales_counts', { requested_product_ids: productIds })
      : Promise.resolve({ data: [] }),
    productIds.length > 0
      ? supabase.from('public_product_reviews').select('id, product_id, rating').in('product_id', productIds)
      : Promise.resolve({ data: [] }),
  ])

  const salesCounts: Record<string, number> = {}
  for (const { product_id, sales_count } of (salesRes.data ?? []) as { product_id: string; sales_count: number }[]) {
    salesCounts[product_id] = Number(sales_count)
  }

  const ratings = aggregateProductRatings(
    (reviewsRes.data ?? []) as { id: string; product_id: string; rating: number }[]
  )

  return (
    <div className={editorialFont.variable}>
      <MarketplaceClient
        coaches={coaches}
        products={products}
        salesCounts={salesCounts}
        ratings={ratings}
      >
        <HomeFounderStory />
        {homeTestimonials.length > 0 && <HomeTestimonials entries={homeTestimonials} />}
      </MarketplaceClient>
    </div>
  )
}
