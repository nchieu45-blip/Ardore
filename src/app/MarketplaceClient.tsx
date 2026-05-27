'use client'

import { useState } from 'react'
import { Search, FileText, Video, BookOpen, Image as ImageIcon, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

interface Creator {
  display_name: string
  avatar_url: string | null
  slug: string
  category: string | null
}

export interface MarketplaceProduct {
  id: string
  title: string
  description: string | null
  type: ProductType
  price: number
  createdAt: string
  creator: Creator
}

interface Props {
  products: MarketplaceProduct[]
  bestsellers: MarketplaceProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
}

type TopicFilter = 'all' | string
type TypeFilter = 'all' | ProductType
type SortKey = 'popular' | 'newest' | 'price_asc' | 'price_desc'

const TOPIC_FILTERS: { key: TopicFilter; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'fitness', label: 'Fitness' },
  { key: 'ernaehrung', label: 'Ernährung' },
  { key: 'mental', label: 'Mental Health' },
  { key: 'abnehmen', label: 'Abnehmen' },
  { key: 'schlaf', label: 'Schlaf' },
  { key: 'yoga', label: 'Yoga' },
  { key: 'laufen', label: 'Laufen' },
  { key: 'krafttraining', label: 'Krafttraining' },
  { key: 'meditation', label: 'Meditation' },
  { key: 'stressmanagement', label: 'Stressmanagement' },
  { key: 'rueckenschmerzen', label: 'Rückenschmerzen' },
  { key: 'schwangerschaft', label: 'Schwangerschaft & Postnatal' },
  { key: 'mobility', label: 'Mobility & Dehnen' },
]

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'Alle Typen' },
  { key: 'pdf', label: 'PDF' },
  { key: 'video', label: 'Video' },
  { key: 'course', label: 'Kurs' },
  { key: 'image', label: 'Bild' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'popular', label: 'Beliebteste' },
  { key: 'newest', label: 'Neueste' },
  { key: 'price_asc', label: 'Preis aufsteigend' },
  { key: 'price_desc', label: 'Preis absteigend' },
]

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf: <FileText className="h-8 w-8 text-white" />,
  video: <Video className="h-8 w-8 text-white" />,
  course: <BookOpen className="h-8 w-8 text-white" />,
  image: <ImageIcon className="h-8 w-8 text-white" />,
}

const TYPE_GRADIENTS: Record<ProductType, string> = {
  pdf: 'from-blue-400 to-blue-600',
  video: 'from-purple-400 to-purple-600',
  course: 'from-amber-400 to-amber-600',
  image: 'from-pink-400 to-pink-600',
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF',
  video: 'Video',
  course: 'Kurs',
  image: 'Bild',
}

export default function MarketplaceClient({ products, bestsellers, salesCounts, ratings }: Props) {
  const [topic, setTopic] = useState<TopicFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('popular')
  const [search, setSearch] = useState('')

  const isFiltered = topic !== 'all' || type !== 'all' || search !== ''

  const filtered = products
    .filter(p => {
      const matchesTopic = topic === 'all' || p.creator.category === topic
      const matchesType = type === 'all' || p.type === type
      const matchesSearch =
        !search ||
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.creator.display_name.toLowerCase().includes(search.toLowerCase())
      return matchesTopic && matchesType && matchesSearch
    })
    .sort((a, b) => {
      switch (sort) {
        case 'popular':
          return (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'price_asc':
          return a.price - b.price
        case 'price_desc':
          return b.price - a.price
      }
    })

  const showBestsellers = bestsellers.length > 0 && !isFiltered

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-green-50 to-white py-14 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-3xl md:text-5xl font-bold text-gray-900 mb-3">
            Entdecke Premium-Inhalte
          </h1>
          <p className="text-gray-500 mb-8 text-lg max-w-xl mx-auto">
            Kurse, PDFs und Videos von den besten Gesundheits- und Fitnesscoaches
          </p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Produkte oder Coaches suchen..."
              className="w-full pl-12 pr-4 py-3.5 border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
            />
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Bestsellers */}
        {showBestsellers && (
          <div className="mb-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Bestseller</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {bestsellers.map((product, i) => (
                <Link key={product.id} href={`/creators/${product.creator.slug}`}>
                  <div className={`relative rounded-2xl overflow-hidden border-2 ${i === 0 ? 'border-amber-400' : 'border-gray-200'} hover:shadow-md transition-shadow bg-white`}>
                    <div className={`h-28 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center relative`}>
                      {TYPE_ICONS[product.type]}
                      <span className={`absolute top-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full ${i === 0 ? 'bg-amber-400 text-white' : 'bg-white/30 text-white'}`}>
                        #{i + 1}
                      </span>
                      {i === 0 && (
                        <span className="absolute top-2 right-2 text-xs font-semibold bg-amber-400 text-white px-2 py-0.5 rounded-full">
                          Bestseller
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-xs text-gray-500 mb-0.5 truncate">{product.creator.display_name}</p>
                      <p className="font-medium text-gray-900 text-sm line-clamp-2 mb-1">{product.title}</p>
                      {ratings[product.id] && (
                        <div className="mb-1">
                          <StarRating rating={ratings[product.id].avg} count={ratings[product.id].count} size="sm" />
                        </div>
                      )}
                      <p className="text-green-600 font-semibold text-sm">{formatCurrency(product.price)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Filter system */}
        <div className="space-y-3 mb-8">
          {/* Row 1: Topic pills */}
          <div className="flex flex-wrap gap-2">
            {TOPIC_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTopic(key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  topic === key
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Row 2: Type pills + sort dropdown */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex flex-wrap gap-2">
              {TYPE_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setType(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    type === key
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Sort dropdown */}
            <div className="relative flex-shrink-0">
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer"
              >
                {SORT_OPTIONS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Result count */}
        <p className="text-sm text-gray-400 mb-5">
          {filtered.length} {filtered.length === 1 ? 'Produkt' : 'Produkte'}
        </p>

        {/* Product grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">Keine Produkte gefunden.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {filtered.map(product => (
              <Link key={product.id} href={`/creators/${product.creator.slug}`}>
                <div className="rounded-2xl overflow-hidden border border-gray-200 hover:shadow-md hover:border-green-300 transition-all h-full bg-white flex flex-col">
                  <div className={`h-36 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center flex-shrink-0`}>
                    {TYPE_ICONS[product.type]}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar src={product.creator.avatar_url} name={product.creator.display_name} size="sm" className="h-5 w-5 text-[10px]" />
                      <span className="text-xs text-gray-500 truncate">{product.creator.display_name}</span>
                    </div>
                    <h3 className="font-medium text-gray-900 text-sm line-clamp-2 mb-2 flex-1">{product.title}</h3>
                    {ratings[product.id] && (
                      <div className="mb-2">
                        <StarRating rating={ratings[product.id].avg} count={ratings[product.id].count} size="sm" />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{TYPE_LABELS[product.type]}</Badge>
                      <span className="font-semibold text-gray-900 text-sm">{formatCurrency(product.price)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
