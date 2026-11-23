'use client'

import { type ReactNode, useState } from 'react'
import Link from 'next/link'
import HomeHeroMedia from '@/components/HomeHeroMedia'
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
import ArdoreProductVideo from '@/components/ArdoreProductVideo'
import CoachingProcess from '@/components/CoachingProcess'
import Reveal from '@/components/motion/Reveal'
import DiscoveryRail from '@/components/DiscoveryRail'
import HomeCategoryDiscovery from '@/components/HomeCategoryDiscovery'
import { buildHomeProductRows } from '@/lib/homeDiscovery'
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
  children?: ReactNode
}

const newestProductCopy = {
  title: 'Neu auf Ardore',
  description: 'Entdecke frische Ideen für dein Training und deinen Alltag.',
}

const homeProductCopy: Partial<Record<string, typeof newestProductCopy>> = {
  newest: newestProductCopy,
  'best-rated': { title: 'Gut bewertet', description: 'Sieh, welche Inhalte bei anderen gut ankommen.' },
  courses: { title: 'Online-Kurse', description: 'Lern Schritt für Schritt in deinem Tempo.' },
  free: { title: 'Kostenlos ausprobieren', description: 'Hol dir Ideen und Übungen für deinen Einstieg.' },
}

export default function MarketplaceClient({
  products,
  salesCounts,
  ratings,
  coaches,
  children,
}: Props) {
  const [intent, setIntent] = useState('/coaches')
  const categories = [
    ...new Set([
      ...coaches.flatMap((c) =>
        c.categories.length ? c.categories : c.category ? [c.category] : []
      ),
      ...products.flatMap((p) => p.categories),
    ]),
  ]
    .filter((key) => CATEGORY_LABEL_MAP[key])
  const productRows = buildHomeProductRows(products, ratings)
  return (
    <div className="home-story min-w-0">
      <section className="home-hero">
        <HomeHeroMedia />
        <div className="ardore-container grid items-center gap-8 pt-10 pb-16 sm:py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          <div>
            <h1 className="page-title max-w-[19ch] text-balance">
              Mach Platz für Bewegung, <span className="text-ember-on-dark">die dir guttut.</span>
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <ul aria-label="Disziplinen" className="flex flex-wrap gap-1.5">
                {['Fitness', 'Yoga', 'Pilates', 'Ernährung', 'Kampfsport'].map(discipline => (
                  <li key={discipline} className="home-hero-chip rounded-full border px-2.5 py-1">{discipline}</li>
                ))}
              </ul>
            </div>
            <p className="mt-6 max-w-xl text-base leading-relaxed sm:text-lg">
              Entdecke Coaches für Fitness, Yoga, Pilates, Ernährung und Kampfsport – vor Ort oder online.
            </p>
          </div>
          <div className="min-w-0">
            <form
              action={intent}
              role="search"
              aria-label="Marktplatz durchsuchen"
              className="surface-card grid gap-4 p-4 text-foreground sm:p-6"
            >
              <div role="group" aria-label="Was möchtest du entdecken?" className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={intent === '/coaches' ? 'soft' : 'tertiary'}
                  aria-pressed={intent === '/coaches'}
                  onClick={() => setIntent('/coaches')}
                  className="min-h-12"
                >
                  <UsersRound className="h-4 w-4" aria-hidden="true" />
                  Coaches
                </Button>
                <Button
                  type="button"
                  variant={intent === '/marketplace' ? 'soft' : 'tertiary'}
                  aria-pressed={intent === '/marketplace'}
                  onClick={() => setIntent('/marketplace')}
                  className="min-h-12"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  Produkte
                </Button>
              </div>
              <label className="relative min-w-0">
                <span className="sr-only">Suchbegriff</span>
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  name="q"
                  placeholder={
                    intent === '/coaches'
                      ? 'Z. B. Yoga oder Krafttraining'
                      : 'Z. B. Trainingsplan oder Pilateskurs'
                  }
                  className="field-control min-h-12 w-full pl-12"
                />
              </label>
              <Button type="submit" variant="ember" className="min-h-12 w-full">
                Suchen
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <Link
                href="/coaches"
                className="inline-flex min-h-11 items-center gap-2 font-semibold hover:underline"
              >
                Alle Coaches ansehen
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/marketplace"
                className="inline-flex min-h-11 items-center gap-2 hover:underline"
              >
                Alle Produkte ansehen
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <HomeCategoryDiscovery />

      <div className="ardore-container">
        {categories.length > 0 && (
          <section className="grid gap-6 border-b border-border py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-center lg:gap-12" aria-labelledby="goals-title">
            <div>
              <h2 id="goals-title" className="section-title">
                Dein Thema finden
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
                Stöbere nach einem Schwerpunkt, der zu deinem Ziel passt.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:gap-x-6">
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
                    className="group flex min-h-16 min-w-0 items-center gap-3 border-b border-border py-3 text-foreground transition-colors hover:text-brand"
                  >
                    <Icon
                      className="h-5 w-5 shrink-0 text-brand"
                      aria-hidden="true"
                    />
                    <span className="text-sm font-semibold [overflow-wrap:anywhere]">
                      {CATEGORY_LABEL_MAP[key]}
                    </span>
                    <ArrowRight
                      className="ml-auto h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        <DiscoveryRail
          id="home-coaches"
          title="Lern die Coaches kennen"
          description="Schau, wie sie arbeiten und was sie anbieten."
          href="/coaches"
          linkLabel="Alle Coaches ansehen"
          empty={<StatePanel title="Hier gibt es noch keine Coach-Profile." description="Bis dahin kannst du dich auf dem Marktplatz umsehen." />}
        >
          {coaches.slice(0, 12).map(coach => <CoachCard key={coach.id} coach={coach} layout="rail" />)}
        </DiscoveryRail>

        {productRows.map(row => (
          <DiscoveryRail
            key={row.id}
            id={row.id === 'newest' ? 'home-products' : `home-products-${row.id}`}
            title={homeProductCopy[row.id]?.title ?? row.title}
            description={homeProductCopy[row.id]?.description ?? 'Finde digitale Inhalte für dein Thema.'}
            href={row.href}
            linkLabel="Alle Produkte ansehen"
            empty={<p className="rounded-xl bg-surface-muted p-5 text-base leading-relaxed text-muted">Hier gibt es noch keine Produktbewertungen. Stöbere solange in den neuen Angeboten.</p>}
          >
            {row.products.map(product => (
              <ProductCard key={product.id} product={product} salesCount={salesCounts[product.id]} rating={ratings[product.id]} />
            ))}
          </DiscoveryRail>
        ))}
        {products.length === 0 && (
          <DiscoveryRail
            id="home-products"
            {...newestProductCopy}
            href="/marketplace?sort=newest"
            linkLabel="Alle Produkte ansehen"
            empty={<StatePanel title="Hier gibt es noch keine Produkte." description="Schau wieder vorbei, wenn du nach neuen Ideen für dein Training suchst." />}
          >{[]}</DiscoveryRail>
        )}

        <section className="border-t border-border py-6 sm:py-8" aria-labelledby="formats-title">
          <h2 id="formats-title" className="section-title mb-4 max-w-xl text-balance">
            Wie willst du loslegen?
          </h2>
          <div className="grid gap-4 md:grid-cols-3 md:gap-6">
            {[
              {
                title: '1:1 Coaching',
                text: 'Arbeite mit einem Coach an dem, was du verändern möchtest.',
                action: '1:1 Coaching ansehen',
                href: '/coaches?videocoaching=true',
                Icon: UsersRound,
              },
              {
                title: 'Digitale Produkte',
                text: 'Hol dir Trainingspläne, Kurse und Ideen für deinen Alltag.',
                action: 'Digitale Produkte ansehen',
                href: '/marketplace',
                Icon: BookOpen,
              },
              {
                title: 'Begleitung im Abo',
                text: 'Bleib mit regelmäßiger Unterstützung an deinem Ziel dran.',
                action: 'Abos ansehen',
                href: '/coaches?subscription=true',
                Icon: Layers,
              },
            ].map(({ title, text, action, href, Icon }) => (
              <Link
                key={title}
                href={href}
                className="home-format-link group flex flex-col border-t border-border py-4"
              >
                <Icon className="mb-2 h-6 w-6 text-brand" aria-hidden="true" />
                <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mb-2 mt-2 max-w-prose text-base leading-relaxed text-muted">
                  {text}
                </p>
                <span className="home-format-action mt-auto inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand">
                  {action}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="home-dark-band home-trust-band" aria-label="Orientierung und Vertrauen">
        <Reveal className="ardore-container grid gap-6 md:grid-cols-3 md:gap-10">
          {[
            {
              Icon: ShieldCheck,
              title: 'Finde den passenden Coach',
              text: 'Vergleiche Schwerpunkte, Angebote und Preise auf einen Blick.',
            },
            {
              Icon: LockKeyhole,
              title: 'Alles griffbereit',
              text: 'Finde deine gekauften Inhalte und behalte deine Termine im Blick.',
            },
            {
              Icon: BookOpen,
              title: 'Erfahrungen helfen dir bei der Wahl',
              text: 'Schau, wie andere die digitalen Inhalte bewerten.',
            },
          ].map(({ Icon, title, text }) => (
            <div key={title} className="flex gap-3">
              <Icon
                className="mt-1 h-5 w-5 shrink-0 text-ember-on-dark"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-inverse">
                  {text}
                </p>
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      <div className="ardore-container">
        <CoachingProcess />
      </div>

      <ArdoreProductVideo />

      {children}

      <div className="ardore-container">
        <section className="home-help-band">
          <details
            className="border-y border-border py-2"
          >
            <summary className="min-h-11 cursor-pointer py-3 text-base font-semibold text-foreground">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
                Noch unsicher, wer zu dir passt?
              </span>
            </summary>
            <p className="mb-4 mt-3 text-sm leading-relaxed text-muted">
              Such nach dem Thema, das dich gerade beschäftigt. Die Profile zeigen dir, wie die Coaches arbeiten.
            </p>
            <ButtonLink href="/coaches" variant="outline" className="mb-3">
              Coaches vergleichen
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </details>
        </section>
      </div>

      <section data-requires-open-launch className="home-dark-band bg-inverse">
        <div className="ardore-container home-band-space flex flex-col items-start justify-between gap-6 md:flex-row md:items-center md:gap-12">
          <div>
            <h2 className="section-title max-w-xl text-balance">Teile, was dich antreibt.</h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-inverse">
              Zeig in deinem Profil, wie du arbeitest und wobei du Menschen begleiten kannst.
            </p>
          </div>
          <ButtonLink href="/register?role=creator" variant="ember" className="min-h-12 w-full shrink-0 sm:w-auto">
            Coach-Profil erstellen
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </div>
      </section>
    </div>
  )
}
