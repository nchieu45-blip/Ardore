import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import type { MarketplaceProduct } from '@/app/MarketplaceClient'
import MarketplacePageClient from './MarketplacePageClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Marketplace',
  description: 'Entdecke Trainingspläne, Ernährungspläne, Video-Kurse und mehr von qualifizierten Coaches.',
  openGraph: {
    title: 'Marketplace – Ardore',
    description: 'Digitale Produkte von Fitness- und Gesundheitscoaches.',
  },
}

export default async function MarketplacePage() {
  const supabase = await createClient()

  const { data: productsData } = await supabase
    .from('products')
    .select('id, title, description, type, price, created_at, creator_id, thumbnail_url, categories, equipment, level, duration, show_sales_count, creator_profiles!inner(display_name, avatar_url, slug, category, categories)')
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
    categories: string[] | null
    equipment: string[] | null
    level: string | null
    duration: string | null
    show_sales_count: boolean
    creator_profiles:
      | { display_name: string; avatar_url: string | null; slug: string; category: string | null; categories: string[] }
      | { display_name: string; avatar_url: string | null; slug: string; category: string | null; categories: string[] }[]
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

  const productIds  = products.map(p => p.id)
  const creatorIds  = [...new Set(products.map(p => p.creator.id))]

  const [salesRes, reviewsRes, coachingRes, videoClassesRes] = await Promise.all([
    productIds.length > 0
      ? supabase.from('purchases').select('product_id').in('product_id', productIds)
      : Promise.resolve({ data: [] }),
    productIds.length > 0
      ? supabase.from('reviews').select('product_id, rating').in('product_id', productIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase.from('coaching_offers').select('creator_id').eq('is_enabled', true).in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase.from('video_classes').select('creator_id').eq('active', true).in('creator_id', creatorIds)
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

  const coachingCreatorIds = new Set(
    (coachingRes.data ?? []).map((o: { creator_id: string }) => o.creator_id)
  )
  const videoClassCreatorIds = new Set(
    (videoClassesRes.data ?? []).map((v: { creator_id: string }) => v.creator_id)
  )
  const productsWithFlags = products.map(p => ({
    ...p,
    creatorHasCoaching:    coachingCreatorIds.has(p.creator.id),
    creatorHasVideoClasses: videoClassCreatorIds.has(p.creator.id),
  }))

  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <MarketplacePageClient products={productsWithFlags} salesCounts={salesCounts} ratings={ratings} />
    </Suspense>
  )
}
