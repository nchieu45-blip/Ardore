import { createClient } from '@/lib/supabase/server'

export interface CoachData {
  id: string
  slug: string
  display_name: string
  bio: string | null
  category: string | null
  categories: string[]
  qualifications: string[]
  languages: string[]
  is_verified: boolean
  avatar_url: string | null
  createdAt: string
  productCount: number
  rating: { avg: number; count: number } | null
  hasVideoCoaching: boolean
  hasGroupClasses: boolean
  coachingPrice: { price_cents: number; duration_minutes: number } | null
  hasSubscription: boolean
}

export async function loadPublicCoaches() {
  const supabase = await createClient()

  const { data: creatorsData, error: creatorsError } = await supabase
    .from('creator_profiles')
    .select(
      'id, slug, display_name, bio, category, categories, qualifications, languages, is_verified, avatar_url, created_at'
    )
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  if (creatorsError) throw new Error('Coaches konnten nicht geladen werden')

  const creators = (creatorsData ?? []) as {
    id: string
    slug: string
    display_name: string
    bio: string | null
    category: string | null
    categories: string[] | null
    qualifications: string[] | null
    languages: string[] | null
    is_verified: boolean
    avatar_url: string | null
    created_at: string
  }[]

  const creatorIds = creators.map((c) => c.id)

  const [
    productsRes,
    reviewsRes,
    coachingOffersRes,
    videoClassesRes,
    subscriptionsRes,
  ] = await Promise.all([
    creatorIds.length > 0
      ? supabase
          .from('products')
          .select('id, creator_id')
          .eq('is_published', true)
          .in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase.from('public_product_reviews').select('product_id, rating')
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase
          .from('coaching_offers')
          .select('creator_id, price_cents, duration_minutes')
          .eq('is_enabled', true)
          .in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase
          .from('video_classes')
          .select('creator_id')
          .eq('active', true)
          .in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
    creatorIds.length > 0
      ? supabase
          .from('subscription_tiers')
          .select('creator_id')
          .eq('is_active', true)
          .in('creator_id', creatorIds)
      : Promise.resolve({ data: [] }),
  ])

  const videoCoachingIds = new Set(
    (coachingOffersRes.data ?? []).map(
      (o: { creator_id: string }) => o.creator_id
    )
  )
  const groupClassIds = new Set(
    (videoClassesRes.data ?? []).map(
      (v: { creator_id: string }) => v.creator_id
    )
  )

  const subscriptionIds = new Set(
    (subscriptionsRes.data ?? []).map(
      (row: { creator_id: string }) => row.creator_id
    )
  )
  const coachingPrices = new Map<
    string,
    { price_cents: number; duration_minutes: number }
  >()
  for (const offer of (coachingOffersRes.data ?? []) as {
    creator_id: string
    price_cents: number
    duration_minutes: number
  }[]) {
    if (
      !Number.isFinite(offer.price_cents) ||
      offer.price_cents < 0 ||
      offer.duration_minutes <= 0
    )
      continue
    const current = coachingPrices.get(offer.creator_id)
    if (
      !current ||
      offer.price_cents < current.price_cents ||
      (offer.price_cents === current.price_cents &&
        offer.duration_minutes < current.duration_minutes)
    )
      coachingPrices.set(offer.creator_id, offer)
  }

  // product count per creator + product→creator lookup for ratings
  const productToCreator: Record<string, string> = {}
  const productCounts: Record<string, number> = {}
  for (const p of (productsRes.data ?? []) as {
    id: string
    creator_id: string
  }[]) {
    productToCreator[p.id] = p.creator_id
    productCounts[p.creator_id] = (productCounts[p.creator_id] ?? 0) + 1
  }

  // avg rating per creator, via product→creator map
  const ratingSums: Record<string, { sum: number; count: number }> = {}
  for (const r of (reviewsRes.data ?? []) as {
    product_id: string
    rating: number
  }[]) {
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

  const coaches: CoachData[] = creators.map((c) => ({
    id: c.id,
    slug: c.slug,
    display_name: c.display_name,
    bio: c.bio,
    category: c.category,
    categories: c.categories ?? [],
    qualifications: c.qualifications ?? [],
    languages: c.languages ?? [],
    is_verified: c.is_verified ?? false,
    avatar_url: c.avatar_url,
    createdAt: c.created_at,
    productCount: productCounts[c.id] ?? 0,
    rating: ratings[c.id] ?? null,
    hasVideoCoaching: videoCoachingIds.has(c.id),
    hasGroupClasses: groupClassIds.has(c.id),
    coachingPrice: coachingPrices.get(c.id) ?? null,
    hasSubscription: subscriptionIds.has(c.id),
  }))

  return coaches
}
