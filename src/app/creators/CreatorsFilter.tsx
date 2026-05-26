'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Search } from 'lucide-react'
import Link from 'next/link'

const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  mental: 'Mental Health',
  abnehmen: 'Abnehmen',
  schlaf: 'Schlaf',
  yoga: 'Yoga',
  laufen: 'Laufen',
  krafttraining: 'Krafttraining',
  meditation: 'Meditation',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft: 'Schwangerschaft & Postnatal',
  mobility: 'Mobility & Dehnen',
}

interface Creator {
  id: string
  slug: string
  display_name: string
  bio: string | null
  category: string | null
  avatar_url: string | null
}

interface Props {
  creators: Creator[]
  categories: string[]
}

export default function CreatorsFilter({ creators, categories }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = creators.filter(c => {
    const matchesCategory = !activeCategory || c.category === activeCategory
    const matchesSearch = !search || c.display_name.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div>
      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Coach suchen..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            !activeCategory
              ? 'bg-black text-white border-black'
              : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
          }`}
        >
          Alle
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeCategory === cat
                ? 'bg-black text-white border-black'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
            }`}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">Keine Coaches gefunden.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(creator => (
            <Link key={creator.id} href={`/creators/${creator.slug}`}>
              <Card hover className="overflow-hidden h-full">
                <div className="h-20 bg-gradient-to-br from-green-400 to-green-600" />
                <div className="p-5">
                  <div className="-mt-10 mb-3">
                    <Avatar src={creator.avatar_url} name={creator.display_name} size="lg" className="ring-4 ring-white" />
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
