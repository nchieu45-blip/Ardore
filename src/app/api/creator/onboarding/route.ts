import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { coachProfileSchema, missingCoachRequirements, type CoachSetupProfile } from '@/lib/coach-publication'
import { slugify } from '@/lib/utils'

const fields = 'id,display_name,slug,bio,category,categories,avatar_url,banner_url,is_published,onboarding_step'
const requestSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal(1), data: coachProfileSchema }).strict(),
  z.object({ step: z.literal(2), data: z.object({ avatar_url: z.url().optional(), banner_url: z.url().optional() }).strict() }).strict(),
  z.object({ step: z.literal(3), data: z.union([z.object({}).strict(), z.object({ name: z.string().trim().min(2).max(50), description: z.string().max(300).optional(), price_monthly: z.number().int().min(0).max(999) }).strict()]) }).strict(),
  z.object({ step: z.literal(4), data: z.union([z.object({}).strict(), z.object({ title: z.string().trim().min(3).max(100), description: z.string().max(1000).optional(), type: z.enum(['pdf','video','course','image']), price: z.number().min(0.5).max(9999) }).strict()]) }).strict(),
  z.object({ step: z.literal(5), publish: z.literal(true) }).strict(),
])

export async function GET() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data, error } = await client.from('creator_profiles').select(fields).eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Einrichtung konnte nicht geladen werden.' }, { status: 503 })
  return NextResponse.json({ profile: data, missing: data ? missingCoachRequirements(data) : ['Profilangaben speichern'] }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const input = requestSchema.safeParse(await req.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? 'Ungültige Angaben' }, { status: 400 })
  const { step } = input.data
  const data: Record<string, unknown> = 'data' in input.data ? { ...input.data.data } : {}
  if (step === 1) {
    data.category = (data.categories as string[])[0]
    data.slug = `${slugify(data.display_name as string) || 'coach'}-${randomUUID().slice(0,8)}`
  }
  // Only this actor's storage namespace is accepted; never attach another coach's upload.
  if (step === 2) for (const value of Object.values(data)) {
    const url = new URL(value as string)
    const { data: own } = await client.from('creator_profiles').select('id').eq('user_id', user.id).maybeSingle()
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
    if (!own || url.origin !== base.origin || !url.pathname.startsWith(`/storage/v1/object/public/profile-images/${own.id}/`)) {
      return NextResponse.json({ error: 'Ungültiger Profilbild-Pfad.' }, { status: 400 })
    }
  }
  const service = await createServiceClient()
  const { data: profile, error } = await service.rpc('advance_coach_onboarding', {
    p_user_id: user.id, p_expected_step: step, p_data: data, p_publish: step === 5,
  })
  if (error) {
    const { data: current } = await client.from('creator_profiles').select(fields).eq('user_id', user.id).maybeSingle()
    const missing = current ? missingCoachRequirements(current) : ['Profilangaben speichern']
    return NextResponse.json({ error: error.code === '40001' ? 'Der Schritt hat sich geändert. Bitte lade die Seite neu.' : 'Einrichtung konnte nicht gespeichert werden.', missing }, { status: ['22023','23514','40001'].includes(error.code) ? 409 : 503 })
  }
  return NextResponse.json({ profile, missing: missingCoachRequirements(profile as CoachSetupProfile) })
}
