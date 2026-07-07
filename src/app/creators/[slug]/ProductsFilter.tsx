'use client'

import { useState } from 'react'
import { FileText, Video, BookOpen, Image as ImageIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import BuyButton from './BuyButton'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

interface Product {
  id: string
  title: string
  description: string | null
  type: ProductType
  price: number
  thumbnail_url?: string | null
  is_demo?: boolean
}

interface Props {
  products: Product[]
  purchasedIds: string[]
  isDemo?: boolean
  creatorId: string
  creatorName: string
  creatorSlug: string
}

type Filter = 'all' | ProductType

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'pdf', label: 'PDFs' },
  { key: 'video', label: 'Videos' },
  { key: 'course', label: 'Kurse' },
  { key: 'image', label: 'Bilder' },
]

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText  className="h-5 w-5 text-white/80" />,
  video:  <Video     className="h-5 w-5 text-white/80" />,
  course: <BookOpen  className="h-5 w-5 text-white/80" />,
  image:  <ImageIcon className="h-5 w-5 text-white/80" />,
}

const TYPE_GRADIENTS: Record<ProductType, string> = {
  pdf:    'from-blue-500 to-blue-700',
  video:  'from-violet-500 to-violet-700',
  course: 'from-amber-400 to-orange-500',
  image:  'from-pink-500 to-rose-600',
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF',
  video: 'Video',
  course: 'Kurs',
  image: 'Bild',
}

export default function ProductsFilter({ products, purchasedIds, isDemo = false, creatorId, creatorName, creatorSlug }: Props) {
  const [active, setActive] = useState<Filter>('all')

  const purchasedSet = new Set(purchasedIds)

  const filtered = active === 'all' ? products : products.filter(p => p.type === active)

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              active === key
                ? 'bg-black text-white border-black'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Products */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="text-center py-10">
              <p className="text-gray-500">Keine Produkte in dieser Kategorie.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map(product => {
            const owned = purchasedSet.has(product.id)
            const productIsDemo = isDemo || (product.is_demo ?? false)
            return (
              <Card key={product.id}>
                <CardContent className="flex items-start gap-4 p-5">
                  <Link
                    href={`/products/${product.id}`}
                    aria-label={product.title}
                    className="relative h-12 w-12 rounded-xl overflow-hidden flex-shrink-0 block"
                  >
                    {product.thumbnail_url ? (
                      <Image src={product.thumbnail_url} alt="" fill sizes="48px" className="object-cover" />
                    ) : (
                      <div className={`absolute inset-0 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center`}>
                        {TYPE_ICONS[product.type]}
                      </div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link href={`/products/${product.id}`} className="hover:text-green-700 transition-colors">
                        <h3 className="font-medium text-gray-900">{product.title}</h3>
                      </Link>
                      <Badge variant="outline">{TYPE_LABELS[product.type]}</Badge>
                    </div>
                    {product.description && (
                      <p className="text-sm text-gray-500 line-clamp-2">{product.description}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className="font-semibold text-gray-900">{formatCurrency(product.price)}</span>
                    {owned ? (
                      <Badge variant="success">Gekauft</Badge>
                    ) : (
                      <BuyButton productId={product.id} price={product.price} title={product.title} type={product.type} creatorId={creatorId} creatorName={creatorName} creatorSlug={creatorSlug} isDemo={productIsDemo} />
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
