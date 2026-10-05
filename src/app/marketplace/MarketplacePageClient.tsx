'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search,
  X,
  ChevronDown,
  Check,
  SlidersHorizontal,
  Filter,
} from 'lucide-react'
import Link from 'next/link'
import {
  DiscoveryNavigation,
  discoveryHref,
} from '@/components/ui/DiscoveryNavigation'
import { StatePanel } from '@/components/ui/StatePanel'
import { Button } from '@/components/ui/Button'
import { ProductCard } from '@/components/ui/ProductCard'
import {
  EQUIPMENT_OPTIONS,
  LEVEL_OPTIONS,
  DURATION_OPTIONS,
} from '@/lib/productOptions'
import type { MarketplaceProduct } from '@/app/MarketplaceClient'
import { cn } from '@/lib/utils'
import { CATEGORY_GROUPS, CATEGORY_LABEL_MAP } from '@/lib/categories'
import { compareProductRatings } from '@/lib/productRatings'

type ProductType = 'pdf' | 'video' | 'course' | 'image'
type SortKey =
  | 'popular'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'top_rated'
  | 'best_selling'

const TYPE_OPTIONS: { key: 'all' | ProductType; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'pdf', label: 'PDF-Produkte' },
  { key: 'video', label: 'Video' },
  { key: 'course', label: 'Online-Kurse' },
  { key: 'image', label: 'Bildmaterial' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'top_rated', label: 'Best bewertet' },
  // Keep disabled until refunds/disputes/chargebacks are reconciled with
  // purchase validity, production/test purchase contamination is ruled out,
  // and Best Selling has a ranking definition distinct from Popular.
  // { key: 'best_selling', label: 'Meistverkauft' },
  { key: 'newest', label: 'Neueste' },
  { key: 'price_asc', label: 'Preis ↑' },
  { key: 'price_desc', label: 'Preis ↓' },
]

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

function normalizeSearch(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function parsePageParam(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 1
}

function compareNewestThenId(
  a: MarketplaceProduct,
  b: MarketplaceProduct
): number {
  const dateDifference =
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  return dateDifference !== 0 ? dateDifference : a.id.localeCompare(b.id)
}

interface Props {
  products: MarketplaceProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
}

export default function MarketplacePageClient({
  products,
  salesCounts,
  ratings,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Filter state derived from URL — keeps back/forward navigation in sync
  const category = searchParams.get('category') ?? 'all'
  const type = (searchParams.get('type') as 'all' | ProductType) ?? 'all'
  const sort = (searchParams.get('sort') as SortKey) ?? 'newest'
  const level = searchParams.get('level')
  const equipment =
    searchParams.get('equipment')?.split(',').filter(Boolean) ?? []
  const duration = searchParams.get('duration')
  const maxPriceParam = searchParams.get('max_price')
  const maxPrice =
    maxPriceParam &&
    Number.isFinite(Number(maxPriceParam)) &&
    Number(maxPriceParam) >= 0
      ? Number(maxPriceParam)
      : null
  const rawPage = searchParams.get('page')
  const page = parsePageParam(rawPage)
  const coaching = searchParams.get('coaching') === 'true'
  const group = searchParams.get('group') === 'true'
  const urlSearch = normalizeSearch(searchParams.get('q') ?? '')

  const [searchState, setSearchState] = useState({
    value: urlSearch,
    syncedUrl: urlSearch,
  })
  if (searchState.syncedUrl !== urlSearch) {
    setSearchState({ value: urlSearch, syncedUrl: urlSearch })
  }
  const search = searchState.value
  const setSearch = (value: string) => {
    setSearchState((current) => ({ ...current, value }))
  }
  const normalizedSearch = normalizeSearch(search)

  const [categoryOpen, setCategoryOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const categoryRef = useRef<HTMLDivElement>(null)
  const mobileFilterButtonRef = useRef<HTMLButtonElement>(null)
  const mobileDrawerRef = useRef<HTMLDivElement>(null)
  const resultsSummaryRef = useRef<HTMLParagraphElement>(null)
  const mobileDrawerTitleId = useId()

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      return next
    })
  }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        categoryRef.current &&
        !categoryRef.current.contains(e.target as Node)
      ) {
        setCategoryOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setCategoryOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!mobileFiltersOpen) return

    const previousOverflow = document.body.style.overflow
    const trigger = mobileFilterButtonRef.current
    document.body.style.overflow = 'hidden'

    const drawer = mobileDrawerRef.current
    const focusableSelector =
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    const firstFocusable =
      drawer?.querySelector<HTMLElement>('[data-autofocus]') ??
      drawer?.querySelector<HTMLElement>(focusableSelector)
    firstFocusable?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileFiltersOpen(false)
        return
      }

      if (event.key !== 'Tab' || !drawer) return
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(focusableSelector)
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [mobileFiltersOpen])

  // Build a /marketplace URL from current params + overrides
  function buildUrl(
    overrides: {
      category?: string
      type?: string
      sort?: string
      level?: string | null
      equipment?: string[]
      duration?: string | null
      page?: number
      maxPrice?: string | null
      coaching?: boolean
      group?: boolean
      search?: string
    } = {}
  ): string {
    const cat = overrides.category ?? category
    const t = overrides.type ?? type
    const s = overrides.sort ?? sort
    const l = 'level' in overrides ? overrides.level : level
    const eq = overrides.equipment ?? equipment
    const d = 'duration' in overrides ? overrides.duration : duration
    const mp = 'maxPrice' in overrides ? overrides.maxPrice : maxPriceParam
    const pg = overrides.page ?? page
    const co = overrides.coaching !== undefined ? overrides.coaching : coaching
    const gr = overrides.group !== undefined ? overrides.group : group
    const q =
      'search' in overrides
        ? normalizeSearch(overrides.search ?? '')
        : urlSearch

    const params = new URLSearchParams()
    if (cat !== 'all') params.set('category', cat)
    if (t !== 'all') params.set('type', t)
    if (s !== 'newest') params.set('sort', s)
    if (l) params.set('level', l)
    if (eq.length > 0) params.set('equipment', eq.join(','))
    if (d) params.set('duration', d)
    if (mp && Number.isFinite(Number(mp)) && Number(mp) >= 0)
      params.set('max_price', mp)
    if (pg > 1) params.set('page', String(pg))
    if (co) params.set('coaching', 'true')
    if (gr) params.set('group', 'true')
    if (q) params.set('q', q)

    const qs = params.toString()
    return `/marketplace${qs ? '?' + qs : ''}`
  }

  function go(overrides: Parameters<typeof buildUrl>[0]) {
    router.push(buildUrl(overrides), { scroll: false })
  }

  useEffect(() => {
    if (normalizedSearch === urlSearch) return

    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (normalizedSearch) {
        params.set('q', normalizedSearch)
      } else {
        params.delete('q')
      }
      params.delete('page')

      const query = params.toString()
      router.replace(`/marketplace${query ? `?${query}` : ''}`, {
        scroll: false,
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [normalizedSearch, router, searchParams, urlSearch])

  // Filtering + sorting (client-side against the full product list)
  const filtered = products
    .filter((p) => {
      const matchesCat =
        category === 'all' ||
        (p.categories ?? []).includes(category) ||
        (p.creator.categories ?? []).includes(category) ||
        p.creator.category === category
      const matchesType = type === 'all' || p.type === type
      const searchNeedle = normalizedSearch.toLocaleLowerCase('de-DE')
      const searchableCategories = [
        ...(p.categories ?? []),
        ...(p.creator.categories ?? []),
        p.creator.category ?? '',
      ].flatMap((categoryKey) => [
        categoryKey,
        CATEGORY_LABEL_MAP[categoryKey] ?? '',
      ])
      const matchesSearch =
        !searchNeedle ||
        p.title.toLocaleLowerCase('de-DE').includes(searchNeedle) ||
        p.creator.display_name
          .toLocaleLowerCase('de-DE')
          .includes(searchNeedle) ||
        (p.description ?? '')
          .toLocaleLowerCase('de-DE')
          .includes(searchNeedle) ||
        searchableCategories.some((categoryValue) =>
          categoryValue.toLocaleLowerCase('de-DE').includes(searchNeedle)
        )
      const matchesEquip =
        equipment.length === 0 || equipment.some((e) => p.equipment.includes(e))
      const matchesLevel = !level || p.level === level
      const matchesDuration = !duration || p.duration === duration
      const matchesCoaching = !coaching || p.creatorHasCoaching === true
      const matchesGroup = !group || p.creatorHasVideoClasses === true
      return (
        matchesCat &&
        matchesType &&
        matchesSearch &&
        matchesEquip &&
        matchesLevel &&
        matchesDuration &&
        matchesCoaching &&
        matchesGroup &&
        (maxPrice === null || p.price <= maxPrice)
      )
    })
    .sort((a, b) => {
      switch (sort) {
        case 'popular': {
          const salesDifference =
            (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
          return salesDifference !== 0
            ? salesDifference
            : compareNewestThenId(a, b)
        }
        case 'best_selling': {
          const salesDifference =
            (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
          return salesDifference !== 0
            ? salesDifference
            : compareNewestThenId(a, b)
        }
        case 'top_rated': {
          const ratingDifference = compareProductRatings(
            ratings[a.id],
            ratings[b.id]
          )
          return ratingDifference !== 0
            ? ratingDifference
            : compareNewestThenId(a, b)
        }
        case 'newest':
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        case 'price_asc':
          return a.price - b.price
        case 'price_desc':
          return b.price - a.price
      }
    })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  useEffect(() => {
    const normalizedPageParam = safePage > 1 ? String(safePage) : null
    if (rawPage === normalizedPageParam) return

    const params = new URLSearchParams(searchParams.toString())
    if (normalizedPageParam) {
      params.set('page', normalizedPageParam)
    } else {
      params.delete('page')
    }

    const query = params.toString()
    router.replace(`/marketplace${query ? `?${query}` : ''}`, { scroll: false })
  }, [rawPage, router, safePage, searchParams])

  function resetAll() {
    setSearch('')
    go({
      category: 'all',
      type: 'all',
      level: null,
      equipment: [],
      duration: null,
      coaching: false,
      group: false,
      search: '',
      maxPrice: null,
      page: 1,
    })
  }

  type ActiveFilterChip = {
    key: string
    label: string
    remove: () => void
  }

  const activeFilterChips: ActiveFilterChip[] = []

  if (maxPrice !== null)
    activeFilterChips.push({
      key: 'price',
      label: `Preis bis ${maxPrice.toLocaleString('de-DE')} €`,
      remove: () => go({ maxPrice: null, page: 1 }),
    })

  if (category !== 'all') {
    activeFilterChips.push({
      key: 'category',
      label: `Kategorie: ${CATEGORY_LABEL_MAP[category] ?? category}`,
      remove: () => go({ category: 'all', page: 1 }),
    })
  }

  if (type !== 'all') {
    activeFilterChips.push({
      key: 'type',
      label: `Typ: ${TYPE_OPTIONS.find((option) => option.key === type)?.label ?? type}`,
      remove: () => go({ type: 'all', page: 1 }),
    })
  }

  if (level) {
    activeFilterChips.push({
      key: 'level',
      label: `Level: ${LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level}`,
      remove: () => go({ level: null, page: 1 }),
    })
  }

  for (const equipmentValue of equipment) {
    const equipmentLabel =
      EQUIPMENT_OPTIONS.find((option) => option.value === equipmentValue)
        ?.label ?? equipmentValue
    activeFilterChips.push({
      key: `equipment-${equipmentValue}`,
      label: `Ausstattung: ${equipmentLabel}`,
      remove: () =>
        go({
          equipment: equipment.filter((value) => value !== equipmentValue),
          page: 1,
        }),
    })
  }

  if (duration) {
    activeFilterChips.push({
      key: 'duration',
      label: `Dauer: ${DURATION_OPTIONS.find((option) => option.value === duration)?.label ?? duration}`,
      remove: () => go({ duration: null, page: 1 }),
    })
  }

  if (coaching) {
    activeFilterChips.push({
      key: 'coaching',
      label: 'Coach bietet 1:1 Coaching',
      remove: () => go({ coaching: false, page: 1 }),
    })
  }

  if (group) {
    activeFilterChips.push({
      key: 'group',
      label: 'Coach bietet Gruppen-Sessions',
      remove: () => go({ group: false, page: 1 }),
    })
  }

  if (normalizedSearch) {
    activeFilterChips.push({
      key: 'search',
      label: `Suche: „${normalizedSearch}“`,
      remove: () => {
        setSearch('')
        go({ search: '', page: 1 })
      },
    })
  }

  const legacyCategories = [
    ...new Set(
      products
        .flatMap((p) => [
          ...p.categories,
          ...p.creator.categories,
          p.creator.category ?? '',
        ])
        .filter(Boolean)
    ),
  ].filter(
    (key) =>
      CATEGORY_LABEL_MAP[key] &&
      !CATEGORY_GROUPS.some((group) =>
        group.items.some((item) => item.key === key)
      )
  )
  const activeFilterCount = activeFilterChips.length
  const visibleSortOptions = [
    ...SORT_OPTIONS,
    ...(['popular', 'best_selling'].includes(sort)
      ? [{ key: sort, label: 'Nach Käufen (bisherige Sortierung)' }]
      : []),
  ]

  function removeFilterChip(remove: () => void) {
    remove()
    window.setTimeout(() => resultsSummaryRef.current?.focus(), 0)
  }

  function resetAllAndFocusResults() {
    resetAll()
    window.setTimeout(() => resultsSummaryRef.current?.focus(), 0)
  }

  function goToPage(p: number) {
    const nextPage = Math.min(Math.max(1, p), totalPages)
    if (nextPage === safePage) return

    go({ page: nextPage })
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    window.requestAnimationFrame(() => {
      resultsSummaryRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  return (
    <div className="hp-home min-h-screen bg-gray-50/60">
      <section className="border-b border-border bg-surface">
        <div className="ardore-container py-6 sm:py-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="section-title">Marktplatz entdecken</h1>
              <p className="mt-2 text-sm text-muted">
                Coaches kennenlernen. Digitale Produkte vergleichen.
              </p>
            </div>
            <DiscoveryNavigation
              active="products"
              search={normalizedSearch}
              category={category}
            />
          </div>
          <label className="relative block max-w-2xl">
            <span className="sr-only">
              Produkte nach Titel, Coach oder Kategorie suchen
            </span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              aria-label="Produkte nach Titel, Coach oder Kategorie suchen"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => setSearch(normalizedSearch)}
              placeholder="Produkt, Coach oder Thema suchen"
              className="field-control w-full pl-12 pr-12"
            />
            {normalizedSearch && (
              <button
                onClick={() => setSearch('')}
                aria-label="Suche löschen"
                className="icon-button absolute right-1 top-1/2 -translate-y-1/2 text-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </label>
          <p className="mt-3 text-xs text-muted">
            Hier findest du Produkte.{' '}
            <Link
              className="font-semibold text-brand underline underline-offset-2"
              href={discoveryHref('/coaches', normalizedSearch, category)}
            >
              Passende Coaches ansehen
            </Link>
          </p>
        </div>
      </section>

      {/* ── Mobile filter toolbar ─────────────────────────────────── */}
      <div className="md:hidden sticky top-16 z-30 bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            ref={mobileFilterButtonRef}
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={mobileFiltersOpen}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 shadow-sm active:scale-[0.98] transition-all"
          >
            <SlidersHorizontal className="h-4 w-4 text-green-600" />
            Filter
            {activeFilterCount > 0 && (
              <span className="h-5 min-w-5 px-1 rounded-full bg-green-600 text-white text-[11px] font-bold inline-flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          <label className="relative flex-1">
            <span className="sr-only">Produkte sortieren</span>
            <select
              value={sort}
              onChange={(e) => go({ sort: e.target.value, page: 1 })}
              aria-label="Produkte sortieren"
              className="appearance-none w-full pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer shadow-sm"
            >
              {visibleSortOptions.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </label>
        </div>
      </div>

      {/* ── Desktop sticky filter bar ─────────────────────────────── */}
      <div className="hidden md:block sticky top-16 z-30 bg-white border-b border-gray-100 shadow-sm">
        <div className="ardore-container py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            {/* Category dropdown — outside the overflow-x-auto so the menu isn't clipped */}
            <div ref={categoryRef} className="relative flex-shrink-0">
              <button
                aria-expanded={categoryOpen}
                onClick={() => setCategoryOpen((o) => !o)}
                className={cn(
                  'flex min-h-11 items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-all whitespace-nowrap',
                  category !== 'all'
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                )}
              >
                {category === 'all'
                  ? 'Alle Kategorien'
                  : (CATEGORY_LABEL_MAP[category] ?? 'Kategorie')}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-150',
                    categoryOpen && 'rotate-180'
                  )}
                />
              </button>
              {categoryOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-[var(--shadow-floating)] border border-gray-100 py-1.5 z-50 max-h-96 overflow-y-auto animate-scale-in">
                  {/* "Alle Kategorien" reset row */}
                  <button
                    onClick={() => {
                      setCategoryOpen(false)
                      go({ category: 'all', page: 1 })
                    }}
                    className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Alle Kategorien
                    {category === 'all' && (
                      <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                    )}
                  </button>

                  {legacyCategories.map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        setCategoryOpen(false)
                        go({ category: key, page: 1 })
                      }}
                      className="flex min-h-11 w-full items-center justify-between px-4 text-sm text-muted hover:bg-surface-muted"
                    >
                      {CATEGORY_LABEL_MAP[key]}
                      {category === key && (
                        <Check
                          className="h-4 w-4 text-brand"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ))}
                  {CATEGORY_GROUPS.map((group, gi) => {
                    const isOpen = openGroups.has(group.label)
                    return (
                      <div key={group.label}>
                        <div
                          className={cn(
                            'mx-4 border-t border-gray-100',
                            gi === 0 ? 'mt-1' : ''
                          )}
                        />
                        <button
                          onClick={() => toggleGroup(group.label)}
                          className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {group.label}
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 transition-transform duration-150',
                              isOpen && 'rotate-180'
                            )}
                          />
                        </button>
                        {isOpen &&
                          group.items.map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() => {
                                setCategoryOpen(false)
                                go({ category: key, page: 1 })
                              }}
                              className="w-full flex items-center justify-between px-6 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              {label}
                              {category === key && (
                                <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                              )}
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
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {TYPE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  aria-pressed={type === key}
                  onClick={() => go({ type: key, page: 1 })}
                  className={cn(
                    'flex-shrink-0 min-h-11 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                    type === key
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  )}
                >
                  {label}
                </button>
              ))}

              <div className="h-4 w-px bg-gray-200 flex-shrink-0 mx-0.5" />

              {/* Right side: advanced + sort + reset */}
              <div className="ml-auto flex items-center gap-2 flex-shrink-0 pl-2">
                <button
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((o) => !o)}
                  className={cn(
                    'flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
                    level || equipment.length > 0 || duration
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filter
                  {(level || equipment.length > 0 || duration) && (
                    <span className="ml-0.5 h-4 w-4 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {
                        [!!level, equipment.length > 0, !!duration].filter(
                          Boolean
                        ).length
                      }
                    </span>
                  )}
                </button>

                <div className="relative flex-shrink-0">
                  <select
                    aria-label="Produkte sortieren"
                    value={sort}
                    onChange={(e) => go({ sort: e.target.value, page: 1 })}
                    className="field-control appearance-none pl-3 pr-7 text-sm"
                  >
                    {visibleSortOptions.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
                </div>

                {activeFilterCount > 0 && (
                  <button
                    onClick={resetAllAndFocusResults}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors whitespace-nowrap"
                  >
                    <X className="h-3 w-3" />
                    Zurücksetzen
                  </button>
                )}
              </div>
            </div>
            {/* end inner scrollable */}
          </div>

          {/* Advanced filter panel */}
          {advancedOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-4 pb-2">
              <label className="block max-w-xs">
                <span className="mb-2 block text-sm font-semibold text-muted">
                  Preis
                </span>
                <select
                  value={maxPriceParam ?? ''}
                  onChange={(event) =>
                    go({ maxPrice: event.target.value || null, page: 1 })
                  }
                  className="field-control w-full"
                >
                  <option value="">Alle Preise</option>
                  {[0, 25, 50, 100].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? 'Kostenlos' : `Bis ${value} €`}
                    </option>
                  ))}
                  {maxPrice !== null &&
                    ![0, 25, 50, 100].includes(maxPrice) && (
                      <option value={maxPriceParam!}>Bis {maxPrice} €</option>
                    )}
                </select>
              </label>
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Ausstattung
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {EQUIPMENT_OPTIONS.map((opt) => {
                    const active = equipment.includes(opt.value)
                    const newEq = active
                      ? equipment.filter((v) => v !== opt.value)
                      : [...equipment, opt.value]
                    return (
                      <button
                        key={opt.value}
                        onClick={() => go({ equipment: newEq, page: 1 })}
                        className={cn(
                          'inline-flex items-center gap-1 min-h-11 px-3 py-1 rounded-full text-xs font-medium border transition-all',
                          active
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
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
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Level
                  </p>
                  <div className="flex gap-1.5">
                    {LEVEL_OPTIONS.map((opt) => {
                      const active = level === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() =>
                            go({ level: active ? null : opt.value, page: 1 })
                          }
                          className={cn(
                            'min-h-11 px-3 py-1 rounded-full text-xs font-medium border transition-all',
                            active
                              ? 'bg-green-700 text-white border-green-700'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                          )}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Dauer
                  </p>
                  <div className="flex gap-1.5">
                    {DURATION_OPTIONS.map((opt) => {
                      const active = duration === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() =>
                            go({ duration: active ? null : opt.value, page: 1 })
                          }
                          className={cn(
                            'min-h-11 px-3 py-1 rounded-full text-xs font-medium border transition-all',
                            active
                              ? 'bg-green-700 text-white border-green-700'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
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

      {/* ── Mobile filter drawer ──────────────────────────────────── */}
      {mobileFiltersOpen && (
        <div
          className="md:hidden fixed inset-0 z-[70] bg-gray-950/45 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setMobileFiltersOpen(false)
          }}
        >
          <div
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={mobileDrawerTitleId}
            className="absolute inset-x-0 bottom-0 max-h-[88svh] bg-white rounded-t-[var(--radius-dialog)] shadow-[var(--shadow-floating)] flex flex-col animate-slide-up-sm"
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2
                  id={mobileDrawerTitleId}
                  className="text-lg font-bold text-gray-900"
                >
                  Filter
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {filtered.length}{' '}
                  {filtered.length === 1 ? 'Produkt' : 'Produkte'} gefunden
                </p>
              </div>
              <button
                type="button"
                data-autofocus
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Filter schließen"
                className="h-10 w-10 rounded-xl bg-gray-100 text-gray-500 inline-flex items-center justify-center hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
              <label className="block max-w-xs">
                <span className="mb-2 block text-sm font-semibold text-muted">
                  Preis
                </span>
                <select
                  value={maxPriceParam ?? ''}
                  onChange={(event) =>
                    go({ maxPrice: event.target.value || null, page: 1 })
                  }
                  className="field-control w-full"
                >
                  <option value="">Alle Preise</option>
                  {[0, 25, 50, 100].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? 'Kostenlos' : `Bis ${value} €`}
                    </option>
                  ))}
                  {maxPrice !== null &&
                    ![0, 25, 50, 100].includes(maxPrice) && (
                      <option value={maxPriceParam!}>Bis {maxPrice} €</option>
                    )}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Kategorie
                </span>
                <select
                  value={category}
                  onChange={(event) =>
                    go({ category: event.target.value, page: 1 })
                  }
                  className="field-control w-full"
                >
                  <option value="all">Alle Kategorien</option>
                  {legacyCategories.map((key) => (
                    <option key={key} value={key}>
                      {CATEGORY_LABEL_MAP[key]}
                    </option>
                  ))}
                  {category !== 'all' &&
                    !legacyCategories.includes(category) &&
                    !CATEGORY_GROUPS.some((group) =>
                      group.items.some((item) => item.key === category)
                    ) && (
                      <option value={category}>
                        {CATEGORY_LABEL_MAP[category] ?? category}
                      </option>
                    )}
                  {CATEGORY_GROUPS.map((categoryGroup) => (
                    <optgroup
                      key={categoryGroup.label}
                      label={categoryGroup.label}
                    >
                      {categoryGroup.items.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Produkttyp
                </legend>
                <div className="flex flex-wrap gap-2">
                  {TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={type === option.key}
                      onClick={() => go({ type: option.key, page: 1 })}
                      className={cn(
                        'min-h-11 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors',
                        type === option.key
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-200'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Level
                </legend>
                <div className="flex flex-wrap gap-2">
                  {LEVEL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={level === option.value}
                      onClick={() =>
                        go({
                          level: level === option.value ? null : option.value,
                          page: 1,
                        })
                      }
                      className={cn(
                        'min-h-11 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors',
                        level === option.value
                          ? 'bg-green-700 text-white border-green-700'
                          : 'bg-white text-gray-600 border-gray-200'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Ausstattung
                </legend>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map((option) => {
                    const active = equipment.includes(option.value)
                    const nextEquipment = active
                      ? equipment.filter((value) => value !== option.value)
                      : [...equipment, option.value]
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          go({ equipment: nextEquipment, page: 1 })
                        }
                        className={cn(
                          'inline-flex items-center gap-1.5 min-h-11 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors',
                          active
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200'
                        )}
                      >
                        {active && <Check className="h-3.5 w-3.5" />}
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Dauer
                </legend>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={duration === option.value}
                      onClick={() =>
                        go({
                          duration:
                            duration === option.value ? null : option.value,
                          page: 1,
                        })
                      }
                      className={cn(
                        'min-h-11 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors',
                        duration === option.value
                          ? 'bg-green-700 text-white border-green-700'
                          : 'bg-white text-gray-600 border-gray-200'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="grid grid-cols-2 gap-3 px-5 py-4 border-t border-gray-100 bg-white flex-shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={resetAll}
                disabled={activeFilterCount === 0}
                className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-40"
              >
                Zurücksetzen
              </button>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="px-4 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              >
                {filtered.length} anzeigen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────── */}
      <div className="ardore-container py-5 sm:py-8">
        {/* Count + active-filter badge */}
        <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
          <p
            ref={resultsSummaryRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className="text-sm text-gray-500 focus:outline-none scroll-mt-24"
          >
            <span className="font-semibold text-gray-900">
              {filtered.length}
            </span>{' '}
            {filtered.length === 1 ? 'Produkt' : 'Produkte'} gefunden
            {normalizedSearch && (
              <span className="text-gray-400">
                {' '}
                für {'„'}
                {normalizedSearch}
                {'"'}
              </span>
            )}
          </p>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-100 font-medium">
              <Filter className="h-3 w-3" />
              {activeFilterCount}{' '}
              {activeFilterCount === 1 ? 'Filter aktiv' : 'Filter aktiv'}
            </span>
          )}
        </div>

        {/* Active filters */}
        {activeFilterChips.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 mb-4 sm:mb-6"
            aria-label="Aktive Filter"
          >
            {activeFilterChips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-green-50 text-green-800 border border-green-100 text-xs font-medium"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={() => removeFilterChip(chip.remove)}
                  aria-label={`${chip.label} entfernen`}
                  className="h-11 w-11 rounded-full inline-flex items-center justify-center text-green-700 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {activeFilterChips.length > 1 && (
              <button
                type="button"
                onClick={resetAllAndFocusResults}
                className="text-xs font-semibold text-gray-500 hover:text-red-600 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
              >
                Alle Filter zurücksetzen
              </button>
            )}
          </div>
        )}

        {/* Grid */}
        {pageItems.length === 0 ? (
          <StatePanel
            title="Keine Produkte gefunden"
            description="Versuche einen anderen Suchbegriff oder setze die Filter zurück."
            action={
              <>
                <Button variant="secondary" onClick={resetAllAndFocusResults}>
                  Zurücksetzen
                </Button>
                <Link
                  className="button-base px-4 text-sm text-brand"
                  href={discoveryHref('/coaches', normalizedSearch, category)}
                >
                  Coaches ansehen
                </Link>
              </>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {pageItems.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                salesCount={salesCounts[product.id]}
                rating={ratings[product.id]}
                variant="marketplace"
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav
            aria-label="Seitennavigation der Marktplatz-Ergebnisse"
            className="flex items-center justify-center gap-2 mt-10 flex-wrap"
          >
            <button
              type="button"
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage === 1}
              aria-label="Vorherige Ergebnisseite"
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Zurück
            </button>

            {(() => {
              const pages: number[] = []
              const range = 2
              for (let i = 1; i <= totalPages; i++) {
                if (
                  i === 1 ||
                  i === totalPages ||
                  (i >= safePage - range && i <= safePage + range)
                ) {
                  pages.push(i)
                }
              }
              const nodes: React.ReactNode[] = []
              let prev = 0
              for (const p of pages) {
                if (p - prev > 1) {
                  nodes.push(
                    <span
                      key={`gap-${p}`}
                      aria-hidden="true"
                      className="px-1 text-gray-400 text-sm select-none"
                    >
                      …
                    </span>
                  )
                }
                nodes.push(
                  <button
                    key={p}
                    type="button"
                    onClick={() => goToPage(p)}
                    aria-label={`Seite ${p}`}
                    aria-current={safePage === p ? 'page' : undefined}
                    className={cn(
                      'w-11 h-11 rounded-xl text-sm font-medium transition-colors',
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
              type="button"
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage === totalPages}
              aria-label="Nächste Ergebnisseite"
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Weiter →
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
