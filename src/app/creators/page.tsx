import { createClient } from '@/lib/supabase/server'
import TopCoachesSection from './TopCoachesSection'
import CreatorsFilter from './CreatorsFilter'

export default async function CreatorsPage() {
  const supabase = await createClient()

  const { data: creators } = await supabase
    .from('creator_profiles')
    .select('id, slug, display_name, bio, category, avatar_url')
    .order('created_at', { ascending: false })

  const creatorList = creators ?? []

  const categories = [...new Set(
    creatorList.map((c: { category: string | null }) => c.category).filter(Boolean) as string[]
  )]

  // Compute top coaches by total product sales
  const creatorIds = creatorList.map((c: { id: string }) => c.id)
  const { data: salesData } = creatorIds.length > 0
    ? await supabase
        .from('purchases')
        .select('products!inner(creator_id)')
        .in('products.creator_id', creatorIds)
    : { data: [] }

  const salesCounts: Record<string, number> = {}
  for (const row of (salesData ?? []) as unknown as { products: { creator_id: string } }[]) {
    const id = row.products?.creator_id
    if (id) salesCounts[id] = (salesCounts[id] ?? 0) + 1
  }

  const hasSales = Object.keys(salesCounts).length > 0
  const topCoaches = hasSales
    ? [...creatorList]
        .filter((c: { id: string }) => salesCounts[c.id])
        .sort((a: { id: string }, b: { id: string }) => (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0))
        .slice(0, 3)
        .map((c: { id: string; slug: string; display_name: string; bio: string | null; category: string | null; avatar_url: string | null }, i: number) => ({ ...c, rank: i + 1 }))
    : []

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Coaches entdecken</h1>
        <p className="text-gray-500">Finde die besten Fitness- und Gesundheitsexperten</p>
      </div>

      <TopCoachesSection coaches={topCoaches} />

      <CreatorsFilter creators={creatorList} categories={categories} />
    </div>
  )
}
