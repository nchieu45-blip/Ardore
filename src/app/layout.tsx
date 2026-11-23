import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Toaster } from '@/components/ui/Toaster'
import CookieBanner from '@/components/CookieBanner'
import { FavoritesProvider } from '@/components/FavoritesProvider'
import CartDrawer from '@/components/CartDrawer'
import SessionGuard from '@/components/SessionGuard'
import InteractionMode from '@/components/InteractionMode'
import { createClient } from '@/lib/supabase/server'
import { isLaunchPaused } from '@/lib/launch-pause'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.ardore-health.com'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Ardore – Fitness & Gesundheitscoaches',
    template: '%s – Ardore',
  },
  description: 'Entdecke Fitness-, Ernährungs- und Gesundheitscoaches in Deutschland. Kaufe digitale Produkte, abonniere deinen Lieblingscoach und erreiche deine Ziele.',
  keywords: ['Fitness', 'Gesundheitscoach', 'Ernährung', 'Online Coaching', 'Trainingsplan', 'Deutschland'],
  authors: [{ name: 'Ardore' }],
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    url: BASE_URL,
    siteName: 'Ardore',
    title: 'Ardore – Fitness & Gesundheitscoaches',
    description: 'Entdecke Coaches, kaufe Trainingspläne und Kurse. Die Plattform für Fitness-Community in Deutschland.',
    images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'Ardore' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ardore – Fitness & Gesundheitscoaches',
    description: 'Entdecke Coaches, kaufe Trainingspläne und Kurse.',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const launchPaused = isLaunchPaused()
  let profile = null
  let creatorSlug: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
      profile = data
      if (data?.role === 'creator') {
        const { data: cp } = await supabase
          .from('creator_profiles')
          .select('slug,is_published')
          .eq('user_id', user.id)
          .maybeSingle()
        creatorSlug = cp?.is_published ? cp.slug : null
      }
    }
  } catch {
    // profile stays null on any auth/db error (e.g. brand-new user, network hiccup)
  }

  return (
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col" data-launch-paused={launchPaused || undefined}>
        <InteractionMode />
        <a href="#hauptinhalt" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[110] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:text-brand">Zum Hauptinhalt</a>
        <Navbar user={profile} creatorSlug={creatorSlug} />
        {launchPaused && (
          <aside id="start-pausiert" aria-label="Hinweis zum Start" className="scroll-mt-16 border-b border-border bg-brand-soft text-foreground">
            <div className="ardore-container py-3 text-sm leading-relaxed">
              <p><strong>Registrierung ist möglich.</strong> Buchungen und Zahlungen sind vorübergehend pausiert.</p>
            </div>
          </aside>
        )}
        <FavoritesProvider userId={profile?.id ?? null}>
          <main id="hauptinhalt" tabIndex={-1} className="flex-1 scroll-mt-16">
            {children}
          </main>
        </FavoritesProvider>
        <Footer />
        <Toaster />
        <CookieBanner />
        <CartDrawer />
        <SessionGuard />
      </body>
    </html>
  )
}
