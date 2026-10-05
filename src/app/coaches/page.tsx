import { Suspense } from 'react'
import type { Metadata } from 'next'
import CoachesPageClient from './CoachesPageClient'
import { loadPublicCoaches } from '@/lib/publicCoaches'
import Loading from './loading'
export type { CoachData } from '@/lib/publicCoaches'
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Coaches entdecken',
  description: 'Entdecke Coaches für Fitness, Ernährung und Wohlbefinden. Vergleiche Profile und Angebote auf Ardore.',
}
export default async function CoachesPage() {
  const coaches = await loadPublicCoaches()
  return <Suspense fallback={<Loading />}><CoachesPageClient coaches={coaches} /></Suspense>
}
