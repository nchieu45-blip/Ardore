'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Search, Users } from 'lucide-react'
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
  pilates: 'Pilates',
  muskelaufbau: 'Muskelaufbau',
}

const CATEGORY_COLORS: Record<string, string> = {
  fitness: 'from-orange-400 to-red-500',
  ernaehrung: 'from-green-400 to-emerald-600',
  mental: 'from-violet-400 to-purple-600',
  abnehmen: 'from-pink-400 to-rose-500',
  schlaf: 'from-blue-400 to-indigo-600',
  yoga: 'from-teal-400 to-cyan-600',
  laufen: 'from-amber-400 to-orange-500',
  krafttraining: 'from-gray-600 to-gray-800',
  meditation: 'from-violet-500 to-fuchsia-600',
  stressmanagement: 'from-sky-400 to-blue-600',
  rueckenschmerzen: 'from-red-400 to-orange-500',
  schwangerschaft: 'from-pink-300 to-rose-400',
  mobility: 'from-emerald-400 to-teal-600',
  pilates: 'from-purple-400 to-violet-600',
  muskelaufbau: 'from-zinc-500 to-gray-700',
}

const DEFAULT_GRADIENT = 'from-green-400 to-green-600'

interface Creator {
  id: string
  slug: string
  display_name: string
  bio: string | null
  category: string | null
  categories: string[] | null
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
    const cats = c.categories?.length ? c.categories : c.category ? [c.category] : []
    const matchesCategory = !activeCategory || cats.includes(activeCategory)
    const matchesSearch = !search || c.display_name.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="animate-slide-up">
      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Coach suchen..."
          className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white shadow-sm"
        />
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 ${
            !activeCategory
              ? 'bg-gray-900 text-white shadow-sm'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-400 hover:text-gray-900'
          }`}
        >
          Alle
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 ${
              activeCategory === cat
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400 font-medium mb-5 uppercase tracking-wide">
        {filtered.length} {filtered.length === 1 ? 'Coach' : 'Coaches'}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <Users className="h-7 w-7 text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium mb-1">Keine Coaches gefunden</p>
          <p className="text-sm text-gray-400">Versuche andere Filter oder einen anderen Suchbegriff.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((creator, i) => {
            const primaryCat = creator.categories?.[0] ?? creator.category ?? null
            const gradient = primaryCat ? (CATEGORY_COLORS[primaryCat] ?? DEFAULT_GRADIENT) : DEFAULT_GRADIENT
            const allCats = creator.categories?.length ? creator.categories : creator.category ? [creator.category] : []
            return (
              <Link key={creator.id} href={`/creators/${creator.slug}`}>
                <div
                  className="group rounded-2xl overflow-hidden border border-gray-100 bg-white h-full transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-gray-200"
                  style={{ animationDelay: `${Math.min(i * 50, 400)}ms` }}
                >
                  <div className={`h-24 bg-gradient-to-br ${gradient} relative overflow-hidden`}>
                    <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition-colors" />
                    <div className="absolute -bottom-1 -right-4 h-20 w-20 rounded-full bg-white/10" />
                    <div className="absolute -top-4 -left-4 h-16 w-16 rounded-full bg-white/10" />
                  </div>
                  <div className="p-5">
                    <div className="-mt-11 mb-3">
                      <Avatar src={creator.avatar_url} name={creator.display_name} size="lg" className="ring-4 ring-white shadow-md" />
                    </div>
                    <div className="mb-2">
                      <h3 className="font-bold text-gray-900 group-hover:text-green-700 transition-colors mb-1.5">{creator.display_name}</h3>
                      {allCats.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {allCats.slice(0, 3).map(cat => (
                            <Badge key={cat} variant="success" className="text-[10px]">
                              {CATEGORY_LABELS[cat] ?? cat}
                            </Badge>
                          ))}
                          {allCats.length > 3 && (
                            <Badge variant="default" className="text-[10px]">+{allCats.length - 3}</Badge>
                          )}
                        </div>
                      )}
                    </div>
                    {creator.bio ? (
                      <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">{creator.bio}</p>
                    ) : (
                      <p className="text-sm text-gray-300 italic">Kein Bio vorhanden</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-gray-50">
                      <span className="text-xs text-green-600 font-medium group-hover:underline">Profil ansehen →</span>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
