import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FavoritesPageClient from './FavoritesPageClient'
import type { ProductCardData } from '@/components/ui/ProductCard'

export const metadata = { title: 'Meine Favoriten' }

export default async function FavoritesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [productFavRes, coachFavRes] = await Promise.all([
    supabase
      .from('favorites')
      .select('item_id')
      .eq('user_id', user.id)
      .eq('item_type', 'product')
      .order('created_at', { ascending: false }),
    supabase
      .from('favorites')
      .select('item_id')
      .eq('user_id', user.id)
      .eq('item_type', 'coach')
      .order('created_at', { ascending: false }),
  ])

  const productIds = (productFavRes.data ?? []).map((f: { item_id: string }) => f.item_id)
  const coachIds   = (coachFavRes.data ?? []).map((f: { item_id: string }) => f.item_id)

  const [productsRes, coachesRes] = await Promise.all([
    productIds.length > 0
      ? supabase
          .from('products')
          .select('id, title, type, price, thumbnail_url, creator_id, creator_profiles!inner(id, display_name, avatar_url, slug, category, categories)')
          .in('id', productIds)
          .eq('is_published', true)
      : Promise.resolve({ data: [] }),
    coachIds.length > 0
      ? supabase
          .from('creator_profiles')
          .select('id, display_name, avatar_url, slug, category, categories, bio')
          .in('id', coachIds)
      : Promise.resolve({ data: [] }),
  ])

  type RawProduct = {
    id: string
    title: string
    type: 'pdf' | 'video' | 'course' | 'image'
    price: number
    thumbnail_url: string | null
    creator_id: string
    creator_profiles:
      | { id: string; display_name: string; avatar_url: string | null; slug: string; category: string | null; categories: string[] }
      | { id: string; display_name: string; avatar_url: string | null; slug: string; category: string | null; categories: string[] }[]
  }

  const productMap = new Map(
    ((productsRes.data ?? []) as RawProduct[]).map(p => {
      const cp = Array.isArray(p.creator_profiles) ? p.creator_profiles[0] : p.creator_profiles
      const product: ProductCardData = {
        id: p.id,
        title: p.title,
        type: p.type,
        price: p.price,
        thumbnail_url: p.thumbnail_url ?? null,
        creator: {
          id: cp?.id ?? p.creator_id,
          display_name: cp?.display_name ?? '',
          avatar_url: cp?.avatar_url ?? null,
          slug: cp?.slug ?? '',
          category: cp?.category ?? null,
          categories: cp?.categories ?? [],
        },
      }
      return [p.id, product]
    })
  )

  const products: ProductCardData[] = productIds
    .map(id => productMap.get(id))
    .filter((p): p is ProductCardData => !!p)

  type RawCoach = {
    id: string
    display_name: string
    avatar_url: string | null
    slug: string
    category: string | null
    categories: string[] | null
    bio: string | null
  }

  const coachMap = new Map(
    ((coachesRes.data ?? []) as RawCoach[]).map(c => [c.id, c])
  )

  const coaches = coachIds
    .map(id => coachMap.get(id))
    .filter((c): c is RawCoach => !!c)
    .map(c => ({
      id: c.id,
      display_name: c.display_name,
      avatar_url: c.avatar_url,
      slug: c.slug,
      category: c.category,
      categories: c.categories ?? [],
      bio: c.bio,
    }))

  return <FavoritesPageClient products={products} coaches={coaches} />
}
