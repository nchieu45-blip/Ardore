'use client'

import { useRef } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight,
  TrendingUp, Clock, Star, Users,
  FileText, Video, BookOpen, Image as ImageIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'

type ProductType = 'pdf' | 'video' | 'course' | 'image'
type SortKey = 'popular' | 'newest' | 'price_asc' | 'price_desc' | 'top_rated' | 'best_selling'

interface Creator {
  display_name: string
  avatar_url: string | null
  slug: string
  category: string | null
  categories: string[]
}

interface Product {
  id: string
  title: string
  type: ProductType
  price: number
  createdAt: string
  creator: Creator
}

interface Props {
  products: Product[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
  onSetSort: (sort: SortKey) => void
  onSetTopic: (topic: string) => void
}

const TYPE_GRADIENTS: Record<ProductType, string> = {
  pdf:    'from-blue-500 to-blue-700',
  video:  'from-violet-500 to-violet-700',
  course: 'from-amber-400 to-orange-500',
  image:  'from-pink-500 to-rose-600',
}

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText className="h-7 w-7 text-white/90" />,
  video:  <Video    className="h-7 w-7 text-white/90" />,
  course: <BookOpen className="h-7 w-7 text-white/90" />,
  image:  <ImageIcon className="h-7 w-7 text-white/90" />,
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

function ProductCard({
  product,
  salesCounts,
  ratings,
}: {
  product: Product
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
}) {
  return (
    <Link href={`/creators/${product.creator.slug}`} className="flex-shrink-0 w-44">
      <div className="rounded-xl overflow-hidden border border-gray-100 bg-white hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
        <div className={`h-28 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center relative`}>
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative">{TYPE_ICONS[product.type]}</div>
        </div>
        <div className="p-3">
          <p className="text-[11px] text-gray-400 truncate mb-0.5">{product.creator.display_name}</p>
          <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mb-2 min-h-[2.5rem]">
            {product.title}
          </p>
          {ratings[product.id] && (
            <div className="mb-1">
              <StarRating rating={ratings[product.id].avg} count={ratings[product.id].count} size="sm" />
            </div>
          )}
          {(salesCounts[product.id] ?? 0) >= 50 && (
            <p className="text-[10px] text-gray-400 mb-1">{salesCounts[product.id]} mal gekauft</p>
          )}
          <p className="text-green-700 font-bold text-sm">{formatCurrency(product.price)}</p>
        </div>
      </div>
    </Link>
  )
}

function CoachCard({ creator }: { creator: Creator }) {
  return (
    <Link href={`/creators/${creator.slug}`} className="flex-shrink-0 w-36">
      <div className="rounded-xl border border-gray-100 bg-white p-4 text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
        <Avatar
          src={creator.avatar_url}
          name={creator.display_name}
          className="h-14 w-14 text-sm mx-auto mb-3"
        />
        <p className="text-sm font-semibold text-gray-900 truncate">{creator.display_name}</p>
        {creator.category && (
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{creator.category}</p>
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

      <div className="relative group/row">
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
          className="absolute left-2 top-[calc(50%-1rem)] z-10 hidden md:flex items-center justify-center h-9 w-9 bg-white shadow-md rounded-full border border-gray-200 opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-gray-50"
          aria-label="Scroll links"
        >
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto px-4 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {children}
        </div>

        <button
          onClick={() => scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
          className="absolute right-2 top-[calc(50%-1rem)] z-10 hidden md:flex items-center justify-center h-9 w-9 bg-white shadow-md rounded-full border border-gray-200 opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-gray-50"
          aria-label="Scroll rechts"
        >
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
      </div>
    </section>
  )
}

export default function MarketplaceRows({ products, salesCounts, ratings, onSetSort, onSetTopic }: Props) {
  const bestsellers = [...products]
    .filter(p => salesCounts[p.id])
    .sort((a, b) => (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0))
    .slice(0, 15)

  const newest = [...products]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15)

  const topRated = [...products]
    .filter(p => ratings[p.id])
    .sort((a, b) => (ratings[b.id]?.avg ?? 0) - (ratings[a.id]?.avg ?? 0))
    .slice(0, 15)

  const coachMap = new Map<string, Creator>()
  const coachSales = new Map<string, number>()
  for (const p of products) {
    if (!coachMap.has(p.creator.slug)) {
      coachMap.set(p.creator.slug, p.creator)
      coachSales.set(p.creator.slug, 0)
    }
    coachSales.set(p.creator.slug, (coachSales.get(p.creator.slug) ?? 0) + (salesCounts[p.id] ?? 0))
  }
  const topCoaches = [...coachMap.values()]
    .sort((a, b) => (coachSales.get(b.slug) ?? 0) - (coachSales.get(a.slug) ?? 0))
    .slice(0, 15)

  // Category rows derived from actual product data
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
    .filter(row => row.items.length >= 2)

  if (products.length === 0) {
    return (
      <div className="py-24 text-center text-gray-400 px-4">
        <p className="font-medium">Noch keine Produkte vorhanden.</p>
        <p className="text-sm mt-1">Schau bald wieder vorbei!</p>
      </div>
    )
  }

  return (
    <div className="py-8 overflow-hidden">
      {bestsellers.length >= 2 && (
        <ScrollRow
          title="Bestseller"
          icon={<TrendingUp className="h-4 w-4 text-amber-500" />}
          onShowAll={() => onSetSort('best_selling')}
        >
          {bestsellers.map(p => (
            <ProductCard key={p.id} product={p} salesCounts={salesCounts} ratings={ratings} />
          ))}
        </ScrollRow>
      )}

      {newest.length >= 1 && (
        <ScrollRow
          title="Neu auf Ardore"
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          onShowAll={() => onSetSort('newest')}
        >
          {newest.map(p => (
            <ProductCard key={p.id} product={p} salesCounts={salesCounts} ratings={ratings} />
          ))}
        </ScrollRow>
      )}

      {topRated.length >= 2 && (
        <ScrollRow
          title="Top bewertet"
          icon={<Star className="h-4 w-4 text-amber-400" />}
          onShowAll={() => onSetSort('top_rated')}
        >
          {topRated.map(p => (
            <ProductCard key={p.id} product={p} salesCounts={salesCounts} ratings={ratings} />
          ))}
        </ScrollRow>
      )}

      {topCoaches.length >= 2 && (
        <ScrollRow
          title="Beliebte Coaches"
          icon={<Users className="h-4 w-4 text-green-600" />}
          showAllHref="/creators"
        >
          {topCoaches.map(c => (
            <CoachCard key={c.slug} creator={c} />
          ))}
        </ScrollRow>
      )}

      {categoryRows.map(row => (
        <ScrollRow
          key={row.key}
          title={row.label}
          onShowAll={() => onSetTopic(row.key)}
        >
          {row.items.map(p => (
            <ProductCard key={p.id} product={p} salesCounts={salesCounts} ratings={ratings} />
          ))}
        </ScrollRow>
      ))}
    </div>
  )
}
