'use client'

import { useState, useEffect, useRef, useId } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import { CoachCard } from '@/components/ui/CoachCard'
import {
  DiscoveryNavigation,
  discoveryHref,
} from '@/components/ui/DiscoveryNavigation'
import { Button, ButtonLink } from '@/components/ui/Button'
import { StatePanel } from '@/components/ui/StatePanel'
import type { CoachData } from '@/lib/publicCoaches'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'
import { LANGUAGE_LABEL_MAP } from '@/lib/languages'

export default function CoachesPageClient({
  coaches,
}: {
  coaches: CoachData[]
}) {
  const router = useRouter(),
    params = useSearchParams()
  const category = params.get('category') ?? 'all',
    language = params.get('language') ?? 'all',
    sort = params.get('sort') ?? 'newest'
  const videocoaching = params.get('videocoaching') === 'true',
    groupclasses = params.get('groupclasses') === 'true',
    subscription = params.get('subscription') === 'true'
  const urlSearch = (params.get('q') ?? '').trim().replace(/\s+/g, ' ')
  const [searchState, setSearchState] = useState({
    value: urlSearch,
    syncedUrl: urlSearch,
  })
  if (searchState.syncedUrl !== urlSearch)
    setSearchState({ value: urlSearch, syncedUrl: urlSearch })
  const search = searchState.value
  const setSearch = (value: string) =>
    setSearchState((current) => ({ ...current, value }))
  const normalizedSearch = search.trim().replace(/\s+/g, ' ')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    titleId = useId()
  useEffect(() => {
    if (!filtersOpen) return
    const node = dialog.current,
      button = trigger.current,
      oldOverflow = document.body.style.overflow
    node?.showModal()
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !node) return
      const controls = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href]'
        )
      ).filter((control) => control.getClientRects().length > 0)
      const first = controls[0],
        last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    node?.addEventListener('keydown', onKeyDown)
    return () => {
      node?.removeEventListener('keydown', onKeyDown)
      node?.close()
      document.body.style.overflow = oldOverflow
      button?.focus()
    }
  }, [filtersOpen])
  useEffect(() => {
    if (normalizedSearch === urlSearch) return
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (normalizedSearch) next.set('q', normalizedSearch)
      else next.delete('q')
      router.replace(`/coaches${next.size ? `?${next}` : ''}`, {
        scroll: false,
      })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [normalizedSearch, urlSearch, router, params])
  function go(overrides: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(overrides)) {
      if (!value || value === 'all' || (key === 'sort' && value === 'newest'))
        next.delete(key)
      else next.set(key, value)
    }
    router.push(`/coaches${next.size ? `?${next}` : ''}`, { scroll: false })
  }
  function reset() {
    setSearch('')
    router.push('/coaches', { scroll: false })
  }
  const availableCategories = [
    ...new Set(
      coaches.flatMap((c) =>
        c.categories.length ? c.categories : c.category ? [c.category] : []
      )
    ),
  ].filter((key) => CATEGORY_LABEL_MAP[key])
  const availableLanguages = [
    ...new Set(coaches.flatMap((c) => c.languages)),
  ].filter((key) => LANGUAGE_LABEL_MAP[key])
  const filtered = coaches
    .filter((c) => {
      const cats = c.categories.length
        ? c.categories
        : c.category
          ? [c.category]
          : []
      const haystack = [
        c.display_name,
        c.bio ?? '',
        ...cats.flatMap((key) => [key, CATEGORY_LABEL_MAP[key] ?? '']),
      ]
        .join(' ')
        .toLocaleLowerCase('de-DE')
      return (
        (category === 'all' || cats.includes(category)) &&
        (language === 'all' || c.languages.includes(language)) &&
        (!videocoaching || c.hasVideoCoaching) &&
        (!groupclasses || c.hasGroupClasses) &&
        (!subscription || c.hasSubscription) &&
        (!normalizedSearch ||
          haystack.includes(normalizedSearch.toLocaleLowerCase('de-DE')))
      )
    })
    .sort((a, b) =>
      sort === 'most_products'
        ? b.productCount - a.productCount
        : sort === 'top_rated'
          ? (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0)
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  const chips = [
    category !== 'all' && {
      key: 'category',
      label: CATEGORY_LABEL_MAP[category] ?? category,
    },
    language !== 'all' && {
      key: 'language',
      label: LANGUAGE_LABEL_MAP[language] ?? language,
    },
    videocoaching && { key: 'videocoaching', label: '1:1 Coaching' },
    subscription && { key: 'subscription', label: 'Abonnements' },
    groupclasses && {
      key: 'groupclasses',
      label: 'Gruppen-Sessions (bestehender Filter)',
    },
    normalizedSearch && { key: 'q', label: `Suche: „${normalizedSearch}“` },
  ].filter((chip): chip is { key: string; label: string } => !!chip)
  function filters() {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <label>
          <span className="mb-2 block text-sm font-semibold text-muted">
            Kategorie / Ziel
          </span>
          <select
            className="field-control w-full"
            value={category}
            onChange={(e) => go({ category: e.target.value })}
          >
            <option value="all">Alle Kategorien</option>
            {availableCategories.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABEL_MAP[key]}
              </option>
            ))}
            {category !== 'all' && !availableCategories.includes(category) && (
              <option value={category}>
                {CATEGORY_LABEL_MAP[category] ?? category}
              </option>
            )}
          </select>
        </label>
        <label>
          <span className="mb-2 block text-sm font-semibold text-muted">
            Sprache
          </span>
          <select
            className="field-control w-full"
            value={language}
            onChange={(e) => go({ language: e.target.value })}
          >
            <option value="all">Alle Sprachen</option>
            {availableLanguages.map((key) => (
              <option key={key} value={key}>
                {LANGUAGE_LABEL_MAP[key]}
              </option>
            ))}
            {language !== 'all' && !availableLanguages.includes(language) && (
              <option value={language}>
                {LANGUAGE_LABEL_MAP[language] ?? language}
              </option>
            )}
          </select>
        </label>
        <label>
          <span className="mb-2 block text-sm font-semibold text-muted">
            Angebotsformat
          </span>
          <select
            className="field-control w-full"
            value={
              videocoaching ? 'coaching' : subscription ? 'subscription' : 'all'
            }
            onChange={(e) =>
              go({
                videocoaching: e.target.value === 'coaching' ? 'true' : null,
                subscription: e.target.value === 'subscription' ? 'true' : null,
                groupclasses: null,
              })
            }
          >
            <option value="all">Alle Formate</option>
            <option value="coaching">1:1 Coaching</option>
            <option value="subscription">Abonnements</option>
          </select>
        </label>
      </div>
    )
  }
  const sortControl = (
    <label>
      <span className="sr-only">Coaches sortieren</span>
      <select
        value={sort}
        onChange={(e) => go({ sort: e.target.value })}
        className="field-control w-full"
      >
        <option value="newest">Neueste Profile</option>
        <option value="most_products">Meiste Produkte</option>
        {sort === 'top_rated' && (
          <option value="top_rated">Nach Produktbewertungen</option>
        )}
      </select>
    </label>
  )
  return (
    <div className="min-h-screen">
      <section className="border-b border-border bg-surface">
        <div className="ardore-container py-6 sm:py-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="section-title">Marktplatz entdecken</h1>
              <p className="mt-2 text-sm text-muted">
                Coaches kennenlernen. Digitale Produkte vergleichen.
              </p>
            </div>
            <DiscoveryNavigation
              active="coaches"
              search={normalizedSearch}
              category={category}
            />
          </div>
          <label className="relative block max-w-2xl">
            <span className="sr-only">
              Coaches nach Name, Thema oder Kategorie suchen
            </span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              aria-label="Coaches nach Name, Thema oder Kategorie suchen"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, Thema oder Ziel suchen"
              className="field-control w-full pl-12 pr-12"
            />
            {normalizedSearch && (
              <button
                aria-label="Suche löschen"
                onClick={() => setSearch('')}
                className="icon-button absolute right-1 top-1/2 -translate-y-1/2 text-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </label>
          <p className="mt-3 text-xs text-muted">
            Hier findest du Coach-Profile.{' '}
            <ButtonLink
              href={discoveryHref('/marketplace', normalizedSearch, category)}
              variant="tertiary"
              className="min-h-0 p-0 text-xs font-semibold text-brand underline underline-offset-2"
            >
              Passende Produkte ansehen
            </ButtonLink>
          </p>
        </div>
      </section>
      <div className="ardore-container py-6">
        <div className="hidden md:block">{filters()}</div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mt-6">
          <p role="status" aria-live="polite" className="text-sm text-muted">
            <strong className="text-foreground">{filtered.length}</strong>{' '}
            {filtered.length === 1 ? 'Coach' : 'Coaches'} gefunden
          </p>
          <div className="flex min-w-0 gap-3">
            <Button
              ref={trigger}
              variant="secondary"
              className="md:hidden"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filter{chips.length > 0 ? ` (${chips.length})` : ''}
            </Button>
            {sortControl}
          </div>
        </div>
        {chips.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2" aria-label="Aktive Filter">
            {chips.map((chip) => (
              <button
                key={chip.key}
                aria-label={`${chip.label} entfernen`}
                className="button-base max-w-full border border-border bg-brand-soft px-3 text-xs text-brand"
                onClick={() => {
                  if (chip.key === 'q') setSearch('')
                  go({ [chip.key]: null })
                }}
              >
                <span className="break-words">{chip.label}</span>
                <X className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
            ))}
            <Button variant="tertiary" onClick={reset}>
              Zurücksetzen
            </Button>
          </div>
        )}
        {filtered.length === 0 ? (
          <StatePanel
            title="Keine Coaches gefunden"
            description="Versuche einen anderen Suchbegriff oder setze die Filter zurück."
            action={
              <>
                <Button variant="secondary" onClick={reset}>
                  Zurücksetzen
                </Button>
                <ButtonLink
                  variant="tertiary"
                  href={discoveryHref(
                    '/marketplace',
                    normalizedSearch,
                    category
                  )}
                >
                  Produkte ansehen
                </ButtonLink>
              </>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((c) => (
              <CoachCard key={c.id} coach={c} />
            ))}
          </div>
        )}
      </div>
      {filtersOpen && (
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          onCancel={() => setFiltersOpen(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFiltersOpen(false)
          }}
          className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88svh] w-full max-w-none rounded-t-[var(--radius-dialog)] bg-surface p-0 text-foreground shadow-[var(--shadow-floating)] backdrop:bg-gray-950/45"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 id={titleId} className="card-title">
              Coaches filtern
            </h2>
            <Button
              variant="tertiary"
              aria-label="Filter schließen"
              onClick={() => setFiltersOpen(false)}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
          <div className="overflow-y-auto p-4">{filters()}</div>
          <div className="flex gap-3 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button variant="secondary" onClick={reset}>
              Zurücksetzen
            </Button>
            <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
              {filtered.length} anzeigen
            </Button>
          </div>
        </dialog>
      )}
    </div>
  )
}
