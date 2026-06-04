'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Search, ChevronDown,
  TrendingUp, Sparkles, ShieldCheck, Check, SlidersHorizontal,
  Star, BarChart2, CreditCard, ShoppingBag,
  Share2, Rocket, CheckCircle2, ArrowRight, ChevronLeft,
} from 'lucide-react'
import MarketplaceRows from './MarketplaceRows'
import Link from 'next/link'
import { EQUIPMENT_OPTIONS, LEVEL_OPTIONS, DURATION_OPTIONS } from '@/lib/productOptions'
import { ProductCard } from '@/components/ui/ProductCard'
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
  thumbnail_url: string | null
  equipment: string[]
  level: string | null
  duration: string | null
  creator: Creator
}

interface Props {
  products: MarketplaceProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
}

type TopicFilter = 'all' | string
type TypeFilter = 'all' | ProductType
type SortKey = 'popular' | 'newest' | 'price_asc' | 'price_desc' | 'top_rated' | 'best_selling'

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
  { key: 'popular',      label: 'Beliebteste' },
  { key: 'best_selling', label: 'Meistverkauft' },
  { key: 'top_rated',    label: 'Best bewertet' },
  { key: 'newest',       label: 'Neueste' },
  { key: 'price_asc',    label: 'Preis ↑' },
  { key: 'price_desc',   label: 'Preis ↓' },
]

const TRUST_BADGES = [
  { icon: <ShieldCheck className="h-4 w-4 text-green-600" />, label: 'Geprüfte Coaches' },
  { icon: <Sparkles    className="h-4 w-4 text-green-600" />, label: 'Premium Inhalte' },
  { icon: <TrendingUp  className="h-4 w-4 text-green-600" />, label: 'Top Bestseller' },
]

const TRUST_ITEMS = [
  {
    icon: <ShieldCheck className="h-5 w-5 text-green-600" />,
    title: 'Qualifizierte Coaches',
    desc: 'Coaches können ihre Ausbildung und Zertifikate hinterlegen — transparent einsehbar in jedem Profil.',
  },
  {
    icon: <Star className="h-5 w-5 text-amber-500" />,
    title: 'Echte Bewertungen',
    desc: 'Nur verifizierte Käufer können bewerten. Keine Fake-Reviews.',
  },
  {
    icon: <BarChart2 className="h-5 w-5 text-green-600" />,
    title: 'Transparente Verkaufszahlen',
    desc: 'Du siehst, wie oft ein Produkt schon gekauft wurde.',
  },
  {
    icon: <CreditCard className="h-5 w-5 text-green-600" />,
    title: 'Sichere Zahlungen via Stripe',
    desc: 'Geld-zurück-Garantie bei jedem Kauf.',
  },
]


export default function MarketplaceClient({ products, salesCounts, ratings }: Props) {
  const [topic, setTopic] = useState<TopicFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('popular')
  const [search, setSearch] = useState('')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const categoryRef = useRef<HTMLDivElement>(null)

  // Advanced filters
  const [equipment, setEquipment] = useState<string[]>([])
  const [level, setLevel] = useState<string | null>(null)
  const [duration, setDuration] = useState<string | null>(null)
  const [equipmentOpen, setEquipmentOpen] = useState(false)
  const [levelOpen, setLevelOpen] = useState(false)
  const [durationOpen, setDurationOpen] = useState(false)

  const advancedActive = equipment.length > 0 || !!level || !!duration

  function resetAdvanced() {
    setEquipment([])
    setLevel(null)
    setDuration(null)
  }

  function clearAll() {
    setSearch('')
    setTopic('all')
    setType('all')
    setSort('popular')
    resetAdvanced()
  }

  function toggleEquipment(val: string) {
    setEquipment(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val])
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setCategoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const showGridView = topic !== 'all' || type !== 'all' || search !== '' || advancedActive || sort !== 'popular'

  const filtered = products
    .filter(p => {
      const matchesTopic     = topic === 'all' || p.creator.categories.includes(topic) || p.creator.category === topic
      const matchesType      = type  === 'all' || p.type === type
      const matchesSearch    = !search
        || p.title.toLowerCase().includes(search.toLowerCase())
        || p.creator.display_name.toLowerCase().includes(search.toLowerCase())
      const matchesEquipment = equipment.length === 0 || equipment.some(e => p.equipment.includes(e))
      const matchesLevel     = !level || p.level === level
      const matchesDuration  = !duration || p.duration === duration
      return matchesTopic && matchesType && matchesSearch && matchesEquipment && matchesLevel && matchesDuration
    })
    .sort((a, b) => {
      switch (sort) {
        case 'popular':      return (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
        case 'best_selling': return (salesCounts[b.id] ?? 0) - (salesCounts[a.id] ?? 0)
        case 'top_rated':    return (ratings[b.id]?.avg ?? 0) - (ratings[a.id]?.avg ?? 0)
        case 'newest':       return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'price_asc':    return a.price - b.price
        case 'price_desc':   return b.price - a.price
      }
    })

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

      {/* ── Trust section ───────────────────────────────────────── */}
      <section className="bg-white border-b border-gray-100 py-10 px-4">
        <div className="max-w-7xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TRUST_ITEMS.map(item => (
            <div key={item.title} className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                {item.icon}
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-0.5">{item.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {showGridView ? (
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Back to rows */}
          <div className="mb-6">
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Zur Übersicht
            </button>
          </div>

          {/* ── Filters ──────────────────────────────────────────────── */}
          <div className="space-y-3 mb-6 animate-slide-up animate-delay-100">
            {/* Row 1: category + type pills + sort */}
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

            {/* Row 2: advanced filter accordions */}
            <div className="rounded-2xl border border-gray-100 bg-white divide-y divide-gray-50 overflow-hidden">
              {/* Equipment */}
              <div>
                <button
                  onClick={() => setEquipmentOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    Equipment / Voraussetzungen
                    {equipment.length > 0 && (
                      <span className="h-4 w-4 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">{equipment.length}</span>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${equipmentOpen ? 'rotate-180' : ''}`} />
                </button>
                {equipmentOpen && (
                  <div className="px-4 pb-4 flex flex-wrap gap-2">
                    {EQUIPMENT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => toggleEquipment(opt.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          equipment.includes(opt.value)
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Level */}
              <div>
                <button
                  onClick={() => setLevelOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    Level
                    {level && (
                      <span className="h-4 w-4 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">1</span>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${levelOpen ? 'rotate-180' : ''}`} />
                </button>
                {levelOpen && (
                  <div className="px-4 pb-4 flex flex-wrap gap-2">
                    {LEVEL_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setLevel(level === opt.value ? null : opt.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          level === opt.value
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Duration */}
              <div>
                <button
                  onClick={() => setDurationOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    Dauer
                    {duration && (
                      <span className="h-4 w-4 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">1</span>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${durationOpen ? 'rotate-180' : ''}`} />
                </button>
                {durationOpen && (
                  <div className="px-4 pb-4 flex flex-wrap gap-2">
                    {DURATION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setDuration(duration === opt.value ? null : opt.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          duration === opt.value
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Reset advanced filters */}
            {advancedActive && (
              <button
                onClick={resetAdvanced}
                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
              >
                Erweiterte Filter zurücksetzen
              </button>
            )}
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
              {filtered.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  salesCount={salesCounts[product.id]}
                  rating={ratings[product.id]}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <MarketplaceRows
          products={products}
          salesCounts={salesCounts}
          ratings={ratings}
        />
      )}

      {/* ── Für Coaches ──────────────────────────────────────────── */}
      <section className="bg-gray-50 border-t border-gray-100 py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Du bist Coach?</h2>
            <p className="text-gray-500 text-sm">Ardore ist dein Verkaufskanal — ohne eigene Website.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-green-100 p-7 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-green-600 flex items-center justify-center mb-4 shadow-sm">
                <Share2 className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-bold text-gray-900 mb-2">Du hast schon eine Community?</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-5 flex-1">
                Nutze Ardore als zweiten Vertriebskanal. Deine Follower kaufen über einen professionellen Marktplatz — mit echten Bewertungen und Vertrauen.
              </p>
              <Link href="/landing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800 transition-colors">
                Mehr erfahren <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-7 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-gray-900 flex items-center justify-center mb-4 shadow-sm">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-bold text-gray-900 mb-2">Du startest gerade erst?</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-5 flex-1">
                Spar dir tausende Euro für eine eigene Website und Stripe-Integration. Auf Ardore bist du in 10 Minuten live und Kunden finden dich automatisch.
              </p>
              <Link href="/landing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors">
                Mehr erfahren <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── So funktioniert Ardore ───────────────────────────────── */}
      <section className="bg-gradient-to-br from-green-950 to-green-800 py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">So funktioniert Ardore</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: 1,
                icon: <Search className="h-6 w-6 text-white/90" />,
                title: 'Coach finden',
                desc: 'Suche, filtere nach Kategorie oder nutze den KI-Coach-Finder für eine persönliche Empfehlung.',
              },
              {
                step: 2,
                icon: <ShoppingBag className="h-6 w-6 text-white/90" />,
                title: 'Produkt kaufen oder Abo',
                desc: 'Kaufe Inhalte einmalig oder schließ ein Monatsabo für Chat-Zugang und regelmäßige Updates ab.',
              },
              {
                step: 3,
                icon: <CheckCircle2 className="h-6 w-6 text-white/90" />,
                title: 'Direkt loslegen',
                desc: 'Lade deine Inhalte sofort herunter oder chatte direkt mit deinem Coach.',
              },
            ].map(s => (
              <div key={s.step} className="text-center">
                <div className="h-14 w-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mx-auto mb-4">
                  {s.icon}
                </div>
                <p className="text-[10px] font-bold text-green-300 uppercase tracking-widest mb-1.5">Schritt {s.step}</p>
                <h3 className="font-bold text-white mb-2">{s.title}</h3>
                <p className="text-sm text-green-100/70 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
