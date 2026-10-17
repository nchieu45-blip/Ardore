'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import MarketplaceHeader from '@/components/MarketplaceHeader'
import DiscoveryRail from '@/components/DiscoveryRail'
import { CoachingOfferCard } from '@/components/ui/CoachingOfferCard'
import { Button, ButtonLink } from '@/components/ui/Button'
import { StatePanel } from '@/components/ui/StatePanel'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'
import { marketplaceAreaHref } from '@/lib/marketplaceAreas'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import { buildServiceRows, sortMarketplaceServices } from '@/lib/marketplaceServices'
import type { MarketplaceServiceOffer } from '@/lib/publicCoachingMarketplace'

const PAGE_SIZE = 20
const normalizeSearch = (value: string) => value.trim().replace(/\s+/g, ' ')

export default function ServiceMarketplaceClient({ area, offers, error, ratingsUnavailable }: {
  area: 'coaching' | 'groups'
  offers: MarketplaceServiceOffer[]
  error: boolean
  ratingsUnavailable: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const summary = useRef<HTMLParagraphElement>(null)
  const kind = area === 'coaching' ? 'coaching' : 'group'
  const label = area === 'coaching' ? '1:1 Coaching' : 'Gruppencoaching'
  const category = params.get('category') ?? 'all'
  const urlSearch = normalizeSearch(params.get('q') ?? '')
  const [searchState, setSearchState] = useState({ value: urlSearch, syncedUrl: urlSearch })
  if (searchState.syncedUrl !== urlSearch) setSearchState({ value: urlSearch, syncedUrl: urlSearch })
  const search = searchState.value
  const normalizedSearch = normalizeSearch(search)
  const setSearch = (value: string) => setSearchState(current => ({ ...current, value }))
  const rawPrice = params.get('max_price')
  const maxPrice = rawPrice !== null && rawPrice !== '' && Number.isFinite(Number(rawPrice)) && Number(rawPrice) >= 0 ? Number(rawPrice) : null
  const sortOptions = [
    { key: 'newest', label: 'Neueste' },
    ...(area === 'coaching' ? [{ key: 'top_rated', label: 'Best bewertet' }] : [{ key: 'upcoming', label: 'Kommende Termine' }]),
    { key: 'price_asc', label: 'Preis aufsteigend' },
    { key: 'price_desc', label: 'Preis absteigend' },
  ]
  const rawSort = params.get('sort')
  const sort = sortOptions.some(option => option.key === rawSort) ? rawSort! : 'newest'
  const scopedOffers = offers.filter(offer => offer.kind === kind)
  const categories = [...new Set(scopedOffers.flatMap(offer => [
    ...offer.creator.categories,
    ...(offer.creator.category ? [offer.creator.category] : []),
  ]))].filter(key => Object.hasOwn(CATEGORY_LABEL_MAP, key)).sort((a, b) => CATEGORY_LABEL_MAP[a].localeCompare(CATEGORY_LABEL_MAP[b], 'de'))
  const hasFilters = category !== 'all' || maxPrice !== null || !!normalizedSearch
  const rawPage = params.get('page')
  const requestedPage = rawPage && /^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? Number(rawPage) : 1
  const filtered = sortMarketplaceServices(scopedOffers.filter(offer => {
    const keys = [...offer.creator.categories, offer.creator.category ?? '']
    const haystack = [offer.title, offer.description ?? '', offer.creator.display_name, ...keys.flatMap(key => [key, CATEGORY_LABEL_MAP[key] ?? ''])].join(' ').toLocaleLowerCase('de-DE')
    return (category === 'all' || keys.includes(category))
      && (maxPrice === null || offer.priceCents <= maxPrice * 100)
      && (!normalizedSearch || haystack.includes(normalizedSearch.toLocaleLowerCase('de-DE')))
  }), sort)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const isOverview = !hasFilters && !params.has('sort') && page === 1
  const rows = isOverview ? buildServiceRows(filtered, kind) : []
  const pageOffers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function href(overrides: { category?: string; search?: string; sort?: string; price?: string; page?: number } = {}) {
    const query = new URLSearchParams()
    query.set('area', area)
    const cat = overrides.category ?? category
    const q = 'search' in overrides ? normalizeSearch(overrides.search ?? '') : normalizedSearch
    const order = overrides.sort ?? rawSort
    const price = overrides.price ?? (maxPrice === null ? '' : String(maxPrice))
    const nextPage = overrides.page ?? page
    if (cat !== 'all') query.set('category', cat)
    if (q) query.set('q', q)
    if (order) query.set('sort', order)
    if (price !== '') query.set('max_price', price)
    if (nextPage > 1) query.set('page', String(nextPage))
    return `/marketplace?${query}`
  }
  function go(overrides: Parameters<typeof href>[0]) { router.push(href(overrides), { scroll: false }) }
  function reset() {
    setSearch('')
    router.push(marketplaceAreaHref(area), { scroll: false })
  }
  function goToPage(nextPage: number) {
    go({ page: nextPage })
    summary.current?.focus()
    summary.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  useEffect(() => {
    if (normalizedSearch === urlSearch) return
    const timeout = window.setTimeout(() => {
      const query = new URLSearchParams(params.toString())
      if (normalizedSearch) query.set('q', normalizedSearch)
      else query.delete('q')
      query.delete('page')
      router.replace(`/marketplace?${query}`, { scroll: false })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [normalizedSearch, urlSearch, params, router])

  useEffect(() => {
    const normalizedPage = page > 1 ? String(page) : null
    if (rawPage === normalizedPage) return
    const query = new URLSearchParams(params.toString())
    if (normalizedPage) query.set('page', normalizedPage)
    else query.delete('page')
    router.replace(`/marketplace?${query}`, { scroll: false })
  }, [page, params, rawPage, router])

  return (
    <div className="discovery-browse min-h-screen">
      <MarketplaceHeader area={area} search={search} category={category} onSearchChange={setSearch} />
      <div className="border-b border-border bg-surface">
        <div className="ardore-container grid grid-cols-2 gap-3 py-4 sm:grid-cols-3">
          <label className="min-w-0"><span className="mb-1.5 block text-sm text-muted">Thema</span><select aria-label={`${label}: Thema`} className="field-control w-full" value={category} onChange={event => go({ category: event.target.value, page: 1 })}><option value="all">Alle Themen</option>{category !== 'all' && !categories.includes(category) && <option value={category}>{CATEGORY_LABEL_MAP[category] ?? category}</option>}{categories.map(key => <option key={key} value={key}>{CATEGORY_LABEL_MAP[key]}</option>)}</select></label>
          <label className="min-w-0"><span className="mb-1.5 block text-sm text-muted">Preis je Session</span><select aria-label={`${label}: Preis`} className="field-control w-full" value={maxPrice === null ? '' : String(maxPrice)} onChange={event => go({ price: event.target.value, page: 1 })}><option value="">Alle Preise</option>{[0, 25, 50, 100].map(price => <option key={price} value={price}>{price === 0 ? 'Kostenlos' : `Bis ${price} €`}</option>)}{maxPrice !== null && ![0, 25, 50, 100].includes(maxPrice) && <option value={maxPrice}>Bis {maxPrice.toLocaleString('de-DE')} €</option>}</select></label>
          <label className="col-span-2 min-w-0 sm:col-span-1"><span className="mb-1.5 block text-sm text-muted">Sortierung</span><select aria-label={`${label}: Sortierung`} className="field-control w-full" value={isOverview ? '' : sort} onChange={event => go({ sort: event.target.value, page: 1 })}>{!hasFilters && <option value="">Übersicht</option>}{sortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        </div>
      </div>
      <div className="ardore-container py-6">
        {error ? <StatePanel kind="error" title={`${label} konnte nicht geladen werden`} description="Bitte versuche es erneut." action={<Button variant="secondary" onClick={() => router.refresh()}>Erneut versuchen</Button>} /> : <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p ref={summary} role="status" aria-live="polite" tabIndex={-1} className="scroll-mt-24 text-sm text-muted focus:outline-none"><strong className="text-foreground">{filtered.length}</strong> {filtered.length === 1 ? 'Angebot' : 'Angebote'} für {label}</p>
            {hasFilters && <Button variant="tertiary" onClick={reset}><X className="h-4 w-4" aria-hidden="true" />Filter zurücksetzen</Button>}
          </div>
          {ratingsUnavailable && area === 'coaching' && <p role="status" className="mb-5 text-sm text-muted">Session-Bewertungen konnten gerade nicht geladen werden.</p>}
          {area === 'groups' && offers.length > 0 && !VIDEO_CALLS_ENABLED && <p className="mb-5 text-sm leading-relaxed text-muted">Die Video-Teilnahme an Gruppenangeboten ist derzeit noch nicht verfügbar.</p>}
          {filtered.length === 0 ? <StatePanel title={hasFilters ? `Keine passenden Angebote für ${label}` : `Noch keine Angebote für ${label}`} description={hasFilters ? 'Versuche einen anderen Suchbegriff oder setze die Filter zurück.' : 'Sobald Coaches aktive Angebote veröffentlichen, findest du sie hier.'} action={<>{hasFilters && <Button variant="secondary" onClick={reset}>Filter zurücksetzen</Button>}<ButtonLink variant="tertiary" href="/coaches">Coach-Profile ansehen</ButtonLink></>} /> : isOverview ? rows.map(row => <DiscoveryRail key={row.id} id={`marketplace-${area}-${row.id}`} title={row.title} description={row.description} href={row.href} linkLabel="Alle ansehen">{row.offers.map(offer => <CoachingOfferCard key={offer.id} offer={offer} />)}</DiscoveryRail>) : <DiscoveryRail key={params.toString()} id={`marketplace-${area}-results`} title={normalizedSearch ? 'Deine Suchergebnisse' : category === 'all' ? `Alle Angebote für ${label}` : CATEGORY_LABEL_MAP[category] ?? label} description={totalPages > 1 ? `Ergebnisse ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} von ${filtered.length}.` : 'Seitlich wischen oder mit den Pfeilen blättern.'}>{pageOffers.map(offer => <CoachingOfferCard key={offer.id} offer={offer} />)}</DiscoveryRail>}
          {!isOverview && totalPages > 1 && <nav aria-label={`${label}: Ergebnisseiten`} className="mt-6 flex flex-wrap items-center justify-center gap-4"><Button variant="secondary" disabled={page === 1} onClick={() => goToPage(page - 1)}>Zurück</Button><span className="text-sm text-muted">Seite {page} von {totalPages}</span><Button variant="secondary" disabled={page === totalPages} onClick={() => goToPage(page + 1)}>Weiter</Button></nav>}
        </>}
      </div>
    </div>
  )
}
