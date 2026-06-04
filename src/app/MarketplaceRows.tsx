'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight,
  TrendingUp, Clock, Star, Users, Sparkles,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ProductCard, type ProductCardData } from '@/components/ui/ProductCard'

interface Creator {
  display_name: string
  avatar_url: string | null
  slug: string
  category: string | null
  categories: string[]
}

// Extends ProductCardData with sort-only fields not needed for rendering
interface RowProduct extends ProductCardData {
  createdAt: string
}

interface Props {
  products: RowProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
}

const KNOWN_CATEGORY_LABELS: Record<string, string> = {
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

function CoachCard({ creator, productCount }: { creator: Creator; productCount: number }) {
  return (
    <Link href={`/creators/${creator.slug}`} className="flex-shrink-0 w-40 [scroll-snap-align:start] block">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-center hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
        <Avatar
          src={creator.avatar_url}
          name={creator.display_name}
          className="h-14 w-14 text-sm mx-auto mb-3"
        />
        <p className="text-sm font-semibold text-gray-900 truncate">{creator.display_name}</p>
        {creator.category && (
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{creator.category}</p>
        )}
        {productCount > 0 && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            {productCount} {productCount === 1 ? 'Produkt' : 'Produkte'}
          </p>
        )}
        <p className="text-[11px] text-green-600 font-medium mt-2">Profil ansehen →</p>
      </div>
    </Link>
  )
}

function ScrollRow({
  title,
  icon,
  children,
  onShowAll,
  showAllHref,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  onShowAll?: () => void
  showAllHref?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const updateArrows = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateArrows()
    el.addEventListener('scroll', updateArrows, { passive: true })
    const ro = new ResizeObserver(updateArrows)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      ro.disconnect()
    }
  }, [updateArrows])

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="flex items-center gap-2">
          {icon && (
            <div className="h-7 w-7 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
              {icon}
            </div>
          )}
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        </div>
        {onShowAll && (
          <button
            onClick={onShowAll}
            className="text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-0.5 transition-colors flex-shrink-0"
          >
            Alle anzeigen <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        {!onShowAll && showAllHref && (
          <Link
            href={showAllHref}
            className="text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-0.5 transition-colors flex-shrink-0"
          >
            Alle anzeigen <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      <div className="relative">
        {canScrollLeft && (
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: -340, behavior: 'smooth' })}
            className="absolute left-1 top-[calc(50%-1.125rem)] z-10 hidden md:flex items-center justify-center h-9 w-9 bg-white shadow-lg rounded-full border border-gray-200 hover:bg-gray-50 transition-colors"
            aria-label="Scroll links"
          >
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto px-4 pb-3 [scroll-snap-type:x_proximity] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {children}
        </div>

        {canScrollRight && (
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: 340, behavior: 'smooth' })}
            className="absolute right-1 top-[calc(50%-1.125rem)] z-10 hidden md:flex items-center justify-center h-9 w-9 bg-white shadow-lg rounded-full border border-gray-200 hover:bg-gray-50 transition-colors"
            aria-label="Scroll rechts"
          >
            <ChevronRight className="h-4 w-4 text-gray-600" />
          </button>
        )}
      </div>
    </section>
  )
}

export default function MarketplaceRows({ products, salesCounts, ratings }: Props) {
  const bestsellers = [...products]
    .filter(p => salesCounts[p.id])
    .sort((a, b) => (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0))
    .slice(0, 15)

  const topRated = [...products]
    .filter(p => ratings[p.id])
    .sort((a, b) => (ratings[b.id]?.avg ?? 0) - (ratings[a.id]?.avg ?? 0))
    .slice(0, 15)

  const newest = [...products]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15)

  const coachMap = new Map<string, Creator>()
  const coachSales = new Map<string, number>()
  const coachProductCount = new Map<string, number>()
  for (const p of products) {
    if (!coachMap.has(p.creator.slug)) {
      coachMap.set(p.creator.slug, p.creator)
      coachSales.set(p.creator.slug, 0)
      coachProductCount.set(p.creator.slug, 0)
    }
    coachSales.set(p.creator.slug, (coachSales.get(p.creator.slug) ?? 0) + (salesCounts[p.id] ?? 0))
    coachProductCount.set(p.creator.slug, (coachProductCount.get(p.creator.slug) ?? 0) + 1)
  }
  const topCoaches = [...coachMap.values()]
    .sort((a, b) => (coachSales.get(b.slug) ?? 0) - (coachSales.get(a.slug) ?? 0))
    .slice(0, 15)

  const seenCats = new Set<string>()
  for (const p of products) {
    for (const c of p.creator.categories) if (c in KNOWN_CATEGORY_LABELS) seenCats.add(c)
    if (p.creator.category && p.creator.category in KNOWN_CATEGORY_LABELS) seenCats.add(p.creator.category)
  }
  const categoryRows = [...seenCats]
    .map(cat => ({
      key: cat,
      label: KNOWN_CATEGORY_LABELS[cat],
      items: products
        .filter(p => p.creator.categories.includes(cat) || p.creator.category === cat)
        .slice(0, 15),
    }))
    .filter(row => row.items.length >= 1)

  if (products.length === 0) {
    return (
      <div className="py-24 text-center px-4">
        <div className="max-w-sm mx-auto">
          <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center mx-auto mb-6">
            <Sparkles className="h-9 w-9 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-3">Bald geht es los!</h3>
          <p className="text-gray-500 leading-relaxed">
            Die ersten Coaches stellen gerade ihre Inhalte ein. Schau in Kürze wieder vorbei.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="py-6 overflow-hidden">
      {bestsellers.length >= 2 && (
        <ScrollRow
          title="Bestseller"
          icon={<TrendingUp className="h-4 w-4 text-amber-500" />}
          showAllHref="/marketplace?sort=best_selling"
        >
          {bestsellers.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              salesCount={salesCounts[p.id]}
              rating={ratings[p.id]}
              compact
              scrollSnap
            />
          ))}
        </ScrollRow>
      )}

      {topRated.length >= 2 && (
        <ScrollRow
          title="Top bewertet"
          icon={<Star className="h-4 w-4 text-amber-400" />}
          showAllHref="/marketplace?sort=top_rated"
        >
          {topRated.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              salesCount={salesCounts[p.id]}
              rating={ratings[p.id]}
              compact
              scrollSnap
            />
          ))}
        </ScrollRow>
      )}

      {newest.length >= 1 && (
        <ScrollRow
          title="Neu auf Ardore"
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          showAllHref="/marketplace?sort=newest"
        >
          {newest.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              salesCount={salesCounts[p.id]}
              rating={ratings[p.id]}
              compact
              scrollSnap
            />
          ))}
        </ScrollRow>
      )}

      {topCoaches.length >= 2 && (
        <ScrollRow
          title="Beliebte Coaches"
          icon={<Users className="h-4 w-4 text-green-600" />}
          showAllHref="/coaches"
        >
          {topCoaches.map(c => (
            <CoachCard key={c.slug} creator={c} productCount={coachProductCount.get(c.slug) ?? 0} />
          ))}
        </ScrollRow>
      )}

      {categoryRows.map(row => (
        <ScrollRow
          key={row.key}
          title={row.label}
          showAllHref={`/marketplace?category=${row.key}`}
        >
          {row.items.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              salesCount={salesCounts[p.id]}
              rating={ratings[p.id]}
              compact
              scrollSnap
            />
          ))}
        </ScrollRow>
      ))}
    </div>
  )
}
