'use client'

import Link from 'next/link'
import Image from 'next/image'
import { FileText, Play, GraduationCap, Image as ImageIcon } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import HeartButton from '@/components/HeartButton'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

const CATEGORY_GRADIENTS: Record<string, string> = {
  fitness:          'from-green-500 to-emerald-600',
  ernaehrung:       'from-amber-400 to-orange-500',
  mental:           'from-violet-500 to-purple-700',
  abnehmen:         'from-teal-400 to-cyan-600',
  schlaf:           'from-indigo-400 to-indigo-600',
  yoga:             'from-pink-400 to-rose-500',
  laufen:           'from-amber-500 to-orange-600',
  krafttraining:    'from-gray-600 to-gray-800',
  meditation:       'from-violet-500 to-fuchsia-600',
  stressmanagement: 'from-sky-400 to-blue-600',
  rueckenschmerzen: 'from-red-400 to-orange-500',
  schwangerschaft:  'from-pink-300 to-rose-400',
  mobility:         'from-emerald-400 to-teal-600',
  pilates:          'from-purple-400 to-violet-600',
  muskelaufbau:     'from-zinc-500 to-gray-700',
}

const DEFAULT_GRADIENT = 'from-green-600 to-emerald-700'

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText     className="h-10 w-10 text-white/50" />,
  video:  <Play         className="h-10 w-10 text-white/50" />,
  course: <GraduationCap className="h-10 w-10 text-white/50" />,
  image:  <ImageIcon    className="h-10 w-10 text-white/50" />,
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

export interface ProductCardData {
  id: string
  title: string
  type: ProductType
  price: number
  thumbnail_url: string | null
  categories?: string[]
  creator: {
    id: string
    display_name: string
    avatar_url: string | null
    slug: string
    category: string | null
    categories: string[]
  }
}

interface ProductCardProps {
  product: ProductCardData
  salesCount?: number
  rating?: { avg: number; count: number }
  /** true → compact row card (w-48 fixed), false → full-width grid card */
  compact?: boolean
  scrollSnap?: boolean
}

function getGradient(creator: ProductCardData['creator']): string {
  const primary = creator.categories[0] ?? creator.category ?? ''
  return CATEGORY_GRADIENTS[primary] ?? DEFAULT_GRADIENT
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

export function ProductCard({
  product,
  salesCount = 0,
  rating,
  compact = false,
  scrollSnap = false,
}: ProductCardProps) {
  const gradient = getGradient(product.creator)
  const hasThumb = !!product.thumbnail_url

  return (
    <Link
      href={`/products/${product.id}`}
      className={[
        'block',
        compact ? 'flex-shrink-0 w-48' : 'w-full',
        scrollSnap ? '[scroll-snap-align:start]' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="hp-card rounded-2xl overflow-hidden border border-gray-100 bg-white flex flex-col h-full transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-gray-200 group">

        {/* ── Thumbnail ─────────────────────────────────── */}
        <div className={[
          'relative flex-shrink-0 overflow-hidden',
          compact ? 'h-32' : 'h-44',
          hasThumb ? 'bg-gray-100' : `bg-gradient-to-br ${gradient}`,
        ].join(' ')}>
          {hasThumb ? (
            <Image
              src={product.thumbnail_url!}
              alt={product.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-black/10" />
              <div className="absolute inset-0 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                {TYPE_ICONS[product.type]}
              </div>
              <span className="absolute bottom-2 left-2.5 text-[10px] font-bold text-white/40 uppercase tracking-wider select-none pointer-events-none">
                {getInitials(product.creator.display_name)}
              </span>
            </>
          )}
          {/* Type badge */}
          <span className="absolute top-2 right-2 text-[10px] font-semibold bg-black/40 backdrop-blur-sm text-white px-2 py-0.5 rounded-full">
            {TYPE_LABELS[product.type]}
          </span>
          <HeartButton type="product" itemId={product.id} className="absolute top-2 left-2" />
        </div>

        {/* ── Content ───────────────────────────────────── */}
        <div className={compact ? 'p-3 flex flex-col flex-1' : 'p-4 flex flex-col flex-1'}>
          {compact ? (
            <p className="text-[11px] text-gray-400 truncate mb-0.5">{product.creator.display_name}</p>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <Avatar
                src={product.creator.avatar_url}
                name={product.creator.display_name}
                size="sm"
                className="h-5 w-5 text-[10px] flex-shrink-0"
              />
              <span className="text-xs text-gray-500 truncate">{product.creator.display_name}</span>
            </div>
          )}

          <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug flex-1 mb-2">
            {product.title}
          </p>

          {!compact && product.categories && product.categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {product.categories.slice(0, 2).map(cat => (
                <span key={cat} className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-100">
                  {CATEGORY_LABEL_MAP[cat] ?? cat}
                </span>
              ))}
              {product.categories.length > 2 && (
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500">
                  +{product.categories.length - 2} mehr
                </span>
              )}
            </div>
          )}

          {rating && (
            <div className="mb-1">
              <StarRating rating={rating.avg} count={rating.count} size="sm" />
            </div>
          )}

          {salesCount >= 50 && (
            <p className="text-[10px] text-gray-400 mb-1">{salesCount}× gekauft</p>
          )}

          <p className="text-green-700 font-bold text-sm mt-auto">{formatCurrency(product.price)}</p>
        </div>
      </div>
    </Link>
  )
}
