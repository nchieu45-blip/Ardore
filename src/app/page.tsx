import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import MarketplaceClient, { type MarketplaceProduct } from './MarketplaceClient'
import type { CoachingCoach } from './MarketplaceRows'

export const metadata: Metadata = {
  title: 'Ardore – Fitness & Gesundheitscoaches',
  description: 'Entdecke Trainingspläne, Kurse und Ernährungsberatung von den besten Coaches Deutschlands. Starte heute mit deinem Fitnessziel.',
}

export default async function MarketplacePage() {
  const supabase = await createClient()

  const [productsData, coachingOffersData] = await Promise.all([
    supabase
      .from('products')
      .select('id, title, description, type, price, created_at, creator_id, thumbnail_url, equipment, level, duration, creator_profiles!inner(display_name, avatar_url, slug, category, categories)')
      .eq('is_published', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('coaching_offers')
      .select('creator_id, price_cents, duration_minutes, creator_profiles(id, slug, display_name, avatar_url, category, categories)')
      .eq('is_enabled', true)
      .order('price_cents', { ascending: true })
      .limit(20),
  ])

  const products: MarketplaceProduct[] = (productsData.data ?? []).map((p: {
    id: string
    title: string
    description: string | null
    type: 'pdf' | 'video' | 'course' | 'image'
    price: number
    creator_id: string
    created_at: string
    thumbnail_url: string | null
    equipment: string[] | null
    level: string | null
    duration: string | null
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
      equipment: p.equipment ?? [],
      level: p.level ?? null,
      duration: p.duration ?? null,
      creator: {
        display_name: cp?.display_name ?? '',
        avatar_url: cp?.avatar_url ?? null,
        slug: cp?.slug ?? '',
        category: cp?.category ?? null,
        categories: cp?.categories ?? [],
      },
    }
  })

  const coachingCoaches: CoachingCoach[] = (coachingOffersData.data ?? []).flatMap((o: {
    creator_id: string
    price_cents: number
    duration_minutes: number
    creator_profiles: { id: string; slug: string; display_name: string; avatar_url: string | null; category: string | null; categories: string[] | null } | { id: string; slug: string; display_name: string; avatar_url: string | null; category: string | null; categories: string[] | null }[] | null
  }) => {
    const cp = Array.isArray(o.creator_profiles) ? o.creator_profiles[0] : o.creator_profiles
    if (!cp) return []
    return [{
      id:               cp.id,
      slug:             cp.slug,
      display_name:     cp.display_name,
      avatar_url:       cp.avatar_url,
      category:         cp.category,
      categories:       cp.categories ?? [],
      price_cents:      o.price_cents,
      duration_minutes: o.duration_minutes,
    }]
  })

  const productIds = products.map(p => p.id)

  const [salesRes, reviewsRes] = await Promise.all([
    productIds.length > 0
      ? supabase.from('purchases').select('product_id').in('product_id', productIds)
      : Promise.resolve({ data: [] }),
    productIds.length > 0
      ? supabase.from('reviews').select('product_id, rating').in('product_id', productIds)
      : Promise.resolve({ data: [] }),
  ])

  const salesCounts: Record<string, number> = {}
  for (const { product_id } of (salesRes.data ?? []) as { product_id: string }[]) {
    salesCounts[product_id] = (salesCounts[product_id] ?? 0) + 1
  }

  const ratingSums: Record<string, { sum: number; count: number }> = {}
  for (const r of (reviewsRes.data ?? []) as { product_id: string; rating: number }[]) {
    if (!ratingSums[r.product_id]) ratingSums[r.product_id] = { sum: 0, count: 0 }
    ratingSums[r.product_id].sum += r.rating
    ratingSums[r.product_id].count++
  }
  const ratings: Record<string, { avg: number; count: number }> = {}
  for (const [id, { sum, count }] of Object.entries(ratingSums)) {
    ratings[id] = { avg: sum / count, count }
  }

  return (
    <MarketplaceClient
      products={products}
      salesCounts={salesCounts}
      ratings={ratings}
      coachingCoaches={coachingCoaches}
    />
  )
}
