'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Search, FileText, Video, BookOpen, Image as ImageIcon, ChevronDown,
  TrendingUp, Sparkles, ShieldCheck, Check, SlidersHorizontal, Users,
} from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import CoachFinderWidget from '@/components/CoachFinderWidget'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

interface Creator {
  display_name: string
  avatar_url: string | null
  slug: string
  category: string | null
  categories: string[]
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
  { key: 'pilates', label: 'Pilates' },
  { key: 'muskelaufbau', label: 'Muskelaufbau' },
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
  { key: 'price_asc', label: 'Preis ↑' },
  { key: 'price_desc', label: 'Preis ↓' },
]

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText className="h-9 w-9 text-white/90" />,
  video:  <Video    className="h-9 w-9 text-white/90" />,
  course: <BookOpen className="h-9 w-9 text-white/90" />,
  image:  <ImageIcon className="h-9 w-9 text-white/90" />,
}

const TYPE_GRADIENTS: Record<ProductType, string> = {
  pdf:    'from-blue-500 to-blue-700',
  video:  'from-violet-500 to-violet-700',
  course: 'from-amber-400 to-orange-500',
  image:  'from-pink-500 to-rose-600',
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

const TRUST_BADGES = [
  { icon: <ShieldCheck className="h-4 w-4 text-green-600" />, label: 'Geprüfte Coaches' },
  { icon: <Sparkles    className="h-4 w-4 text-green-600" />, label: 'Premium Inhalte' },
  { icon: <TrendingUp  className="h-4 w-4 text-green-600" />, label: 'Top Bestseller' },
]

export default function MarketplaceClient({ products, bestsellers, salesCounts, ratings }: Props) {
  const [topic, setTopic] = useState<TopicFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('popular')
  const [search, setSearch] = useState('')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const categoryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setCategoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isFiltered = topic !== 'all' || type !== 'all' || search !== ''

  const filtered = products
    .filter(p => {
      const matchesTopic  = topic === 'all' || p.creator.categories.includes(topic) || p.creator.category === topic
      const matchesType   = type  === 'all' || p.type === type
      const matchesSearch = !search
        || p.title.toLowerCase().includes(search.toLowerCase())
        || p.creator.display_name.toLowerCase().includes(search.toLowerCase())
      return matchesTopic && matchesType && matchesSearch
    })
    .sort((a, b) => {
      switch (sort) {
        case 'popular':   return (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
        case 'newest':    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'price_asc': return a.price - b.price
        case 'price_desc':return b.price - a.price
      }
    })

  const showBestsellers = bestsellers.length > 0 && !isFiltered

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-green-800 py-20 px-4">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-green-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-green-700/10 blur-3xl" />

        <div className="relative max-w-4xl mx-auto text-center">
          {/* Label */}
          <div className="animate-slide-up inline-flex items-center gap-2 bg-white/10 text-green-100 text-xs font-medium px-3.5 py-1.5 rounded-full border border-white/20 mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            Gesundheit &amp; Fitness Marketplace
          </div>

          <h1 className="animate-slide-up animate-delay-100 text-4xl md:text-6xl font-bold text-white mb-4 leading-tight tracking-tight">
            Entdecke Premium-Inhalte<br className="hidden md:block" />
            <span className="text-green-300"> von echten Experten</span>
          </h1>

          <p className="animate-slide-up animate-delay-200 text-green-100/80 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Kurse, Guides und Videos von geprüften Gesundheits- und Fitnesscoaches
          </p>

          {/* Search */}
          <div className="animate-slide-up animate-delay-300 relative max-w-xl mx-auto mb-10">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Produkte oder Coaches suchen..."
              className="w-full pl-12 pr-4 py-4 rounded-2xl text-sm shadow-lg focus:outline-none focus:ring-2 focus:ring-green-400 bg-white text-gray-900 placeholder-gray-400"
            />
          </div>

          {/* KI-Coach-Finder */}
          <div className="animate-slide-up animate-delay-400 w-full max-w-xl mx-auto mb-8">
            <CoachFinderWidget />
          </div>

          {/* Trust badges */}
          <div className="animate-slide-up animate-delay-500 flex flex-wrap items-center justify-center gap-4">
            {TRUST_BADGES.map(b => (
              <div key={b.label} className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm border border-white/10 text-white/80 text-xs px-3 py-1.5 rounded-full">
                {b.icon}
                {b.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-12">

        {/* ── Bestsellers ─────────────────────────────────────────── */}
        {showBestsellers && (
          <section className="mb-14 animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-amber-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Bestseller</h2>
              </div>
              <Link href="/creators" className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors flex items-center gap-1">
                Alle Coaches <span>→</span>
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {bestsellers.map((product, i) => (
                <Link key={product.id} href={`/creators/${product.creator.slug}`}>
                  <div className={`group relative rounded-2xl overflow-hidden border-2 transition-all duration-200 bg-white hover:-translate-y-1 hover:shadow-xl ${i === 0 ? 'border-amber-300 shadow-amber-100 shadow-md' : 'border-gray-100 hover:border-gray-200'}`}>
                    <div className={`h-32 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center relative`}>
                      <div className="absolute inset-0 bg-black/10" />
                      <div className="relative">{TYPE_ICONS[product.type]}</div>
                      <span className={`absolute top-2.5 left-2.5 text-xs font-bold px-2 py-0.5 rounded-full ${i === 0 ? 'bg-amber-400 text-white' : 'bg-black/30 text-white'}`}>
                        #{i + 1}
                      </span>
                      {i === 0 && (
                        <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold bg-amber-400 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                          <TrendingUp className="h-2.5 w-2.5" /> Bestseller
                        </span>
                      )}
                    </div>
                    <div className="p-3.5">
                      <p className="text-xs text-gray-400 mb-0.5 truncate">{product.creator.display_name}</p>
                      <p className="font-semibold text-gray-900 text-sm line-clamp-2 mb-2 leading-snug">{product.title}</p>
                      {ratings[product.id] && (
                        <div className="mb-2">
                          <StarRating rating={ratings[product.id].avg} count={ratings[product.id].count} size="sm" />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full font-medium">{TYPE_LABELS[product.type]}</span>
                        <span className="text-green-700 font-bold text-sm">{formatCurrency(product.price)}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Filters ──────────────────────────────────────────────── */}
        <div className="space-y-3 mb-8 animate-slide-up animate-delay-100">
          {/* Category dropdown + type pills + sort — all in one row */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex flex-wrap gap-2 items-center">
              {/* Category dropdown */}
              <div ref={categoryRef} className="relative">
                <button
                  onClick={() => setCategoryOpen((o) => !o)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all duration-150 ${
                    topic !== 'all'
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900'
                  }`}
                >
                  {topic === 'all' ? 'Kategorie' : TOPIC_FILTERS.find(f => f.key === topic)?.label}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${categoryOpen ? 'rotate-180' : ''}`} />
                </button>
                {categoryOpen && (
                  <div className="absolute left-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 z-40 animate-scale-in">
                    {TOPIC_FILTERS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => { setTopic(key); setCategoryOpen(false) }}
                        className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        {label}
                        {topic === key && <Check className="h-3.5 w-3.5 text-green-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <SlidersHorizontal className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
              {TYPE_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setType(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 ${
                    type === key
                      ? 'bg-gray-800 text-white'
                      : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative flex-shrink-0">
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer"
              >
                {SORT_OPTIONS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Result count */}
        <p className="text-xs text-gray-400 font-medium mb-5 uppercase tracking-wide">
          {filtered.length} {filtered.length === 1 ? 'Produkt' : 'Produkte'}
        </p>

        {/* ── Product grid ─────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <div className="text-center py-24 animate-fade-in">
            <div className="h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <Search className="h-7 w-7 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium mb-1">Keine Produkte gefunden</p>
            <p className="text-sm text-gray-400">Versuche andere Filter oder einen anderen Suchbegriff.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {filtered.map((product, i) => (
              <Link key={product.id} href={`/creators/${product.creator.slug}`}>
                <div
                  className="group rounded-2xl overflow-hidden border border-gray-100 bg-white flex flex-col h-full transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-gray-200"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                >
                  {/* Thumbnail */}
                  <div className={`relative h-40 bg-gradient-to-br ${TYPE_GRADIENTS[product.type]} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
                    <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition-colors" />
                    <div className="relative group-hover:scale-110 transition-transform duration-300">
                      {TYPE_ICONS[product.type]}
                    </div>
                    <span className="absolute top-3 right-3 text-[10px] font-semibold bg-black/30 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
                      {TYPE_LABELS[product.type]}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Avatar src={product.creator.avatar_url} name={product.creator.display_name} size="sm" className="h-5 w-5 text-[10px] flex-shrink-0" />
                      <span className="text-xs text-gray-500 truncate">{product.creator.display_name}</span>
                    </div>

                    <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-2 flex-1 leading-snug">
                      {product.title}
                    </h3>

                    {ratings[product.id] && (
                      <div className="mb-3">
                        <StarRating rating={ratings[product.id].avg} count={ratings[product.id].count} size="sm" />
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-gray-50 mt-auto">
                      {product.creator.category && (
                        <span className="text-[11px] text-gray-400 truncate max-w-[100px]">{product.creator.category}</span>
                      )}
                      <span className="font-bold text-gray-900 text-sm ml-auto">{formatCurrency(product.price)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* ── CTA banner ───────────────────────────────────────────── */}
        {!isFiltered && products.length > 0 && (
          <section className="mt-16 rounded-3xl bg-gradient-to-br from-green-900 to-green-700 p-10 text-center relative overflow-hidden">
            <div className="pointer-events-none absolute -top-8 -right-8 h-48 w-48 rounded-full bg-green-600/30 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-8 -left-8 h-48 w-48 rounded-full bg-emerald-400/20 blur-2xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 bg-white/10 text-green-100 text-xs font-medium px-3.5 py-1.5 rounded-full border border-white/20 mb-4">
                <Users className="h-3.5 w-3.5" />
                Für Coaches
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">Du bist Coach?</h2>
              <p className="text-green-100/80 mb-6 max-w-md mx-auto">Verkaufe deine Kurse, PDFs und Videos auf Ardore und erreiche tausende von Kunden.</p>
              <Link href="/landing">
                <span className="inline-flex items-center gap-2 bg-white text-green-800 font-semibold px-6 py-3 rounded-xl hover:bg-green-50 transition-colors shadow-lg">
                  Jetzt starten →
                </span>
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
