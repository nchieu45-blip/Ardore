'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search, X, ChevronDown, Check, SlidersHorizontal, Filter,
} from 'lucide-react'
import { ProductCard } from '@/components/ui/ProductCard'
import { EQUIPMENT_OPTIONS, LEVEL_OPTIONS, DURATION_OPTIONS } from '@/lib/productOptions'
import type { MarketplaceProduct } from '@/app/MarketplaceClient'
import { cn } from '@/lib/utils'
import { CATEGORY_GROUPS, ALL_CATEGORIES, CATEGORY_LABEL_MAP } from '@/lib/categories'

type ProductType = 'pdf' | 'video' | 'course' | 'image'
type SortKey = 'popular' | 'newest' | 'price_asc' | 'price_desc' | 'top_rated' | 'best_selling'

const TYPE_OPTIONS: { key: 'all' | ProductType; label: string }[] = [
  { key: 'all',    label: 'Alle' },
  { key: 'pdf',    label: 'PDF' },
  { key: 'video',  label: 'Video' },
  { key: 'course', label: 'Kurs' },
  { key: 'image',  label: 'Bild' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'popular',      label: 'Beliebteste' },
  { key: 'best_selling', label: 'Meistverkauft' },
  { key: 'top_rated',    label: 'Best bewertet' },
  { key: 'newest',       label: 'Neueste' },
  { key: 'price_asc',    label: 'Preis ↑' },
  { key: 'price_desc',   label: 'Preis ↓' },
]

const PAGE_SIZE = 20

interface Props {
  products: MarketplaceProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
}

export default function MarketplacePageClient({ products, salesCounts, ratings }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Filter state derived from URL — keeps back/forward navigation in sync
  const category  = searchParams.get('category') ?? 'all'
  const type      = (searchParams.get('type') as 'all' | ProductType) ?? 'all'
  const sort      = (searchParams.get('sort') as SortKey) ?? 'popular'
  const level     = searchParams.get('level')
  const equipment = searchParams.get('equipment')?.split(',').filter(Boolean) ?? []
  const duration  = searchParams.get('duration')
  const page      = Number(searchParams.get('page') ?? 1)

  // Search is local only (instant, not persisted to URL)
  const [search, setSearch] = useState('')

  const [categoryOpen, setCategoryOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const categoryRef = useRef<HTMLDivElement>(null)

  function toggleGroup(label: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setCategoryOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // Build a /marketplace URL from current params + overrides
  function buildUrl(overrides: {
    category?: string
    type?: string
    sort?: string
    level?: string | null
    equipment?: string[]
    duration?: string | null
    page?: number
  } = {}): string {
    const cat = overrides.category ?? category
    const t   = overrides.type     ?? type
    const s   = overrides.sort     ?? sort
    const l   = 'level'    in overrides ? overrides.level    : level
    const eq  = overrides.equipment ?? equipment
    const d   = 'duration' in overrides ? overrides.duration : duration
    const pg  = overrides.page ?? page

    const params = new URLSearchParams()
    if (cat !== 'all') params.set('category', cat)
    if (t !== 'all')   params.set('type', t)
    if (s !== 'popular') params.set('sort', s)
    if (l)             params.set('level', l)
    if (eq.length > 0) params.set('equipment', eq.join(','))
    if (d)             params.set('duration', d)
    if (pg > 1)        params.set('page', String(pg))

    const qs = params.toString()
    return `/marketplace${qs ? '?' + qs : ''}`
  }

  function go(overrides: Parameters<typeof buildUrl>[0]) {
    router.push(buildUrl(overrides), { scroll: false })
  }

  // Filtering + sorting (client-side against the full product list)
  const filtered = products
    .filter(p => {
      const matchesCat      = category === 'all' || (p.categories ?? []).includes(category) || (p.creator.categories ?? []).includes(category) || p.creator.category === category
      const matchesType     = type === 'all' || p.type === type
      const matchesSearch   = !search
        || p.title.toLowerCase().includes(search.toLowerCase())
        || p.creator.display_name.toLowerCase().includes(search.toLowerCase())
      const matchesEquip    = equipment.length === 0 || equipment.some(e => p.equipment.includes(e))
      const matchesLevel    = !level    || p.level === level
      const matchesDuration = !duration || p.duration === duration
      return matchesCat && matchesType && matchesSearch && matchesEquip && matchesLevel && matchesDuration
    })
    .sort((a, b) => {
      switch (sort) {
        case 'popular':
        case 'best_selling': return (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
        case 'top_rated':    return (ratings[b.id]?.avg ?? 0) - (ratings[a.id]?.avg ?? 0)
        case 'newest':       return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'price_asc':    return a.price - b.price
        case 'price_desc':   return b.price - a.price
      }
    })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageItems  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const activeFilterCount = [
    category !== 'all',
    type !== 'all',
    sort !== 'popular',
    !!level,
    equipment.length > 0,
    !!duration,
  ].filter(Boolean).length

  function resetAll() {
    setSearch('')
    router.push('/marketplace', { scroll: false })
  }

  function goToPage(p: number) {
    go({ page: p })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-12 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Alle Produkte entdecken
          </h1>
          <p className="text-gray-400 text-sm mb-7">
            {products.length} Produkte von geprüften Coaches
          </p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value) }}
              placeholder="Produkte oder Coaches suchen..."
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
          <div className="flex items-center gap-2">

            {/* Category dropdown — outside the overflow-x-auto so the menu isn't clipped */}
            <div ref={categoryRef} className="relative flex-shrink-0">
              <button
                onClick={() => {
                  console.log('[Marketplace] categoryOpen toggled, was:', categoryOpen, 'ALL_CATEGORIES.length:', ALL_CATEGORIES.length)
                  setCategoryOpen(o => !o)
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                  category !== 'all'
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                )}
              >
                {category === 'all' ? 'Alle Kategorien' : (CATEGORY_LABEL_MAP[category] ?? 'Kategorie')}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', categoryOpen && 'rotate-180')} />
              </button>
              {categoryOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 z-50 max-h-96 overflow-y-auto animate-scale-in">
                  {/* "Alle Kategorien" reset row */}
                  <button
                    onClick={() => { setCategoryOpen(false); setSearch(''); router.push('/marketplace', { scroll: false }) }}
                    className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Alle Kategorien
                    {category === 'all' && <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />}
                  </button>

                  {CATEGORY_GROUPS.map((group, gi) => {
                    const isOpen = openGroups.has(group.label)
                    return (
                      <div key={group.label}>
                        <div className={cn('mx-4 border-t border-gray-100', gi === 0 ? 'mt-1' : '')} />
                        <button
                          onClick={() => toggleGroup(group.label)}
                          className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {group.label}
                          <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', isOpen && 'rotate-180')} />
                        </button>
                        {isOpen && group.items.map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() => { setCategoryOpen(false); go({ category: key, page: 1 }) }}
                            className="w-full flex items-center justify-between px-6 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            {label}
                            {category === key && <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="h-4 w-px bg-gray-200 flex-shrink-0" />

            {/* Type pills — inside a separate overflow-x-auto so they scroll on mobile without clipping the dropdown above */}
            <div className="flex items-center gap-2 overflow-x-auto flex-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {TYPE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => go({ type: key, page: 1 })}
                className={cn(
                  'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                  type === key
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                )}
              >
                {label}
              </button>
            ))}

            {/* Right side: advanced + sort + reset */}
            <div className="ml-auto flex items-center gap-2 flex-shrink-0 pl-2">
              <button
                onClick={() => setAdvancedOpen(o => !o)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                  (level || equipment.length > 0 || duration)
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filter
                {(level || equipment.length > 0 || duration) && (
                  <span className="ml-0.5 h-4 w-4 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {[!!level, equipment.length > 0, !!duration].filter(Boolean).length}
                  </span>
                )}
              </button>

              <div className="relative flex-shrink-0">
                <select
                  value={sort}
                  onChange={e => go({ sort: e.target.value, page: 1 })}
                  className="appearance-none pl-3 pr-7 py-1.5 text-xs border border-gray-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer"
                >
                  {SORT_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
              </div>

              {(activeFilterCount > 0 || search) && (
                <button
                  onClick={resetAll}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors whitespace-nowrap"
                >
                  <X className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
            </div>{/* end inner scrollable */}
          </div>

          {/* Advanced filter panel */}
          {advancedOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-4 pb-2">
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Equipment</p>
                <div className="flex flex-wrap gap-1.5">
                  {EQUIPMENT_OPTIONS.map(opt => {
                    const active = equipment.includes(opt.value)
                    const newEq  = active ? equipment.filter(v => v !== opt.value) : [...equipment, opt.value]
                    return (
                      <button
                        key={opt.value}
                        onClick={() => go({ equipment: newEq, page: 1 })}
                        className={cn(
                          'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-all',
                          active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        )}
                      >
                        {active && <Check className="h-3 w-3" />}
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-8">
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Level</p>
                  <div className="flex gap-1.5">
                    {LEVEL_OPTIONS.map(opt => {
                      const active = level === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => go({ level: active ? null : opt.value, page: 1 })}
                          className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                            active ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                          )}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Dauer</p>
                  <div className="flex gap-1.5">
                    {DURATION_OPTIONS.map(opt => {
                      const active = duration === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => go({ duration: active ? null : opt.value, page: 1 })}
                          className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                            active ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                          )}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Count + active-filter badge */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{filtered.length}</span>{' '}
            {filtered.length === 1 ? 'Produkt' : 'Produkte'} gefunden
            {search && <span className="text-gray-400"> für „{search}"</span>}
          </p>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-100 font-medium">
              <Filter className="h-3 w-3" />
              {activeFilterCount} {activeFilterCount === 1 ? 'Filter aktiv' : 'Filter aktiv'}
            </span>
          )}
        </div>

        {/* Grid */}
        {pageItems.length === 0 ? (
          <div className="text-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <Search className="h-7 w-7 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium mb-1">Keine Produkte gefunden</p>
            <p className="text-sm text-gray-400 mb-5">
              Versuche andere Filter oder einen anderen Suchbegriff.
            </p>
            <button
              onClick={resetAll}
              className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors"
            >
              Alle Filter zurücksetzen
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {pageItems.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                salesCount={salesCounts[product.id]}
                rating={ratings[product.id]}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10 flex-wrap">
            <button
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage === 1}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Zurück
            </button>

            {(() => {
              const pages: number[] = []
              const range = 2
              for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= safePage - range && i <= safePage + range)) {
                  pages.push(i)
                }
              }
              const nodes: React.ReactNode[] = []
              let prev = 0
              for (const p of pages) {
                if (p - prev > 1) {
                  nodes.push(<span key={`gap-${p}`} className="px-1 text-gray-400 text-sm select-none">…</span>)
                }
                nodes.push(
                  <button
                    key={p}
                    onClick={() => goToPage(p)}
                    className={cn(
                      'w-9 h-9 rounded-xl text-sm font-medium transition-colors',
                      safePage === p
                        ? 'bg-green-600 text-white shadow-sm'
                        : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {p}
                  </button>
                )
                prev = p
              }
              return nodes
            })()}

            <button
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage === totalPages}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Weiter →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
