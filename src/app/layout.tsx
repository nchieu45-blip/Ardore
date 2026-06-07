import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Toaster } from '@/components/ui/Toaster'
import CookieBanner from '@/components/CookieBanner'
import { createClient } from '@/lib/supabase/server'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://ardore.de'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile = null
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    profile = data
  }

  return (
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Navbar user={profile} />
        <main className="flex-1">
          {children}
        </main>
        <Footer />
        <Toaster />
        <CookieBanner />
      </body>
    </html>
  )
}
