import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
import { pilotFixture, coach } from './fixtures/visual-identity-pilot.mjs'
const h=React.createElement
const now=Date.now()
const booking={id:'synthetic-booking',buyer_name:'UI Test Customer',scheduled_at:new Date(now+3600000).toISOString(),duration_minutes:60,status:'confirmed',payment_status:'paid',price_cents:6900,is_subscription_session:false}
test('one demo storefront reuses shared product cards and honest qualification provenance; other profiles retain their presentation',async()=>{
 const f=pilotFixture({signedIn:true}),html=render(await f.element())
 assert.ok(html.includes('data-ardore-pilot="storefront"'));assert.ok(html.includes('data-ardore-pilot="product-card"'))
 assert.ok(html.indexOf('pilot-products-title')<html.indexOf('id="pilot-subscriptions"'))
 assert.ok(html.includes('Angaben des Coaches'));assert.ok(!html.includes('Beliebt'));assert.ok(!html.includes('Verifiziert'))
 assert.ok(html.includes('data-product="synthetic-pilot-product"'));assert.ok(html.includes('data-tier="synthetic-pilot-tier"'))
 for(const table of ['creator_profiles','products'])assert.ok(f.reads.some(r=>r.table===table&&r.filters.some(v=>v[0]==='eq'&&v[1]==='is_published'&&v[2]===true)))
 const other=render(await pilotFixture({profile:{...coach,slug:'another-coach'}}).element())
 assert.ok(!other.includes('data-ardore-pilot="storefront"'));assert.ok(!other.includes('data-ardore-pilot="product-card"'));assert.ok(other.includes('data-product="synthetic-pilot-product"'))
})
test('dashboard reads only the authenticated coach bookings, keeps private meeting URLs out, and prioritizes appointments over ledger',async()=>{
 const f=pilotFixture({workspace:true,bookings:[booking],meetingIds:[booking.id]}),html=render(await f.element())
 assert.ok(html.indexOf('workspace-appointments-title')<html.indexOf('workspace-finances-title'))
 assert.ok(html.includes('Meeting-Link hinterlegt'));assert.ok(html.includes('Europe/Berlin'));assert.ok(html.includes(`/session/${booking.id}`));assert.equal((html.match(new RegExp(`/session/${booking.id}`, 'g'))??[]).length,1, 'Overlapping reads do not duplicate appointments')
 assert.ok(html.includes('Stripe-Testmodus'));assert.ok(html.includes('Abrechnung, Erstattungen &amp; Hinweise'))
 const owned=f.reads.find(r=>r.table==='creator_profiles');assert.ok(owned.filters.some(v=>v[1]==='user_id'&&v[2]===coach.user_id))
 const query=f.reads.find(r=>r.table==='bookings');assert.ok(query.filters.some(v=>v[1]==='creator_id'&&v[2]===coach.id))
 assert.ok(!query.filters.find(v=>v[0]==='select')[1].includes('email'))
 assert.equal(f.reads.filter(r=>r.table==='bookings').length,2, 'Recent starts cannot exhaust the separately bounded next-appointment query')
 const meeting=f.reads.find(r=>r.table==='booking_meeting_links');assert.deepEqual(meeting.filters.find(v=>v[0]==='select'),['select','booking_id'])
})
test('booking/meeting failures are visible and never become a false empty/ready state',async()=>{
 const failed=render(await pilotFixture({workspace:true,errors:{bookings:{message:'synthetic'}}}).element());assert.ok(failed.includes('Termine konnten nicht geladen werden'));assert.ok(!failed.includes('Keine bevorstehenden Termine'))
 const unknown=render(await pilotFixture({workspace:true,bookings:[booking],errors:{booking_meeting_links:{message:'synthetic'}}}).element());assert.ok(unknown.includes('Meeting-Status nicht verfügbar'));assert.ok(!unknown.includes('Meeting-Link fehlt'))
 const missing=render(await pilotFixture({workspace:true,bookings:[booking]}).element());assert.ok(missing.includes('Meeting-Link fehlt'))
})
test('dashboard authentication is retained and cannot be skipped by supplied fixture data',async()=>{
 await assert.rejects(pilotFixture({workspace:true,signedIn:false}).element(),/Redirect:\/login/)
})
test('overview preserves free/pending state labels and omits ended sessions without inferring completion',()=>{
 const Panel=loadUiComponent('src/components/pilot/CoachDayOverview.tsx').CoachDayOverview
 const html=render(h(Panel,{bookings:[{...booking,price_cents:0,payment_status:'not_required'},{...booking,id:'pending',status:'pending_payment',payment_status:'pending'},{...booking,id:'past',scheduled_at:new Date(now-7200000).toISOString()}],error:false,meetingError:false,meetingReadyIds:new Set(),now}))
 assert.ok(html.includes('Kostenlos'));assert.ok(html.includes('Zahlung ausstehend'));assert.ok(!html.includes('/session/past'));assert.ok(!html.includes('Nicht bezahlt'))
})
