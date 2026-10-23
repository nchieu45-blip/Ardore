import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { canonicalOccurrenceStart, validVideoId } from '@/lib/video-provider'
import { formatGroupOccurrence } from '@/lib/group-schedule'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import ProtectedVideoRoom from '@/components/ProtectedVideoRoom'
import GroupBookingActions from '@/components/GroupBookingActions'
import { formatCurrency } from '@/lib/utils'

export const metadata: Metadata = { title: 'Gruppen-Session', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

interface Attendee {
  id: string; user_id: string; reservation_id: string | null; status: string
  occurrence_start: string | null; duration_minutes: number | null; class_title: string | null
  price_paid_cents: number; payment_status: string; stripe_livemode: boolean | null
  refund_status: string; amount_refunded_cents: number
}
const fields = 'id,user_id,reservation_id,status,occurrence_start,duration_minutes,class_title,price_paid_cents,payment_status,stripe_livemode,refund_status,amount_refunded_cents'

export default async function GroupSessionPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ occurrenceStart?: string | string[] }>
}) {
  const { id } = await params
  const query = await searchParams
  const startsAt = canonicalOccurrenceStart(query.occurrenceStart)
  if (!validVideoId(id) || !startsAt) notFound()
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  const path = `/group-session/${id}?occurrenceStart=${encodeURIComponent(startsAt)}`
  if (authError || !user) redirect(`/login?redirect=${encodeURIComponent(path)}`)
  const { data: course, error: courseError } = await client.from('video_classes')
    .select('id,creator_id,title,duration_minutes,creator_profiles(user_id,display_name,slug)')
    .eq('id', id).maybeSingle()
  if (courseError) return <LoadError path={path} />
  if (!course) notFound()
  const coach = Array.isArray(course.creator_profiles) ? course.creator_profiles[0] : course.creator_profiles
  const isCoach = coach?.user_id === user.id
  let attendee: Attendee | null = null
  if (!isCoach) {
    const result = await client.from('video_class_bookings').select(fields)
      .eq('video_class_id', id).eq('user_id', user.id).eq('occurrence_start', startsAt).maybeSingle()
    if (result.error) return <LoadError path={path} />
    attendee = result.data as Attendee | null
    if (!attendee || attendee.user_id !== user.id) notFound()
  }

  // Private occurrence metadata is read only after coach ownership or the
  // caller's exact per-date registration has been established through RLS.
  const service = await createServiceClient()
  const { data: occurrence, error: occurrenceError } = await service.from('video_class_occurrences')
    .select('video_class_id,starts_at,class_title,duration_minutes').eq('video_class_id', id).eq('starts_at', startsAt).maybeSingle()
  if (occurrenceError) return <LoadError path={path} />
  if (!occurrence && !isCoach) return <LoadError path={path} />
  const duration = occurrence?.duration_minutes ?? course.duration_minutes
  const title = occurrence?.class_title ?? course.title
  const now = new Date().getTime()
  const end = Date.parse(startsAt) + duration * 60_000
  const eligible = isCoach || Boolean(attendee && attendee.status === 'confirmed' && attendee.reservation_id
    && attendee.refund_status === 'not_requested' && attendee.amount_refunded_cents === 0 && (
      attendee.payment_status === 'not_required' && attendee.price_paid_cents === 0
      || attendee.payment_status === 'paid' && attendee.stripe_livemode === true
    ))
  let roster: Attendee[] = []
  let rosterError = false
  const names = new Map<string, string>()
  if (isCoach) {
    const result = await client.from('video_class_bookings').select(fields)
      .eq('video_class_id', id).eq('occurrence_start', startsAt).order('created_at', { ascending: true }).limit(500)
    rosterError = Boolean(result.error)
    roster = (result.data ?? []) as Attendee[]
    if (roster.length > 0) {
      // Bounded to the verified coach's actual participant IDs; no user search.
      const profiles = await service.from('profiles').select('id,full_name').in('id', [...new Set(roster.map(row => row.user_id))])
      for (const profile of profiles.data ?? []) if (typeof profile.full_name === 'string') names.set(profile.id, profile.full_name)
    }
  }

  return <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
    <Link href={isCoach ? '/creator/settings/video-classes' : '/buyer/video-classes'} className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-4">← {isCoach ? 'Meine Gruppen-Kurse' : 'Meine Gruppenbuchungen'}</Link>
    <div className="mb-6 mt-4 border-b border-border pb-6">
      <h1 className="section-title break-words">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{formatGroupOccurrence(startsAt)} · {duration} Min.</p>
      <p className="mt-2 text-sm text-muted">{isCoach ? 'Du leitest diesen Gruppentermin.' : `Mit ${coach?.display_name ?? 'deinem Coach'}. Diese Anmeldung gilt nur für diesen Termin.`}</p>
    </div>
    {eligible && VIDEO_CALLS_ENABLED ? <ProtectedVideoRoom key={`${id}:${startsAt}`} endpoint={`/api/video-classes/${id}/meeting`} request={{ occurrenceStart: startsAt }} scheduledAt={startsAt} durationMinutes={duration} configurationReady={Boolean(process.env.DAILY_API_KEY?.trim())} />
      : <p role="status" className="rounded-xl border border-border p-5 text-sm text-muted">Für diese Anmeldung ist kein bestätigter Videozugang verfügbar. Prüfe den Buchungs- und Zahlungsstatus in deiner Übersicht.</p>}
    {isCoach && <section className="mt-8 border-t border-border pt-6"><h2 className="text-lg font-semibold">Anmeldungen für diesen Termin</h2>
      {rosterError ? <p role="alert" className="mt-3 text-sm text-red-700">Die Anmeldungen konnten nicht geladen werden. Bitte lade die Seite erneut.</p>
        : roster.length === 0 ? <p className="mt-3 text-sm text-muted">Für diesen Termin liegen noch keine Anmeldungen vor.</p>
        : <ul className="mt-4 space-y-4">{roster.map(row => <li key={row.id} className="border-b border-border pb-4 last:border-b-0">
          <p className="font-medium">{names.get(row.user_id) || 'Teilnehmer'}</p>
          <p className="mt-1 text-sm text-muted">{row.status === 'confirmed' ? 'Angemeldet' : 'Storniert'} · {row.price_paid_cents === 0 ? 'Kostenlos / Abo' : formatCurrency(row.price_paid_cents / 100)}{row.stripe_livemode === false && row.price_paid_cents > 0 ? ' · Testzahlung' : ''}</p>
          {row.refund_status === 'pending' && <p className="mt-2 text-sm text-muted">Erstattung wird bearbeitet.</p>}
          {row.refund_status === 'failed' && <p role="alert" className="mt-2 text-sm text-red-700">Erstattung noch nicht abgeschlossen. Bitte kontaktiere den Support mit Buchungsnummer {row.id}.</p>}
          {row.reservation_id && <GroupBookingActions reservationId={row.reservation_id} bookingId={row.id} status={row.status} canCancel={row.status === 'confirmed' && now < end} paid={row.price_paid_cents > 0} role="coach" />}
        </li>)}</ul>}
      <p className="mt-4 text-xs leading-relaxed text-muted">Bereits gebuchte Termine werden nicht durch eine Änderung der Kursvorlage verschoben. Sage betroffene Anmeldungen einzeln ab, wenn der Termin nicht stattfinden kann.</p>
    </section>}
  </div>
}

function LoadError({ path }: { path: string }) {
  return <div role="alert" className="mx-auto max-w-3xl px-4 py-8"><h1 className="text-xl font-semibold">Die Gruppen-Session konnte nicht geladen werden</h1><p className="mt-3 text-sm text-muted">Deine Buchung bleibt unverändert. Bitte versuche es erneut.</p><Link href={path} className="mt-4 inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4">Erneut laden</Link></div>
}
