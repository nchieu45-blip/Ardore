import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import MarketplaceClient, { type MarketplaceProduct } from './MarketplaceClient'
import { loadPublicCoaches } from '@/lib/publicCoaches'
import { aggregateProductRatings } from '@/lib/productRatings'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ardore – Fitness & Gesundheitscoaches',
  description: 'Finde Coaches, persönliches Coaching und digitale Produkte für Fitness, Ernährung und Wohlbefinden auf Ardore.',
}

export default async function MarketplacePage() {
  const supabase = await createClient()

  const [productsData, coaches] = await Promise.all([
    supabase.from('products')
      .select('id, title, description, type, price, created_at, creator_id, thumbnail_url, categories, equipment, level, duration, show_sales_count, creator_profiles!inner(display_name, avatar_url, slug, category, categories)')
      .eq('is_published', true)
      .eq('creator_profiles.is_published', true)
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
    <MarketplaceClient
      coaches={coaches}
      products={products}
      salesCounts={salesCounts}
      ratings={ratings}
    />
  )
}
