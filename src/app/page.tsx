import { createClient } from '@/lib/supabase/server'
import MarketplaceClient, { type MarketplaceProduct } from './MarketplaceClient'

export default async function MarketplacePage() {
  const supabase = await createClient()

  const { data: productsData } = await supabase
    .from('products')
    .select('id, title, description, type, price, creator_id, creator_profiles!inner(display_name, avatar_url, slug)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  const products: MarketplaceProduct[] = (productsData ?? []).map((p: {
    id: string
    title: string
    description: string | null
    type: 'pdf' | 'video' | 'course' | 'image'
    price: number
    creator_id: string
    creator_profiles: { display_name: string; avatar_url: string | null; slug: string } | { display_name: string; avatar_url: string | null; slug: string }[]
  }) => {
    const cp = Array.isArray(p.creator_profiles) ? p.creator_profiles[0] : p.creator_profiles
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      type: p.type,
      price: p.price,
      creator: {
        display_name: cp?.display_name ?? '',
        avatar_url: cp?.avatar_url ?? null,
        slug: cp?.slug ?? '',
      },
    }
  })

  // Compute bestsellers from purchase counts
  const productIds = products.map(p => p.id)
  const { data: salesData } = productIds.length > 0
    ? await supabase.from('purchases').select('product_id').in('product_id', productIds)
    : { data: [] }

  const salesCounts: Record<string, number> = {}
  for (const { product_id } of (salesData ?? []) as { product_id: string }[]) {
    salesCounts[product_id] = (salesCounts[product_id] ?? 0) + 1
  }

  const bestsellers = Object.keys(salesCounts).length > 0
    ? [...products]
        .filter(p => salesCounts[p.id])
        .sort((a, b) => (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0))
        .slice(0, 4)
    : []

  return <MarketplaceClient products={products} bestsellers={bestsellers} />
}
