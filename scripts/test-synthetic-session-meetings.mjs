// Only disposable GoTrue actors and free bookings created by this exact run.
// Credentials stay in memory; no Stripe operation or real user's email is used.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

if (!process.argv.includes('--run-production-synthetic')) {
  console.log('Skipped: requires --run-production-synthetic; creates only disposable free fixtures.')
  process.exit(0)
}
process.loadEnvFile('.env.local')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'yboeyxqeileicecqpwke.supabase.co')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Stripe must remain TEST')
const base = process.argv.find(value => value.startsWith('--base='))?.slice(7) ?? 'https://www.ardore-health.com'
assert.ok(['https://www.ardore-health.com','http://127.0.0.1:3010'].includes(base))
const preview = process.argv.includes('--render-preview')
const run = randomUUID(), tag = `ardore-meeting-${run.slice(0,12)}`
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const users = [], coaches = [], bookings = [], results = []
const dir = `/tmp/${tag}-preview`
const check = async promise => { const result = await promise; if (result.error) throw new Error(`Synthetic database operation failed (${result.error.code ?? 'unknown'})`); return result.data }
const pass = label => { results.push(label); console.log(`PASS ${label}`) }
let succeeded = false
async function actor(role) {
  const email = `delivered+${tag}-${users.length}@resend.dev`, password = randomBytes(32).toString('base64url')
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { role, full_name: 'Synthetic session verification' } })
  if (error || !data.user) throw new Error('Synthetic GoTrue creation failed')
  users.push(data.user.id)
  const cookies = new Map()
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })),
      setAll: values => values.forEach(({ name,value }) => cookies.set(name,value)) },
  })
  const login = await client.auth.signInWithPassword({ email,password })
  if (login.error) throw new Error('Synthetic login failed')
  return { id: data.user.id, email, client, cookie: () => [...cookies].map(([name,value]) => `${name}=${value}`).join('; ') }
}
async function api(actor, path, method = 'GET', body) {
  return fetch(`${base}${path}`, { method, redirect: 'manual', headers: {
    'User-Agent': 'Mozilla/5.0 ArdoreSyntheticSessionVerification',
    ...(actor ? { Cookie: actor.cookie() } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
function savePreview(name, html) {
  if (!preview) return
  // Strip all scripts (including RSC payloads) and keep only this synthetic
  // page's markup/styles. Never persist a session cookie or credential.
  const safe = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('<head>', `<head><base href="${base}/">`)
  assert.ok(!/access_token|refresh_token|sb-.*auth-token|sk_test_|re_[a-zA-Z0-9]{10}/.test(safe), 'Preview must contain no credential payload')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(`${dir}/${name}.html`, safe, { mode: 0o600 })
}
try {
  const owner = await actor('creator'), buyer = await actor('buyer'), foreignCoach = await actor('creator'), foreignBuyer = await actor('buyer')
  for (const [index, coach] of [owner,foreignCoach].entries()) {
    const profile = await check(service.from('creator_profiles').insert({ user_id: coach.id,
      display_name: 'Synthetic session verification', slug: `${tag}-${index}` }).select('id').single())
    coach.creatorId = profile.id; coaches.push(profile.id)
  }
  const booking = await check(service.from('bookings').insert({ creator_id: owner.creatorId, buyer_id: buyer.id,
    buyer_email: buyer.email, buyer_name: 'Synthetic session verification', scheduled_at: new Date(Date.now()+48*3600000).toISOString(),
    duration_minutes: 60, price_cents: 0, status: 'confirmed', payment_status: 'not_required', cancellation_policy_hours: 24,
  }).select('id').single())
  bookings.push(booking.id)
  const endpoint = `/api/coaching/meeting/${booking.id}`, page = `/session/${booking.id}`
  const initial = `https://meet.google.com/synthetic-${run}`, updated = `https://example.zoom.us/j/synthetic-${run}`
  for (const [name, actor] of [['coach-missing',owner],['buyer-missing',buyer]]) {
    const response = await api(actor,page); assert.equal(response.status,200, 'Own session page must load')
    assert.match(response.headers.get('cache-control'),/private|no-store/, 'Private session page must not be publicly cached')
    const html = await response.text(); assert.ok(html.includes('noch keinen Meeting-Link') || html.includes('Noch kein Meeting-Link'))
    savePreview(name,html)
  }
  pass('own confirmed booking has clear missing-link states for coach and customer')
  assert.equal((await api(null,endpoint)).status,401)
  assert.equal((await api(buyer,endpoint)).status,409)
  for (let attempt=0; attempt<2; attempt++) assert.equal((await api(buyer,endpoint,'POST')).status,200)
  const notices = await check(service.from('notifications').select('id').eq('user_id',owner.id).eq('link',page).eq('title','Meeting-Link benötigt'))
  assert.equal(notices.length,1)
  for (const stranger of [foreignBuyer,foreignCoach,owner]) assert.equal((await api(stranger,endpoint,'POST')).status,404)
  pass('only owning customer can request missing link; repeated requests create one private coach notice')

  for (const actor of [buyer,foreignCoach,foreignBuyer]) assert.equal((await api(actor,endpoint,'PATCH',{ meetingUrl: initial })).status,404)
  for (const value of ['http://meet.google.com/x','javascript:alert(1)','https://user:password@zoom.us/x','https://127.0.0.1/x']) {
    assert.equal((await api(owner,endpoint,'PATCH',{ meetingUrl:value })).status,400)
  }
  assert.equal((await api(owner,endpoint,'PATCH',{ meetingUrl:initial })).status,200)
  assert.equal((await api(owner,endpoint,'PATCH',{ meetingUrl:initial })).status,200)
  const buyerNotices = await check(service.from('notifications').select('id').eq('user_id',buyer.id).eq('link',page).eq('title','Meeting-Link verfügbar'))
  assert.equal(buyerNotices.length,1)
  pass('only owning coach sets valid HTTPS link; invalid URLs are refused and unchanged resave does not duplicate notice')

  for (const actor of [owner,buyer]) {
    const row = await check(actor.client.from('booking_meeting_links').select('meeting_url').eq('booking_id',booking.id))
    assert.equal(row.length,1); assert.equal(row[0].meeting_url,initial)
    const response = await api(actor,endpoint)
    assert.equal(response.status,303); assert.equal(response.headers.get('location'),initial)
    assert.match(response.headers.get('cache-control'),/no-store/); assert.equal(response.headers.get('referrer-policy'),'no-referrer')
  }
  for (const actor of [foreignCoach,foreignBuyer]) {
    assert.deepEqual(await check(actor.client.from('booking_meeting_links').select('meeting_url').eq('booking_id',booking.id)),[])
    const response = await api(actor,page); assert.equal(response.status,404)
    assert.ok(!(await response.text()).includes(initial))
    assert.equal((await api(actor,endpoint)).status,404)
  }
  const anonymous = await anon.from('booking_meeting_links').select('meeting_url').eq('booking_id',booking.id)
  assert.equal(anonymous.error?.code,'42501')
  pass('RLS and deployed route protect meeting from anonymous/unrelated customers and coaches')

  for (const actor of [owner,buyer,foreignCoach,foreignBuyer]) {
    for (const mutation of [actor.client.from('booking_meeting_links').upsert({ booking_id:booking.id,meeting_url:updated }),
      actor.client.from('booking_meeting_links').delete().eq('booking_id',booking.id),
      actor.client.rpc('set_booking_meeting_link',{ p_booking_id:booking.id,p_coach_user_id:owner.id,p_meeting_url:updated }),
      actor.client.rpc('request_booking_meeting_link',{ p_booking_id:booking.id,p_buyer_id:buyer.id })]) {
      assert.equal((await mutation).error?.code,'42501')
    }
  }
  pass('16 real authenticated write/RPC permission probes fail closed, including spoofed identities')
  assert.equal((await api(owner,endpoint,'PATCH',{ meetingUrl:updated })).status,200)
  assert.equal((await api(buyer,endpoint)).headers.get('location'),updated)
  for (const [name,actor] of [['coach-ready',owner],['buyer-ready',buyer]]) {
    const response = await api(actor,page); assert.equal(response.status,200)
    assert.match(response.headers.get('cache-control'),/private|no-store/)
    const html = await response.text(); assert.ok(html.includes('Meeting öffnen')); assert.ok(html.includes('example.zoom.us'))
    assert.ok(html.includes('Europe/Berlin')); savePreview(name,html)
  }
  pass('coach updates link; customer page and guarded join use the current URL')

  // Lifecycle access checks affect only this owned free fixture.
  for (const state of ['completed','payment_failed']) {
    await check(service.from('bookings').update({ status:state }).eq('id',booking.id).eq('creator_id',owner.creatorId))
    assert.equal((await api(buyer,endpoint)).status,410)
    assert.deepEqual(await check(buyer.client.from('booking_meeting_links').select('meeting_url').eq('booking_id',booking.id)),[])
    assert.equal((await api(owner,endpoint,'PATCH',{ meetingUrl:initial })).status,409)
  }
  await check(service.from('bookings').update({ status:'confirmed' }).eq('id',booking.id).eq('creator_id',owner.creatorId))
  const cancelled = await api(owner,'/api/coaching/cancel','POST',{ bookingId:booking.id })
  assert.equal(cancelled.status,200); assert.equal((await cancelled.json()).refundStatus,'not_requested')
  assert.equal((await api(buyer,endpoint)).status,410)
  assert.equal((await api(owner,endpoint,'PATCH',{ meetingUrl:initial })).status,409)
  assert.deepEqual(await check(buyer.client.from('booking_meeting_links').select('meeting_url').eq('booking_id',booking.id)),[])
  const cancelledPage = await api(buyer,page); const html = await cancelledPage.text()
  assert.ok(!html.includes(updated)); assert.ok(!html.includes('Meeting öffnen'))
  pass('completed/failed/cancelled bookings lose RLS and stale-link access; real free cancellation creates no refund')
  await new Promise(resolve => setTimeout(resolve,3000)) // let own cancellation after() finish before cleanup
  succeeded = true
} catch (error) {
  // Never print request headers, provider payloads, private URLs or credentials.
  console.error(JSON.stringify({ phase:'synthetic-session-check',status:'failed',error:error.name,step:results.length }))
  process.exitCode = 1
} finally {
  try {
    if (bookings.length) {
      const rows = await check(service.from('bookings').select('id,creator_id,buyer_id').in('id',bookings))
      assert.ok(rows.every(row => coaches.includes(row.creator_id) && users.includes(row.buyer_id)))
      await check(service.from('notifications').delete().in('user_id',users))
      await check(service.from('bookings').delete().in('id',bookings).in('creator_id',coaches))
    }
    if (coaches.length) await check(service.from('creator_profiles').delete().in('id',coaches).in('user_id',users))
    for (const id of users) { const result = await service.auth.admin.deleteUser(id); if (result.error) throw new Error('Synthetic auth cleanup failed') }
    const remaining = bookings.length ? await check(service.from('bookings').select('id').in('id',bookings)) : []
    assert.equal(remaining.length,0)
    console.log(JSON.stringify({ success:succeeded,checks:results.length,syntheticUsersDeleted:users.length,syntheticBookingsDeleted:bookings.length,
      cleanup:'verified', ...(preview ? { previewDirectory:dir } : {}) }))
  } catch { console.error('Synthetic fixture cleanup requires attention'); process.exitCode=1 }
}
