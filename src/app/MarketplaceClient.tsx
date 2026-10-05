'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Search,
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
import { EditorialVisual } from '@/components/ui/EditorialVisual'
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
  heroImage?: { src: string; alt: string }
  categoryImages?: Record<string, { src: string; alt: string }>
}

export default function MarketplaceClient({
  products,
  salesCounts,
  ratings,
  coaches,
  heroImage,
  categoryImages = {},
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

  const categoryHref = (key: string) => `${coaches.some((c) => c.categories.includes(key) || c.category === key) ? '/coaches' : '/marketplace'}?category=${encodeURIComponent(key)}`
  const areas = categories.slice(0, 4)
  const goalOptions = [
    { keys: ['muskelaufbau', 'krafttraining', 'fitness'], title: 'Stärker werden', text: 'Coaches und Inhalte rund um dein Training.' },
    { keys: ['abnehmen', 'gewichtsmanagement'], title: 'Gewicht bewusst gestalten', text: 'Begleitung für deine persönlichen Ziele.' },
    { keys: ['ernaehrungsberatung', 'ernaehrung', 'sporternaehrung'], title: 'Ernährung entdecken', text: 'Neue Impulse für deinen Alltag.' },
    { keys: ['beweglichkeit', 'mobility', 'yoga', 'pilates'], title: 'In Bewegung bleiben', text: 'Raum für Beweglichkeit und Körpergefühl.' },
    { keys: ['stressbewaeltigung', 'stressmanagement', 'mental', 'meditation', 'schlaf'], title: 'Mehr Ruhe finden', text: 'Themen rund um Entspannung und Wohlbefinden.' },
  ].flatMap((goal) => {
    const key = goal.keys.find((k) => categories.includes(k))
    return key ? [{ ...goal, key }] : []
  }).slice(0, 4)
  const previewProduct = products[0]

  return (
    <div>
      <section className="public-hero">
        <div className="ardore-container grid items-center gap-8 py-8 md:grid-cols-[1.15fr_1fr] md:gap-10 md:py-14 lg:py-20">
          <div className="min-w-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-brand">
            Dein Ziel. Dein nächster Schritt.
          </p>
          <h1 className="marketing-title max-w-xl text-foreground">
            Deine Gesundheit.
            <span className="block text-brand">Dein eigener Weg.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted lg:text-lg">
            Finde Coaches, digitale Produkte und Abonnements für Fitness, Ernährung und Wohlbefinden. In deinem Tempo. Für deinen Alltag.
          </p>
          <form
            action={intent}
            role="search"
            aria-label="Marktplatz durchsuchen"
            className="surface-card mt-6 grid max-w-3xl grid-cols-[100px_minmax(0,1fr)] gap-3 p-3 lg:flex lg:items-center"
          >
            <label className="shrink-0">
              <span className="sr-only">Was möchtest du entdecken?</span>
              <select
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                className="field-control w-full px-2 lg:w-28"
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
            <Button type="submit" className="col-span-2 lg:shrink-0">
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
          <EditorialVisual src={heroImage?.src} alt={heroImage?.alt ?? ''} word="wohl."
            tone="sage" className="hero-visual rounded-[2rem]" />
        </div>
      </section>

      <div className="ardore-container">
        {areas.length > 0 && (
          <section className="section-space" aria-labelledby="areas-title">
            <p className="marketing-eyebrow">Deine Themen</p>
            <div className="mb-8 mt-3 flex flex-wrap items-end justify-between gap-4">
              <h2 id="areas-title" className="marketing-heading max-w-xl">Finde deinen Einstieg.</h2>
              <p className="max-w-sm text-sm leading-relaxed text-muted">Entdecke die Bereiche, die unsere Coaches und Produkte abdecken.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {areas.map((key, i) => (
                <Link key={key} href={categoryHref(key)} className="surface-card interactive-card group overflow-hidden">
                  <EditorialVisual src={categoryImages[key]?.src} alt={categoryImages[key]?.alt ?? ''}
                    sizes="(max-width: 1023px) 50vw, 25vw" word={CATEGORY_LABEL_MAP[key]} tone={i % 2 ? 'sand' : 'sage'} className="aspect-[4/3]" />
                  <div className="p-4 sm:p-5">
                    <h3 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-xl">{CATEGORY_LABEL_MAP[key]}</h3>
                    <p className="mt-2 text-sm text-muted">Coaches und Inhalte zu diesem Thema kennenlernen.</p>
                    <span className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand">Bereich entdecken <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {goalOptions.length > 0 && (
          <section className="section-space grid gap-8 border-y border-border md:grid-cols-[1fr_1.15fr] md:gap-16" aria-labelledby="goals-title">
            <div>
              <p className="marketing-eyebrow">Was bewegt dich?</p>
              <h2 id="goals-title" className="marketing-heading mt-4 max-w-md">Ein Ziel. Viele Möglichkeiten.</h2>
              <p className="mt-5 max-w-sm text-base leading-relaxed text-muted">Du musst noch keinen fertigen Plan haben. Beginne mit dem Thema, das dir gerade wichtig ist.</p>
            </div>
            <div className="divide-y divide-border">
              {goalOptions.map((goal) => <Link key={goal.key} href={categoryHref(goal.key)} className="group flex min-h-24 items-center justify-between gap-4 py-5">
                <div><h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{goal.title}</h3><p className="mt-2 text-sm text-muted">{goal.text}</p></div>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface group-hover:bg-brand-soft"><ArrowRight className="h-5 w-5" aria-hidden="true" /></span>
              </Link>)}
            </div>
          </section>
        )}

        <section
          className="section-space"
          aria-labelledby="home-coaches-title"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="home-coaches-title" className="marketing-heading">
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
          className="section-space rounded-[2rem] bg-brand-soft p-5 sm:px-8"
          aria-labelledby="home-products-title"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="home-products-title" className="marketing-heading">
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

        <section className="section-space" aria-labelledby="formats-title">
          <div className="brand-story grid items-center gap-8 rounded-[2rem] bg-brand-dark p-6 sm:p-10 lg:grid-cols-2 lg:gap-16 lg:p-14">
            <div>
              <p className="marketing-eyebrow text-green-200">Dein Ardore</p>
              <h2 id="formats-title" className="marketing-heading mt-4 text-white">Menschen. Wissen. Dein nächster Schritt.</h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-green-100">Ein Coach-Profil verbindet persönliche Begleitung und digitale Inhalte. Du wählst das Angebot, das in deinen Alltag passt.</p>
              <div className="mt-8 space-y-5">
                {[
                  ...(coaches.some((c) => c.hasVideoCoaching) ? [{ title: '1:1 Coaching', text: 'Termin und privater Meeting-Link findest du in deiner Buchung.', href: '/coaches?videocoaching=true', Icon: UsersRound }] : []),
                  { title: 'Digitale Produkte', text: 'Nach dem Kauf findest du deine Inhalte in deiner Bibliothek.', href: '/marketplace', Icon: BookOpen },
                  ...(coaches.some((c) => c.hasSubscription) ? [{ title: 'Abonnements', text: 'Inhalte, Preis und Laufzeit stehen im Coach-Profil.', href: '/coaches?subscription=true', Icon: Layers }] : []),
                ].map(({ title, text, href, Icon }) => <Link key={title} href={href} className="flex items-start gap-4 rounded-lg py-1 text-white">
                  <Icon className="mt-1 h-5 w-5 shrink-0 text-green-200" aria-hidden="true" /><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-green-100">{text}</p></div><ArrowRight className="ml-auto mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
                </Link>)}
              </div>
            </div>
            {previewProduct ? <div className="min-w-0 rounded-2xl bg-brand-soft p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted"><span>Ardore · Einblick in den Marktplatz</span><span aria-hidden="true">•••</span></div>
              <div className="mx-auto max-w-sm"><ProductCard product={previewProduct} salesCount={salesCounts[previewProduct.id]} rating={ratings[previewProduct.id]} /></div>
              <p className="mt-4 text-center text-xs text-muted">Aktuelles öffentliches Angebot · direkt entdecken</p>
            </div> : <EditorialVisual alt="" word="deins." tone="green" className="aspect-[4/3] rounded-2xl" />}
          </div>
        </section>

        <section className="py-8 sm:py-12" aria-labelledby="how-title">
          <h2 id="how-title" className="marketing-heading mb-8">
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

      <section className="bg-brand text-white">
        <div className="ardore-container flex flex-col items-start justify-between gap-6 py-12 sm:py-16 md:flex-row md:items-center">
          <div>
            <h2 className="marketing-heading">Dein Wissen verdient einen Platz.</h2>
            <p className="mt-4 max-w-xl text-base text-green-100">
              Erstelle dein Coach-Profil und präsentiere deine eigenen Angebote
              auf Ardore.
            </p>
          </div>
          <ButtonLink href="/register?role=creator" variant="secondary">
            Als Coach starten
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </div>
      </section>
    </div>
  )
}
