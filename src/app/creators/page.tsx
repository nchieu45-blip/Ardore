import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import Link from 'next/link'
import { Search } from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  yoga: 'Yoga',
  mental: 'Mental Health',
  laufen: 'Laufen',
  abnehmen: 'Abnehmen',
  muskelaufbau: 'Muskelaufbau',
  allgemein: 'Gesundheit',
}

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kategorie?: string }>
}) {
  const { q, kategorie } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('creator_profiles')
    .select('*, profile:profiles(full_name, avatar_url)')
    .order('created_at', { ascending: false })

  if (kategorie) query = query.eq('category', kategorie)
  if (q) query = query.ilike('display_name', `%${q}%`)

  const { data: creators } = await query
  const creatorList = creators ?? []

  const { data: allCreators } = await supabase
    .from('creator_profiles')
    .select('category')

  const categories = [...new Set((allCreators ?? []).map((c: { category: string | null }) => c.category).filter(Boolean))]

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Coaches entdecken</h1>
        <p className="text-gray-500">Finde die besten Fitness- und Gesundheitsexperten</p>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <form className="flex-1 relative" method="GET">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Coach suchen..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {kategorie && <input type="hidden" name="kategorie" value={kategorie} />}
        </form>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/creators"
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${!kategorie ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 text-gray-600 hover:border-green-400'}`}
          >
            Alle
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat}
              href={`/creators?kategorie=${cat}`}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${kategorie === cat ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 text-gray-600 hover:border-green-400'}`}
            >
              {CATEGORY_LABELS[cat as string] ?? cat}
            </Link>
          ))}
        </div>
      </div>

      {creatorList.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">Keine Coaches gefunden.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {creatorList.map((creator: {
            id: string
            slug: string
            display_name: string
            bio: string | null
            category: string | null
            avatar_url: string | null
          }) => (
            <Link key={creator.id} href={`/creators/${creator.slug}`}>
              <Card hover className="overflow-hidden h-full">
                <div className="h-20 bg-gradient-to-br from-green-400 to-green-600" />
                <div className="p-5">
                  <div className="-mt-10 mb-3">
                    <Avatar
                      src={creator.avatar_url}
                      name={creator.display_name}
                      size="lg"
                      className="ring-4 ring-white"
                    />
                  </div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900">{creator.display_name}</h3>
                    {creator.category && (
                      <Badge variant="success" className="flex-shrink-0">
                        {CATEGORY_LABELS[creator.category] ?? creator.category}
                      </Badge>
                    )}
                  </div>
                  {creator.bio && (
                    <p className="text-sm text-gray-500 line-clamp-2">{creator.bio}</p>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
