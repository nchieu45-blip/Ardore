'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Search,
  Dumbbell,
  Leaf,
  Heart,
  BookOpen,
  UsersRound,
  Layers,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ProductCard } from '@/components/ui/ProductCard'
import { CoachCard } from '@/components/ui/CoachCard'
import { StatePanel } from '@/components/ui/StatePanel'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'
import CoachFinderWidget from '@/components/CoachFinderWidget'
import type { CoachData } from '@/lib/publicCoaches'

export interface MarketplaceProduct {
  id: string
  title: string
  description: string | null
  type: 'pdf' | 'video' | 'course' | 'image'
  price: number
  createdAt: string
  thumbnail_url: string | null
  categories: string[]
  equipment: string[]
  level: string | null
  duration: string | null
  show_sales_count?: boolean
  creator: {
    id: string
    display_name: string
    avatar_url: string | null
    slug: string
    category: string | null
    categories: string[]
  }
  creatorHasCoaching?: boolean
  creatorHasVideoClasses?: boolean
}
interface Props {
  products: MarketplaceProduct[]
  salesCounts: Record<string, number>
  ratings: Record<string, { avg: number; count: number }>
  coaches: CoachData[]
}

export default function MarketplaceClient({
  products,
  salesCounts,
  ratings,
  coaches,
}: Props) {
  const [intent, setIntent] = useState('/coaches')
  const [helpOpen, setHelpOpen] = useState(false)
  const categories = [
    ...new Set([
      ...coaches.flatMap((c) =>
        c.categories.length ? c.categories : c.category ? [c.category] : []
      ),
      ...products.flatMap((p) => p.categories),
    ]),
  ]
    .filter((key) => CATEGORY_LABEL_MAP[key])
    .slice(0, 6)
  return (
    <div>
      <section className="border-b border-border bg-brand-soft">
        <div className="ardore-container py-8 sm:py-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-brand">
            Dein Ziel. Dein nächster Schritt.
          </p>
          <h1 className="page-title max-w-4xl text-foreground">
            Coaches und Angebote für deine Gesundheit.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
            Persönliches Coaching, digitale Produkte und Abonnements für
            Fitness, Ernährung und Wohlbefinden. Finde, was zu deinem Ziel
            passt.
          </p>
          <form
            action={intent}
            role="search"
            aria-label="Marktplatz durchsuchen"
            className="surface-card mt-6 grid max-w-3xl grid-cols-[100px_minmax(0,1fr)] gap-3 p-3 sm:flex sm:items-center"
          >
            <label className="shrink-0">
              <span className="sr-only">Was möchtest du entdecken?</span>
              <select
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                className="field-control w-full px-2 sm:w-36"
              >
                <option value="/coaches">Coaches</option>
                <option value="/marketplace">Produkte</option>
              </select>
            </label>
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Suchbegriff</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                name="q"
                placeholder={
                  intent === '/coaches'
                    ? 'Name, Thema oder Ziel'
                    : 'Produkt, Coach oder Thema'
                }
                className="field-control w-full pl-10"
              />
            </label>
            <Button type="submit" className="col-span-2 sm:shrink-0">
              Entdecken
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link
              href="/coaches"
              className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand"
            >
              Coaches entdecken
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/marketplace"
              className="inline-flex min-h-11 items-center gap-2 text-muted hover:text-brand"
            >
              Produkte ansehen
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <div className="ardore-container">
        {categories.length > 0 && (
          <section className="py-8 sm:py-12" aria-labelledby="goals-title">
            <div className="mb-6">
              <h2 id="goals-title" className="section-title">
                Was möchtest du erreichen?
              </h2>
              <p className="mt-2 text-sm text-muted">
                Entdecke Themen, die unsere Coaches und Produkte abdecken.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {categories.map((key) => {
                const Icon = /ern[aä]|nutrition/.test(key)
                  ? Leaf
                  : /mental|stress|schlaf|meditation/.test(key)
                    ? Heart
                    : /yoga|pilates|beweglichkeit|mobility/.test(key)
                      ? Sparkles
                      : Dumbbell
                return (
                  <Link
                    key={key}
                    href={`${coaches.some((c) => c.categories.includes(key) || c.category === key) ? '/coaches' : '/marketplace'}?category=${encodeURIComponent(key)}`}
                    className="surface-card interactive-card flex min-h-20 min-w-0 items-center gap-3 p-4 md:flex-col md:items-start"
                  >
                    <Icon
                      className="h-5 w-5 shrink-0 text-brand"
                      aria-hidden="true"
                    />
                    <span className="text-sm font-semibold [overflow-wrap:anywhere]">
                      {CATEGORY_LABEL_MAP[key]}
                    </span>
                    <ArrowRight
                      className="mt-auto hidden h-4 w-4 text-muted md:block"
                      aria-hidden="true"
                    />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        <section
          className="pb-8 pt-8 sm:pb-12"
          aria-labelledby="home-coaches-title"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="home-coaches-title" className="section-title">
                Coaches entdecken
              </h2>
              <p className="mt-2 text-sm text-muted">
                Lerne die Menschen und ihre Schwerpunkte kennen.
              </p>
            </div>
            <ButtonLink href="/coaches" variant="tertiary">
              Alle Coaches
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
          {coaches.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {coaches.slice(0, 4).map((c) => (
                <CoachCard key={c.id} coach={c} />
              ))}
            </div>
          ) : (
            <StatePanel
              title="Coaches kommen bald dazu"
              description="Sobald Profile veröffentlicht sind, findest du sie hier."
            />
          )}
        </section>

        <section
          className="py-8 sm:py-12"
          aria-labelledby="home-products-title"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="home-products-title" className="section-title">
                Neu im Marktplatz
              </h2>
              <p className="mt-2 text-sm text-muted">
                Digitale Inhalte für deinen Alltag und dein Training.
              </p>
            </div>
            <ButtonLink href="/marketplace?sort=newest" variant="tertiary">
              Alle Produkte
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
          {products.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.slice(0, 4).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  salesCount={salesCounts[p.id]}
                  rating={ratings[p.id]}
                />
              ))}
            </div>
          ) : (
            <StatePanel
              title="Noch keine Produkte veröffentlicht"
              description="Neue Inhalte erscheinen hier, sobald sie verfügbar sind."
            />
          )}
        </section>

        <section className="py-8 sm:py-12" aria-labelledby="formats-title">
          <h2 id="formats-title" className="section-title mb-6">
            Die passende Begleitung für dich
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                title: '1:1 Coaching',
                text: 'Persönliche Sessions mit einem Coach. Termin und Meeting-Link findest du in deiner Buchung.',
                href: '/coaches?videocoaching=true',
                Icon: UsersRound,
              },
              {
                title: 'Digitale Produkte',
                text: 'Pläne, Kurse und weitere Inhalte. Nach dem Kauf findest du sie in deiner Bibliothek.',
                href: '/marketplace',
                Icon: BookOpen,
              },
              {
                title: 'Abonnements',
                text: 'Begleitung im Abo. Inhalte, Preis und Laufzeit siehst du im jeweiligen Coach-Profil.',
                href: '/coaches?subscription=true',
                Icon: Layers,
              },
            ].map(({ title, text, href, Icon }) => (
              <Link
                key={title}
                href={href}
                className="surface-card interactive-card p-6"
              >
                <Icon className="mb-4 h-6 w-6 text-brand" aria-hidden="true" />
                <h3 className="card-title">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {text}
                </p>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand">
                  Entdecken
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section
          className="border-y border-border py-8 sm:py-12"
          aria-label="Orientierung und Vertrauen"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                Icon: ShieldCheck,
                title: 'Profile transparent vergleichen',
                text: 'Schwerpunkte, Angebote und Preise stehen im jeweiligen Profil. Ein Verifiziert-Siegel wird nur bei verifizierten Profilen angezeigt.',
              },
              {
                Icon: LockKeyhole,
                title: 'Deine Inhalte an einem Ort',
                text: 'Gekaufte Produkte bleiben in deiner Bibliothek. Termine und private Meeting-Links findest du in deinem Konto.',
              },
              {
                Icon: BookOpen,
                title: 'Bewertungen mit Kontext',
                text: 'Produktbewertungen zeigen ihre Anzahl. Wo noch keine Bewertungen vorliegen, werden keine Sterne ergänzt.',
              },
            ].map(({ Icon, title, text }) => (
              <div key={title} className="flex gap-3">
                <Icon
                  className="mt-1 h-5 w-5 shrink-0 text-brand"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-8 sm:py-12" aria-labelledby="how-title">
          <h2 id="how-title" className="section-title mb-6">
            So funktioniert Ardore
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {[
              [
                'Entdecken',
                'Suche nach deinem Ziel und vergleiche Coaches oder Produkte.',
              ],
              [
                'Auswählen',
                'Lies Profil und Angebot. Prüfe Preis, Format und Voraussetzungen.',
              ],
              [
                'Loslegen',
                'Buche deine Session oder kaufe einen Inhalt und finde alles in deinem Konto.',
              ],
            ].map(([title, text], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                  {i + 1}
                </span>
                <div>
                  <h3 className="card-title">{title}</h3>
                  <p className="mt-2 text-sm text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="pb-8 sm:pb-12">
          <details
            className="surface-card p-4 sm:p-6"
            onToggle={(e) => setHelpOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
                Hilfe bei der Auswahl
              </span>
            </summary>
            <p className="mb-4 mt-3 text-sm text-muted">
              Noch unsicher? Der KI-Finder kann dir bei der Orientierung helfen.
            </p>
            {helpOpen && (
              <div className="max-w-2xl">
                <CoachFinderWidget />
              </div>
            )}
          </details>
        </section>
      </div>

      <section className="border-t border-border bg-brand-soft">
        <div className="ardore-container flex flex-col items-start justify-between gap-6 py-8 sm:py-12 md:flex-row md:items-center">
          <div>
            <h2 className="section-title">Dein Wissen verdient einen Platz.</h2>
            <p className="mt-3 max-w-xl text-sm text-muted">
              Erstelle dein Coach-Profil und präsentiere deine eigenen Angebote
              auf Ardore.
            </p>
          </div>
          <ButtonLink href="/register?role=creator">
            Als Coach starten
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </div>
      </section>
    </div>
  )
}
