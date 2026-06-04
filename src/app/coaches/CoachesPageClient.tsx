'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search, X, Star, Package, ArrowRight, Users, GraduationCap, Video,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import type { CoachData } from './page'

const CATEGORY_LABELS: Record<string, string> = {
  fitness:          'Fitness',
  ernaehrung:       'Ernährung',
  mental:           'Mental Health',
  abnehmen:         'Abnehmen',
  schlaf:           'Schlaf',
  yoga:             'Yoga',
  laufen:           'Laufen',
  krafttraining:    'Krafttraining',
  meditation:       'Meditation',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft:  'Schwangerschaft & Postnatal',
  mobility:         'Mobility & Dehnen',
  pilates:          'Pilates',
  muskelaufbau:     'Muskelaufbau',
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  fitness:          'from-orange-400 to-red-500',
  ernaehrung:       'from-green-400 to-emerald-600',
  mental:           'from-violet-400 to-purple-600',
  abnehmen:         'from-pink-400 to-rose-500',
  schlaf:           'from-blue-400 to-indigo-600',
  yoga:             'from-teal-400 to-cyan-600',
  laufen:           'from-amber-400 to-orange-500',
  krafttraining:    'from-gray-600 to-gray-800',
  meditation:       'from-violet-500 to-fuchsia-600',
  stressmanagement: 'from-sky-400 to-blue-600',
  rueckenschmerzen: 'from-red-400 to-orange-500',
  schwangerschaft:  'from-pink-300 to-rose-400',
  mobility:         'from-emerald-400 to-teal-600',
  pilates:          'from-purple-400 to-violet-600',
  muskelaufbau:     'from-zinc-500 to-gray-700',
}

const DEFAULT_GRADIENT = 'from-green-500 to-emerald-600'

type SortKey = 'newest' | 'most_products' | 'top_rated'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest',        label: 'Neueste' },
  { key: 'most_products', label: 'Meiste Produkte' },
  { key: 'top_rated',     label: 'Top bewertet' },
]

interface Props {
  coaches: CoachData[]
}

function CoachCard({ coach }: { coach: CoachData }) {
  const primaryCat = coach.categories[0] ?? coach.category
  const gradient   = primaryCat ? (CATEGORY_GRADIENTS[primaryCat] ?? DEFAULT_GRADIENT) : DEFAULT_GRADIENT
  const allCats    = coach.categories.length ? coach.categories : coach.category ? [coach.category] : []

  return (
    <Link href={`/creators/${coach.slug}`} className="group block h-full">
      <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-200 h-full flex flex-col">
        {/* Gradient banner */}
        <div className={`h-20 bg-gradient-to-br ${gradient} relative overflow-hidden flex-shrink-0`}>
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          <div className="absolute -bottom-4 -right-4 h-16 w-16 rounded-full bg-white/10" />
          <div className="absolute -top-4 left-1/3 h-12 w-12 rounded-full bg-white/10" />
          {coach.rating && (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full">
              <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
              <span className="text-[11px] font-bold text-white">{coach.rating.avg.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex flex-col flex-1">
          {/* Avatar overlapping banner */}
          <div className="-mt-7 mb-3">
            <Avatar
              src={coach.avatar_url}
              name={coach.display_name}
              size="lg"
              className="ring-4 ring-white shadow-md"
            />
          </div>

          {/* Name + category badges */}
          <div className="mb-2.5">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h3 className="font-bold text-gray-900 group-hover:text-green-700 transition-colors">
                {coach.display_name}
              </h3>
              {coach.qualifications.length > 0 && (
                <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  <GraduationCap className="h-3 w-3" />
                  Qualifiziert
                </span>
              )}
              {coach.hasVideoCoaching && (
                <span className="inline-flex items-center gap-1 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  <Video className="h-3 w-3" />
                  1:1 Sessions
                </span>
              )}
            </div>
            {allCats.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allCats.slice(0, 3).map(cat => (
                  <span
                    key={cat}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-100"
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </span>
                ))}
                {allCats.length > 3 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-100">
                    +{allCats.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Bio excerpt */}
          {coach.bio ? (
            <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed flex-1 mb-3">{coach.bio}</p>
          ) : (
            <p className="text-sm text-gray-300 italic flex-1 mb-3">Kein Bio vorhanden</p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5 text-gray-300" />
              {coach.productCount} {coach.productCount === 1 ? 'Produkt' : 'Produkte'}
            </span>
            {coach.rating && (
              <>
                <span className="text-gray-200">·</span>
                <span className="flex items-center gap-1 text-amber-500 font-medium">
                  <Star className="h-3.5 w-3.5 fill-amber-400" />
                  {coach.rating.avg.toFixed(1)}
                  <span className="font-normal text-gray-400">({coach.rating.count})</span>
                </span>
              </>
            )}
          </div>

          {/* CTA button */}
          <span className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold group-hover:bg-green-700 transition-colors">
            Profil ansehen
            <ArrowRight className="h-4 w-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </div>
      </div>
    </Link>
  )
}

export default function CoachesPageClient({ coaches }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const category = searchParams.get('category') ?? 'all'
  const sort     = (searchParams.get('sort') as SortKey) ?? 'newest'
  const [search, setSearch] = useState('')

  // Build available category list from actual coach data
  const availableCategories = [
    ...new Set(
      coaches.flatMap(c =>
        c.categories.length ? c.categories : c.category ? [c.category] : []
      )
    ),
  ].filter(cat => cat in CATEGORY_LABELS)

  function buildUrl(overrides: { category?: string; sort?: string } = {}): string {
    const cat = overrides.category ?? category
    const s   = overrides.sort ?? sort
    const params = new URLSearchParams()
    if (cat !== 'all')      params.set('category', cat)
    if (s !== 'newest')     params.set('sort', s)
    const qs = params.toString()
    return `/coaches${qs ? '?' + qs : ''}`
  }

  function go(overrides: Parameters<typeof buildUrl>[0]) {
    router.push(buildUrl(overrides), { scroll: false })
  }

  const filtered = coaches
    .filter(c => {
      const cats = c.categories.length ? c.categories : c.category ? [c.category] : []
      const matchesCat    = category === 'all' || cats.includes(category)
      const matchesSearch = !search
        || c.display_name.toLowerCase().includes(search.toLowerCase())
        || (c.bio ?? '').toLowerCase().includes(search.toLowerCase())
      return matchesCat && matchesSearch
    })
    .sort((a, b) => {
      switch (sort) {
        case 'newest':        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'most_products': return b.productCount - a.productCount
        case 'top_rated':     return (b.rating?.avg ?? -1) - (a.rating?.avg ?? -1)
      }
    })

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 py-16 px-4">
        <div className="pointer-events-none absolute -top-20 -right-20 h-80 w-80 rounded-full bg-green-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-green-100 text-xs font-medium px-3.5 py-1.5 rounded-full border border-white/20 mb-5">
            <Users className="h-3.5 w-3.5" />
            {coaches.length} geprüfte Coaches
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-3 tracking-tight leading-tight">
            Finde deinen Coach
          </h1>
          <p className="text-green-100/70 text-base mb-8 max-w-md mx-auto">
            Geprüfte Experten für Fitness, Ernährung, Mental Health und mehr
          </p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Coach suchen nach Name oder Bio..."
              className="w-full pl-12 pr-10 py-3.5 rounded-2xl text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 shadow-lg"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Sticky filter bar ─────────────────────────────────────── */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-2.5">
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {/* Category pills */}
            <button
              onClick={() => go({ category: 'all' })}
              className={cn(
                'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                category === 'all'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              )}
            >
              Alle
            </button>
            {availableCategories.map(cat => (
              <button
                key={cat}
                onClick={() => go({ category: category === cat ? 'all' : cat })}
                className={cn(
                  'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                  category === cat
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                )}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}

            {/* Sort options */}
            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0 pl-2">
              {SORT_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => go({ sort: key })}
                  className={cn(
                    'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                    sort === key
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500 mb-6">
          <span className="font-semibold text-gray-900">{filtered.length}</span>{' '}
          {filtered.length === 1 ? 'Coach' : 'Coaches'} gefunden
          {search && <span className="text-gray-400"> für „{search}"</span>}
        </p>

        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <Users className="h-7 w-7 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium mb-1">Keine Coaches gefunden</p>
            <p className="text-sm text-gray-400 mb-5">
              Versuche andere Filter oder einen anderen Suchbegriff.
            </p>
            <button
              onClick={() => { setSearch(''); go({ category: 'all', sort: 'newest' }) }}
              className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors"
            >
              Filter zurücksetzen
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(coach => (
              <CoachCard key={coach.id} coach={coach} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
