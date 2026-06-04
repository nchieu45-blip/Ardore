import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import CoachesPageClient from './CoachesPageClient'

export const metadata: Metadata = {
  title: 'Coaches entdecken',
  description: 'Finde deinen Coach: Fitness, Ernährung, Yoga, Mental Health und mehr. Durchsuche hunderte zertifizierter Coaches in Deutschland.',
  openGraph: {
    title: 'Coaches entdecken – Ardore',
    description: 'Finde den richtigen Coach für deine Ziele.',
  },
}

export interface CoachData {
  id: string
  slug: string
  display_name: string
  bio: string | null
  category: string | null
  categories: string[]
  avatar_url: string | null
  createdAt: string
  productCount: number
  rating: { avg: number; count: number } | null
}

export default async function CoachesPage() {
  const supabase = await createClient()

  const { data: creatorsData } = await supabase
    .from('creator_profiles')
    .select('id, slug, display_name, bio, category, categories, avatar_url, created_at')
    .order('created_at', { ascending: false })

  const creators = (creatorsData ?? []) as {
    id: string
    slug: string
    display_name: string
    bio: string | null
    category: string | null
    categories: string[] | null
    avatar_url: string | null
    created_at: string
  }[]

  const creatorIds = creators.map(c => c.id)

  const [productsRes, reviewsRes] = await Promise.all([
    creatorIds.length > 0
      ? supabase
          .from('products')
          .select('id, creator_id')
          .eq('is_published', true)
          .in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase
          .from('reviews')
          .select('product_id, rating')
      : Promise.resolve({ data: [] }),
  ])

  // product count per creator + product→creator lookup for ratings
  const productToCreator: Record<string, string> = {}
  const productCounts: Record<string, number> = {}
  for (const p of (productsRes.data ?? []) as { id: string; creator_id: string }[]) {
    productToCreator[p.id] = p.creator_id
    productCounts[p.creator_id] = (productCounts[p.creator_id] ?? 0) + 1
  }

  // avg rating per creator, via product→creator map
  const ratingSums: Record<string, { sum: number; count: number }> = {}
  for (const r of (reviewsRes.data ?? []) as { product_id: string; rating: number }[]) {
    const cid = productToCreator[r.product_id]
    if (!cid) continue
    if (!ratingSums[cid]) ratingSums[cid] = { sum: 0, count: 0 }
    ratingSums[cid].sum += r.rating
    ratingSums[cid].count++
  }
  const ratings: Record<string, { avg: number; count: number }> = {}
  for (const [id, { sum, count }] of Object.entries(ratingSums)) {
    ratings[id] = { avg: sum / count, count }
  }

  const coaches: CoachData[] = creators.map(c => ({
    id: c.id,
    slug: c.slug,
    display_name: c.display_name,
    bio: c.bio,
    category: c.category,
    categories: c.categories ?? [],
    avatar_url: c.avatar_url,
    createdAt: c.created_at,
    productCount: productCounts[c.id] ?? 0,
    rating: ratings[c.id] ?? null,
  }))

  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <CoachesPageClient coaches={coaches} />
    </Suspense>
  )
}
