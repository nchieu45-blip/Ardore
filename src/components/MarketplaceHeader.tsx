import Link from 'next/link'
import { Search, X, ShoppingBag, UserRound, UsersRound } from 'lucide-react'
import { marketplaceAreaHref, type MarketplaceArea } from '@/lib/marketplaceAreas'
import { discoveryHref } from '@/components/ui/DiscoveryNavigation'
import type { ReactNode } from 'react'

export default function MarketplaceHeader({ area, search, category = 'all', onSearchChange, children }: {
  area: MarketplaceArea
  search: string
  category?: string
  onSearchChange: (value: string) => void
  children?: ReactNode
}) {
  const normalizedSearch = search.trim().replace(/\s+/g, ' ')
  const searchLabel = area === 'products'
    ? 'Produkte nach Titel, Coach oder Kategorie suchen'
    : area === 'coaching'
      ? '1:1 Coaching nach Coach oder Thema suchen'
      : 'Gruppencoaching nach Angebot, Coach oder Thema suchen'

  return (
    <section className="border-b border-border bg-surface">
      <div className="ardore-container py-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Marktplatz entdecken</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">Digitale Produkte, persönliches Coaching und gemeinsame Sessions.</p>
          </div>
          <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4" href={discoveryHref('/coaches', normalizedSearch, category)}>Alle Coach-Profile</Link>
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-stretch">
          <nav aria-label="Angebotsbereiche im Marktplatz" className="marketplace-area-nav">
            {([
              { key: 'products', label: 'Produkte', Icon: ShoppingBag },
              { key: 'coaching', label: '1:1 Coaching', Icon: UserRound },
              { key: 'groups', label: 'Gruppencoaching', Icon: UsersRound },
            ] as const).map(({ key, label, Icon }) => (
              <Link key={key} href={marketplaceAreaHref(key, normalizedSearch, category)} scroll={false} aria-label={label} aria-current={area === key ? 'page' : undefined} className="marketplace-area-link">
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                <span>{key === 'groups' ? <>Gruppen<wbr />coaching</> : label}</span>
              </Link>
            ))}
          </nav>
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">{searchLabel}</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input aria-label={searchLabel} value={search} onChange={event => onSearchChange(event.target.value)} onBlur={() => onSearchChange(normalizedSearch)} placeholder={area === 'products' ? 'Produkt, Coach oder Thema suchen' : 'Angebot, Coach oder Thema suchen'} className="field-control min-h-12 w-full pl-12 pr-12" />
            {normalizedSearch && <button type="button" onClick={() => onSearchChange('')} aria-label="Suche löschen" className="icon-button absolute right-1 top-1/2 -translate-y-1/2 text-muted"><X className="h-4 w-4" aria-hidden="true" /></button>}
          </label>
        </div>
        {children}
      </div>
    </section>
  )
}
