// Local interaction fixtures only; no database or provider access.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupUiHarness, start, second, ok, fail, available } from './fixtures/group-booking-ui.mjs'

test('private video URL rejects foreign origins, credentials, queries and invalid tokens', () => {
  const validate = groupUiHarness('video').exports.privateVideoUrl
  assert.equal(validate('https://fixture.daily.co/room', 'header.payload.signature'), 'https://fixture.daily.co/room?t=header.payload.signature')
  for (const url of ['https://daily.co/room', 'https://fixture.daily.co.evil.test/room', 'http://fixture.daily.co/room', 'https://user:pass@fixture.daily.co/room', 'https://fixture.daily.co/room?key=old', 'https://fixture.daily.co/room#secret', 'https://fixture.daily.co/room/other']) assert.equal(validate(url, 'a.b.c'), null)
  for (const token of ['', 'secret', '<script>', 'a.b.c.d', 'a'.repeat(9000)]) assert.equal(validate('https://fixture.daily.co/room', token), null)
})

test('video access stays lazy, prevents duplicate joins, closes at the end and stores no credentials', async () => {
  let resolve
  const h = groupUiHarness('video', [() => new Promise(done => { resolve = done })])
  await h.effects()
  assert.equal(h.requests.length, 0)
  const click = h.action().props.onClick
  const first = click(); await click()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { occurrenceStart: start })
  assert.match(h.html(), /aria-busy="true"/)
  resolve(ok({ roomUrl: 'https://fixture.daily.co/room', token: 'a.b.c' })); await first
  assert.match(h.html(), /title="Privater Videoanruf"/)
  assert.match(h.html(), /referrerPolicy="no-referrer"/i)
  assert.equal(h.storage.size, 0)
  h.advance(65 * 60_000)
  assert.match(h.html(), /Termin beendet/)
  assert.doesNotMatch(h.html(), /iframe|a\.b\.c/)
})

test('video does not offer entry before the window, after the end, or without configuration', () => {
  const early = groupUiHarness('video', [], { scheduledAt: second })
  assert.match(early.html(), /15 Minuten vor Beginn/); assert.equal(early.action(), null)
  const missing = groupUiHarness('video', [], { configurationReady: false })
  assert.match(missing.html(), /noch nicht eingerichtet/); assert.equal(missing.action(), null)
  const ended = groupUiHarness('video', [], { scheduledAt: '2026-10-31T12:00:00Z' })
  assert.match(ended.html(), /Termin beendet/); assert.equal(ended.action(), null)
  const invalid = groupUiHarness('video', [], { scheduledAt: 'invalid' })
  assert.match(invalid.html(), /role="alert"/); assert.equal(invalid.action(), null)
})

test('rejected or invalid video access never renders an iframe and permits explicit retry', async () => {
  for (const response of [fail(401), fail(409), fail(503), ok({ roomUrl: 'https://attacker.test/call', token: 'a.b.c' })]) {
    const h = groupUiHarness('video', [response])
    await h.action().props.onClick()
    assert.match(h.html(), /role="alert"/)
    assert.doesNotMatch(h.html(), /iframe|attacker.test/)
    assert.ok(h.action())
  }
})

test('group booking uses per-date capacity and blocks payment when video setup, counts or availability are missing', async () => {
  for (const response of [available({ videoReady: false }), available({ remaining: 0, isFull: true }), available({ remaining: -1 }), fail(503)]) {
    const h = groupUiHarness('booking', [response])
    await h.effects()
    assert.equal(h.action().props.disabled, true)
    await h.action().props.onClick()
    assert.equal(h.requests.length, 1)
    assert.doesNotMatch(h.html(), /Gebucht ·/)
  }
})

test('booking keeps one request identity after a lost response, rejects a double click and sends the listed price', async () => {
  let resolve
  const h = groupUiHarness('booking', [available(), () => new Promise(done => { resolve = done }), ok({ status: 'confirmed', bookingId: 'booking' })], { priceCents: 0, listedPriceCents: 1200 })
  await h.effects()
  const click = h.action().props.onClick
  const first = click(); await click()
  assert.equal(h.requests.length, 2)
  resolve(Promise.reject(new Error('lost response'))); await first
  const firstBody = JSON.parse(h.requests[1].options.body)
  assert.equal(firstBody.expectedPriceCents, 1200)
  assert.equal(firstBody.occurrenceStart, start)
  assert.match(firstBody.requestId, /^[a-f0-9-]{36}$/)
  await h.action().props.onClick()
  assert.equal(JSON.parse(h.requests[2].options.body).requestId, firstBody.requestId)
  assert.match(h.html(), /Gebucht · Zu meinen Gruppenbuchungen/)
  assert.equal(h.refreshes, 1)
})

test('pending checkout is never displayed as booked and known terminal attempts get a new identity', async () => {
  const pending = groupUiHarness('booking', [available(), ok({ status: 'processing', reservationId: 'reservation' })])
  await pending.effects(); await pending.action().props.onClick()
  assert.match(pending.html(), /Zahlung wird geprüft/)
  assert.doesNotMatch(pending.html(), /Gebucht ·/)
  assert.equal(pending.action().props.disabled, true)
  for (const status of ['expired', 'failed', 'cancelled', 'refunded']) {
    const retry = groupUiHarness('booking', [available(), status === 'expired' || status === 'failed' ? fail(409, { status, error: 'Reservierung beendet' }) : ok({ status }), ok({ status: 'confirmed', bookingId: 'new-booking' })])
    await retry.effects(); await retry.action().props.onClick()
    assert.match(retry.html(), /Buchung erneut versuchen/)
    await retry.action().props.onClick()
    assert.notEqual(JSON.parse(retry.requests[1].options.body).requestId, JSON.parse(retry.requests[2].options.body).requestId)
    assert.match(retry.html(), /Gebucht · Zu meinen Gruppenbuchungen/)
  }
})

test('switching dates rechecks capacity and uses an independent booking identity', async () => {
  const h = groupUiHarness('booking', [available(), ok({ status: 'confirmed', bookingId: 'one' }), available({ occurrenceStart: second }), ok({ status: 'confirmed', bookingId: 'two' })])
  await h.effects(); await h.action().props.onClick()
  h.target(node => node.type === 'select').props.onChange({ target: { value: second } })
  assert.equal(h.action().props.disabled, true)
  await h.effects(); await h.action().props.onClick()
  assert.notEqual(JSON.parse(h.requests[1].options.body).requestId, JSON.parse(h.requests[3].options.body).requestId)
  assert.equal(JSON.parse(h.requests[3].options.body).occurrenceStart, second)
})

test('checkout continuation redirects only to Stripe and cancellation stays an explicit action', async () => {
  const h = groupUiHarness('actions', [ok({ url: 'https://checkout.stripe.com/c/pay/fixture' })])
  await h.action().props.onClick()
  assert.equal(h.destinations[0], 'https://checkout.stripe.com/c/pay/fixture')
  for (const url of ['javascript:alert(1)', 'https://checkout.stripe.com.evil.test/x']) {
    const unsafe = groupUiHarness('actions', [ok({ url })]); await unsafe.action().props.onClick()
    assert.equal(unsafe.destinations.length, 0); assert.match(unsafe.html(), /role="alert"/)
  }
  const cancel = groupUiHarness('actions', [ok({ status: 'refund_pending' })], { status: 'confirmed', canCancel: true })
  assert.equal(cancel.requests.length, 0)
  assert.match(cancel.html(), /Stornieren und Erstattung anfordern/)
  assert.match(cancel.html(), /Bankbearbeitung/)
  await cancel.action().props.onClick()
  assert.equal(cancel.requests[0].url, '/api/video-classes/bookings/booking/cancel')
  assert.doesNotMatch(cancel.html(), /Erstattung abgeschlossen/)
  assert.equal(cancel.refreshes, 1)
})

test('a lost rebooking response resumes its new request identity after every known terminal state',async()=>{
  for(const status of ['expired','failed','cancelled','refunded']) {
    const h=groupUiHarness('booking',[available(),ok({status}),new Error('Lost new attempt response'),ok({status:'confirmed',bookingId:'rebooked'})])
    await h.effects();await h.action().props.onClick();await h.action().props.onClick()
    const original=JSON.parse(h.requests[1].options.body).requestId
    const rebooking=JSON.parse(h.requests[2].options.body).requestId
    assert.notEqual(rebooking,original)
    assert.match(h.html(),/setzt dieselbe Buchung fort/)
    await h.action().props.onClick()
    assert.equal(JSON.parse(h.requests[3].options.body).requestId,rebooking)
    assert.match(h.html(),/Gebucht · Zu meinen Gruppenbuchungen/)
  }
})

test('refund and manual-review outcomes do not invite another charge or claim to be terminal',async()=>{
  for(const status of ['refund_pending','payment_review']) {
    const h=groupUiHarness('booking',[available(),status==='payment_review'?fail(409,{status,error:'Bitte kontaktiere den Support.'}):ok({status})])
    await h.effects();await h.action().props.onClick()
    assert.equal(h.action().props.disabled,true)
    assert.match(h.html(),status==='refund_pending'?/Erstattung wird bearbeitet/:/Zahlung benötigt Prüfung/)
    assert.match(h.html(),/Meine Gruppenbuchungen ansehen/)
    assert.doesNotMatch(h.html(),/Dieser Zahlungsversuch ist abgeschlossen|Buchung erneut versuchen/)
    await h.action().props.onClick()
    assert.equal(h.requests.length,2)
  }
})
