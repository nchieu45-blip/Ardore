'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight,
  TrendingUp, Clock, Star, Users, Sparkles, Video,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ProductCard, type ProductCardData } from '@/components/ui/ProductCard'
import HeartButton from '@/components/HeartButton'

interface Creator {
  id: string
  display_name: string
  avatar_url: string | null
  slug: string
  category: string | null
  categories: string[]
}

export interface CoachingCoach {
  id: string
  slug: string
  display_name: string
  avatar_url: string | null
  category: string | null
  categories: string[]
  price_cents: number
  duration_minutes: number
}

// Extends ProductCardData with sort-only fields not needed for rendering
interface RowProduct extends ProductCardData {
  createdAt: string
}

interface Props {
  products: RowProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
  coachingCoaches?: CoachingCoach[]
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
      <div className="relative rounded-2xl border border-gray-100 bg-white p-4 text-center hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
        <HeartButton type="coach" itemId={creator.id} className="absolute top-2 right-2" />
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

function LiveCoachCard({ coach }: { coach: CoachingCoach }) {
  const priceEur = Math.round(coach.price_cents / 100)
  const label = coach.categories[0]
    ? (KNOWN_CATEGORY_LABELS[coach.categories[0]] ?? coach.categories[0])
    : coach.category
      ? (KNOWN_CATEGORY_LABELS[coach.category] ?? coach.category)
      : null

  return (
    <Link
      href={`/creators/${coach.slug}`}
      className="flex-shrink-0 w-52 [scroll-snap-align:start] block"
    >
      <div className="relative rounded-2xl border border-gray-100 bg-white p-4 hover:shadow-xl hover:-translate-y-1 transition-all duration-200 h-full flex flex-col">
        <HeartButton type="coach" itemId={coach.id} className="absolute top-2 right-2" />
        <div className="flex items-center gap-3 mb-3">
          <Avatar
            src={coach.avatar_url}
            name={coach.display_name}
            className="h-11 w-11 text-sm flex-shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{coach.display_name}</p>
            {label && <p className="text-[11px] text-gray-400 truncate">{label}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-3">
          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
            <Video className="h-2.5 w-2.5" />
            1:1 Videocoaching
          </span>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-400">{coach.duration_minutes} Min.</p>
            <p className="text-sm font-bold text-gray-900">ab {priceEur} €</p>
          </div>
          <p className="text-[11px] text-blue-600 font-semibold">Buchen →</p>
        </div>
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

export default function MarketplaceRows({ products, salesCounts, ratings, coachingCoaches = [] }: Props) {
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

      {coachingCoaches.length >= 1 && (
        <ScrollRow
          title="1:1 Live-Coaching"
          icon={<Video className="h-4 w-4 text-blue-500" />}
          showAllHref="/coaches?videocoaching=true"
        >
          {coachingCoaches.map(c => (
            <LiveCoachCard key={c.id} coach={c} />
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
