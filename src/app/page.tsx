import { createClient } from '@/lib/supabase/server'
import MarketplaceClient, { type MarketplaceProduct } from './MarketplaceClient'

export default async function MarketplacePage() {
  const supabase = await createClient()

  const { data: productsData } = await supabase
    .from('products')
    .select('id, title, description, type, price, created_at, creator_id, thumbnail_url, equipment, level, duration, creator_profiles!inner(display_name, avatar_url, slug, category, categories)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  const products: MarketplaceProduct[] = (productsData ?? []).map((p: {
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

  return <MarketplaceClient products={products} salesCounts={salesCounts} ratings={ratings} />
}
