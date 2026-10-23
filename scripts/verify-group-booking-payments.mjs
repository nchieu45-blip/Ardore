// Deterministic local provider/database fixtures only. No environment files,
// real Stripe/Daily/Supabase clients, network calls, emails or production rows.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const buyer = '00000000-0000-4000-8000-000000000011'
const creator = '10000000-0000-4000-8000-000000000001'
const classId = '20000000-0000-4000-8000-000000000001'
const reservationId = '30000000-0000-4000-8000-000000000001'
const bookingId = '40000000-0000-4000-8000-000000000001'
const requestId = '50000000-0000-4000-8000-000000000001'
const origin = 'https://www.ardore-health.com'
function load(path, overrides) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require','exports','module','console',compiled)(name => name in overrides ? overrides[name] : require(name),loadedModule.exports,loadedModule,{ error() {} })
  return loadedModule.exports
}
const entitlement = load('../src/lib/subscription-entitlement.ts', {})
const validation = load('../src/lib/group-booking-validation.ts', {})
function fixture(options = {}) {
  const future = new Date(Date.now() + 2 * 86400000).toISOString()
  const r = { id: reservationId, request_id: requestId, buyer_id: buyer, creator_id: creator, video_class_id: classId,
    occurrence_start: future, duration_minutes: 60, class_title: 'Synthetic Group Session', creator_slug: 'fixture-coach',
    price_cents: options.free ? 0 : 500, subscription_id: null, stripe_livemode: options.free ? null : false,
    account_id: options.free ? null : 'acct_fixture', payment_order_id: null, stripe_checkout_session_id: null,
    checkout_url: null, checkout_idempotency_key: 'synthetic-group-checkout-key', checkout_expires_at: new Date(Date.now()+35*60000).toISOString(),
    checkout_request_started_at: null, status: options.free ? 'confirmed' : 'creating', booking_id: options.free ? bookingId : null,
    refund_status: 'not_requested', refund_idempotency_key: 'synthetic-group-refund-key', refund_provider_id: null,
    refund_amount_cents: null, refund_request_started_at: null, refund_requested_at: null, amount_refunded_cents: 0,
    created_at: new Date().toISOString(), ...options.reservation }
  let stored = options.existing ? structuredClone(r) : null
  const queries = [], calls = { rpc: [], creates: [], ready: [], orders: [], binds: [], reconciles: [], refundCreates: [], refundPrepares: [], refundReads: [] }
  const courses = { id: classId, creator_id: creator, active: true, price_cents: options.coursePrice ?? r.price_cents,
    included_in_subscription: !!options.included, schedule_type: 'once', starts_at: future }
  const bookings = [{ id: bookingId, reservation_id: r.id, payment_order_id: r.id, user_id: buyer, payment_status: 'paid',status:'confirmed' },
    {id:'newer-booking',reservation_id:requestId,payment_order_id:requestId,user_id:buyer,payment_status:'paid',status:'confirmed'}]
  const service = { from(table) {
    assert.ok(['group_booking_reservations','video_classes','subscriptions','payment_settlements','video_class_bookings'].includes(table), `Unexpected table ${table}`)
    const q = { table, action: 'select', filters: [], values: null, columns: null }
    queries.push(q)
    const matches = row => q.filters.every(([op,key,value]) => op==='eq' ? row[key]===value : op==='is' ? row[key]===value : op==='in' ? value.includes(row[key]) : op==='not' ? !value.slice(1,-1).split(',').includes(row[key]) : true)
    const exec = () => {
      if (options.databaseError) return { data: null, error: { message: 'sensitive-database-secret' } }
      const rows = table==='group_booking_reservations' ? (stored ? [stored] : []) : table==='video_classes' ? [courses]
        : table==='subscriptions' ? options.subscriptions ?? [] : table==='video_class_bookings' ? bookings
        : [{ order_id: r.id, stripe_payment_intent_id: 'pi_fixture' }]
      const selected = rows.filter(matches)
      if (q.action==='update') selected.forEach(row => Object.assign(row,q.values))
      return { data: structuredClone(selected), error: null }
    }
    return {
      select(columns) { q.columns=columns; return this }, eq(key,value) { q.filters.push(['eq',key,value]); return this },
      not(key,op,value) { q.filters.push(['not',key,value]); return this },
      is(key,value) { q.filters.push(['is',key,value]); return this }, in(key,value) { q.filters.push(['in',key,value]); return this },
      update(values) { q.action='update'; q.values=structuredClone(values); return this }, order() { return this }, limit() { return this },
      async maybeSingle() { const response=exec(); return { ...response, data: response.data?.[0]??null } },
      then(resolve,reject) { return Promise.resolve(exec()).then(resolve,reject) },
    }
  }, async rpc(name,args) {
    calls.rpc.push({ name,args: structuredClone(args) })
    if (options.rpcError) return { data:null,error:{message:'sensitive-rpc-secret'} }
    if (name==='reserve_group_class_booking') {
      stored ??= structuredClone(r)
      return { data:options.claimError ? {error:options.claimError} : {reservation:structuredClone(stored),created:true},error:null }
    }
    if (name==='bind_group_checkout') {
      Object.assign(stored,{payment_order_id:args.p_order_id,stripe_checkout_session_id:args.p_session_id,checkout_url:args.p_checkout_url,status:stored.status==='creating'?'open':stored.status})
      return {data:structuredClone(stored),error:null}
    }
    if (name==='cancel_group_class_booking') {
      if (options.cancelError) return {data:{error:options.cancelError},error:null}
      stored.status=stored.price_cents?'refund_pending':'cancelled';stored.refund_status=stored.price_cents?'pending':'not_requested'
      return {data:{reservation:structuredClone(stored)},error:null}
    }
    throw new Error(`Unexpected RPC ${name}`)
  } }
  let session = { id:'cs_fixture',mode:'payment',livemode:false,currency:'eur',amount_total:500,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/synthetic',payment_intent:null,
    metadata:{ checkout_type:'group_session',ardore_order_id:r.id,reservation_id:r.id,video_class_id:classId,buyer_id:buyer,creator_id:creator },...options.session }
  const intent = {id:'pi_fixture',status:'processing',amount:500,amount_received:0,currency:'eur',livemode:false,metadata:{ardore_order_id:r.id,buyer_id:buyer,creator_id:creator},...options.intent}
  const order = { id:r.id,kind:'group',buyer_id:buyer,creator_id:creator,account_id:r.account_id,gross_cents:r.price_cents,stripe_livemode:r.stripe_livemode,
    reference:{reservationId:r.id,videoClassId:classId,occurrenceStart:r.occurrence_start,durationMinutes:60},state:'created' }
  let lost = options.loseFirstCreate
  const refund = { id:'re_fixture',payment_intent:'pi_fixture',amount:500,currency:'eur',status:options.refundFailed?'failed':'succeeded',metadata:{ardore_refund_key:r.refund_idempotency_key} }
  const provider = { checkout:{ sessions:{
    async create(params,settings) { calls.creates.push({params:structuredClone(params),settings});if(lost){lost=false;throw new Error('private-network-detail')}; return structuredClone(session) },
    async retrieve() { return structuredClone(session) }, list() { return {async autoPagingToArray(){return options.discoveredSessions??[]}} },
  } },paymentIntents:{async retrieve(){return structuredClone(intent)}},refunds:{
    list(){return {async autoPagingToArray(){return options.refunds??[]}}},async retrieve(id){calls.refundReads.push(id);return structuredClone(refund)},
    async create(params,settings){calls.refundCreates.push({params,settings});return structuredClone(refund)},
  } }
  const readiness = { ConnectReadinessError: class extends Error {}, async requirePayoutReadyCoach(_service,id,p) {
    assert.equal(p,provider);calls.ready.push(id);return {accountId:options.readyAccount??'acct_fixture',livemode:false}
  } }
  let lib
  const settlement = {
    async createSettlementOrder(args){calls.orders.push(args);return order},
    async registerSettlementCheckout(args){calls.binds.push(args)},
    async reconcileSettlementCheckout(args){calls.reconciles.push(args);await lib.observeGroupCheckout({service,order,session,provider});if(options.confirmPaid){stored.status='confirmed';stored.booking_id=bookingId}},
    async getSettlementRefundContext(){return {kind:'group',orderId:r.id,settlementId:'60000000-0000-4000-8000-000000000001',grossCents:r.price_cents,buyerId:buyer,creatorId:creator,livemode:false,reference:order.reference}},
    async prepareSettlementRefund(args){calls.refundPrepares.push(args)},
    async reconcileSettlementRefund(){if(!options.refundFailed){stored.refund_status='succeeded';stored.status='refunded';stored.amount_refunded_cents=500}},
  }
  lib = load('../src/lib/group-booking-payments.ts', {
    '@/lib/stripe/server':{stripe:provider},'@/lib/app-url':{appOrigin:()=>origin},'@/lib/stripe/connect-readiness':readiness,
    '@/lib/group-booking-notifications':{async notifyGroupBookingConfirmed(){calls.notifications=(calls.notifications??0)+1}},'@/lib/subscription-entitlement':entitlement,'@/lib/stripe/settlement':settlement,'@/lib/group-booking-validation':validation,
  })
  return {lib,service,provider,calls,queries,r,order,bookings,get stored(){return stored},set session(value){session={...session,...value}}}
}
async function withVideo(fn) {
  const previous=process.env.DAILY_API_KEY
  process.env.DAILY_API_KEY='synthetic-provider-key-never-used-for-network'
  try { await fn() } finally { if(previous===undefined)delete process.env.DAILY_API_KEY;else process.env.DAILY_API_KEY=previous }
}
const reserve = f => f.lib.reserveGroupBooking({service:f.service,provider:f.provider,classId,buyerId:buyer,requestId,expectedPriceCents:f.r.price_cents,occurrenceStart:f.r.occurrence_start})

test('missing video setup refuses new free/paid bookings before provider objects or holds', async()=>{
  const previous=process.env.DAILY_API_KEY;delete process.env.DAILY_API_KEY
  try {for(const free of [false,true]){const f=fixture({free});const result=await reserve(f);assert.equal(result.httpStatus,503);assert.equal(result.code,'video_not_configured');assert.equal(f.calls.rpc.length,0);assert.equal(f.calls.creates.length,0)}}
  finally{if(previous!==undefined)process.env.DAILY_API_KEY=previous}
})
test('paid booking freezes server terms and uses existing separate-charge order before Checkout',()=>withVideo(async()=>{
  const f=fixture();const result=await reserve(f)
  assert.equal(result.url,'https://checkout.stripe.com/synthetic');assert.equal(result.status,'open')
  assert.equal(f.calls.orders[0].kind,'group');assert.equal(f.calls.orders[0].grossCents,500)
  assert.equal(f.calls.creates[0].params.line_items[0].price_data.unit_amount,500)
  assert.equal(f.calls.creates[0].params.payment_intent_data.transfer_group,`ardore-order-${reservationId}`)
  assert.equal(f.calls.creates[0].params.payment_intent_data.application_fee_amount,undefined)
  assert.equal(f.calls.creates[0].params.payment_intent_data.transfer_data,undefined)
  assert.equal(f.calls.creates[0].params.payment_method_types,undefined)
  assert.match(f.calls.creates[0].params.integration_identifier,/^ardore_group_[a-z]{8}$/)
  assert.equal(f.calls.creates[0].settings.idempotencyKey,f.r.checkout_idempotency_key)
  assert.match(f.calls.creates[0].params.success_url,/checkout=success&reservation=/)
  assert.equal(result.bookingId,undefined,'Checkout return is not a booking confirmation')
}))
test('changed advertised price cannot create a hold or payment',()=>withVideo(async()=>{
  const f=fixture({coursePrice:700});const result=await reserve(f);assert.equal(result.code,'price_changed');assert.equal(f.calls.rpc.length,0);assert.equal(f.calls.creates.length,0)
}))
test('free server-confirmed reservation never creates a Stripe order or Checkout',()=>withVideo(async()=>{
  const f=fixture({free:true});const result=await reserve(f);assert.equal(result.bookingId,bookingId);assert.equal(result.status,'confirmed');assert.equal(f.calls.ready.length,0);assert.equal(f.calls.orders.length,0);assert.equal(f.calls.creates.length,0);assert.equal(f.calls.notifications,1);await reserve(f);assert.equal(f.calls.notifications,1)
}))
test('provider timeout preserves durable request and exact idempotent create parameters',()=>withVideo(async()=>{
  const f=fixture({loseFirstCreate:true});const first=await reserve(f);assert.equal(first.httpStatus,503);assert.equal(first.reservationId,reservationId);assert.equal(f.stored.status,'creating')
  const second=await reserve(f);assert.equal(second.status,'open');assert.equal(f.calls.creates.length,2)
  assert.deepEqual(f.calls.creates[0],f.calls.creates[1]);assert.equal(f.calls.rpc.filter(x=>x.name==='reserve_group_class_booking').length,1)
  assert.doesNotMatch(JSON.stringify(first),/private-network-detail/)
}))
test('same buyer request cannot be reused for another occurrence',()=>withVideo(async()=>{
  const f=fixture({existing:true});const result=await f.lib.reserveGroupBooking({service:f.service,provider:f.provider,classId,buyerId:buyer,requestId,expectedPriceCents:500,occurrenceStart:new Date(Date.parse(f.r.occurrence_start)+60000).toISOString()})
  assert.equal(result.code,'request_conflict');assert.equal(f.calls.creates.length,0)
}))
test('current provider processing retains its hold without another payable checkout',()=>withVideo(async()=>{
  const f=fixture({existing:true,reservation:{status:'open',payment_order_id:reservationId,stripe_checkout_session_id:'cs_fixture'},session:{status:'complete',payment_intent:'pi_fixture'},intent:{status:'processing'}})
  const result=await f.lib.startOrResumeGroupCheckout({service:f.service,provider:f.provider,reservationId,buyerId:buyer});assert.equal(result.httpStatus,202);assert.equal(result.status,'processing');assert.equal(f.calls.creates.length,0)
}))
test('only a fresh terminal provider observation closes an unpaid hold',()=>withVideo(async()=>{
  const f=fixture({existing:true,reservation:{status:'open',payment_order_id:reservationId,stripe_checkout_session_id:'cs_fixture'},session:{status:'expired',payment_intent:'pi_fixture'},intent:{status:'requires_payment_method',amount_received:0}})
  const result=await f.lib.startOrResumeGroupCheckout({service:f.service,provider:f.provider,reservationId,buyerId:buyer});assert.equal(result.code,'checkout_closed');assert.equal(f.stored.status,'expired');assert.equal(f.calls.creates.length,0)
}))
test('unknown creation older than provider idempotency retention is discovery-only',()=>withVideo(async()=>{
  const old=new Date(Date.now()-25*3600000).toISOString();const f=fixture({existing:true,reservation:{created_at:old,checkout_request_started_at:old}})
  const result=await f.lib.startOrResumeGroupCheckout({service:f.service,provider:f.provider,reservationId,buyerId:buyer});assert.equal(result.httpStatus,503);assert.equal(f.stored.status,'creating');assert.equal(f.calls.creates.length,0)
}))
test('foreign session identity or amount is not returned to a buyer',()=>withVideo(async()=>{
  for(const session of [{amount_total:900},{livemode:true},{metadata:{ardore_order_id:requestId}}]){
    const f=fixture({session});const result=await reserve(f);assert.equal(result.httpStatus,503);assert.equal(result.url,undefined)
  }
}))
test('refund projection is bound to the exact reservation/payment and cannot revoke a newer booking',async()=>{
  const f=fixture({existing:true,reservation:{status:'confirmed',payment_order_id:reservationId,booking_id:bookingId}})
  await f.lib.projectGroupPaymentState({service:f.service,order:f.order,settlement:{order_id:reservationId,gross_cents:500,amount_refunded_cents:500},disputeState:null})
  const update=f.queries.find(q=>q.table==='video_class_bookings'&&q.action==='update');assert.deepEqual(update.filters,[['eq','reservation_id',reservationId],['eq','payment_order_id',reservationId],['eq','user_id',buyer]])
  assert.equal(update.values.status,'cancelled');assert.equal(f.stored.status,'refunded')
})
test('a durable failed refund ID is never automatically replaced',async()=>{
  const f=fixture({existing:true,reservation:{status:'refund_pending',refund_status:'failed',payment_order_id:reservationId,refund_provider_id:'re_failed'}})
  const result=await f.lib.refundGroupReservation({service:f.service,provider:f.provider,reservationId});assert.equal(result.refund_status,'failed');assert.equal(f.calls.refundCreates.length,0)
})
test('full cancellation refund uses existing reversal engine and stable frozen provider key',async()=>{
  const f=fixture({existing:true,reservation:{status:'refund_pending',refund_status:'pending',payment_order_id:reservationId,booking_id:bookingId}})
  const result=await f.lib.refundGroupReservation({service:f.service,provider:f.provider,reservationId});assert.equal(result.refund_status,'succeeded');assert.equal(f.calls.refundPrepares[0].targetRefundedCents,500);assert.equal(f.calls.refundCreates[0].settings.idempotencyKey,f.r.refund_idempotency_key)
  assert.equal(f.calls.refundCreates[0].params.amount,500);await f.lib.refundGroupReservation({service:f.service,provider:f.provider,reservationId});assert.equal(f.calls.refundCreates.length,1)
})
test('database/provider failures expose no raw credentials or internal details',()=>withVideo(async()=>{
  const f=fixture({databaseError:true});const result=await reserve(f);assert.equal(result.httpStatus,503);assert.doesNotMatch(JSON.stringify(result),/sensitive-/)
}))

test('durable request identity preserves PostgreSQL microseconds and offset equivalence',()=>withVideo(async()=>{
  const t=new Date(Date.now()+86400000).toISOString().replace(/\.\d{3}Z$/,'.123456Z')
  const f=fixture({existing:true,reservation:{occurrence_start:t}})
  assert.equal((await f.lib.reserveGroupBooking({service:f.service,provider:f.provider,classId,buyerId:buyer,requestId,expectedPriceCents:500,occurrenceStart:t.replace('123456','123457')})).code,'request_conflict')
  assert.equal(validation.sameGroupInstant('2099-01-01T10:00:00.123456+01:00','2099-01-01T09:00:00.123456Z'),true)
  assert.equal(validation.validGroupInstant('2099-02-30T10:00:00Z'),false)
}))
test('partial refund cancels only the original entitlement and requires explicit payment review',async()=>{
  const f=fixture({existing:true,reservation:{status:'confirmed',payment_order_id:reservationId,booking_id:bookingId}})
  await f.lib.projectGroupPaymentState({service:f.service,order:f.order,settlement:{order_id:reservationId,gross_cents:500,amount_refunded_cents:100},disputeState:null})
  assert.equal(f.stored.status,'payment_review');assert.equal(f.bookings[0].status,'cancelled');assert.equal(f.bookings[0].payment_status,'partially_refunded')
  assert.equal(f.bookings[1].status,'confirmed');assert.equal(f.bookings[1].payment_status,'paid')
})
test('late ordinary observation cannot restore a disputed booking or erase its payment state',async()=>{
  const f=fixture({existing:true,reservation:{status:'confirmed',payment_order_id:reservationId,booking_id:bookingId}})
  await f.lib.projectGroupPaymentState({service:f.service,order:f.order,settlement:{order_id:reservationId,gross_cents:500,amount_refunded_cents:0},disputeState:'disputed'})
  await f.lib.projectGroupPaymentState({service:f.service,order:f.order,settlement:{order_id:reservationId,gross_cents:500,amount_refunded_cents:0},disputeState:null})
  assert.equal(f.stored.status,'payment_review');assert.equal(f.bookings[0].status,'cancelled');assert.equal(f.bookings[0].payment_status,'disputed')
})

test('failed provider refunds leave automatic recovery for explicit review without a replacement payment',async()=>{
  const f=fixture({existing:true,refundFailed:true,reservation:{status:'refund_pending',refund_status:'pending',payment_order_id:reservationId,booking_id:bookingId}})
  const first=await f.lib.refundGroupReservation({service:f.service,provider:f.provider,reservationId})
  assert.equal(first.status,'payment_review');assert.equal(first.refund_status,'failed')
  await f.lib.refundGroupReservation({service:f.service,provider:f.provider,reservationId})
  assert.equal(f.calls.refundCreates.length,1)
  const recovery=await f.lib.recoverGroupPayments({service:f.service,provider:f.provider})
  assert.equal(recovery.checked,0)
})

test('recovery migrates historical failed refunds to support review and reports failure honestly',async()=>{
  const f=fixture({existing:true,reservation:{status:'refund_pending',refund_status:'failed',payment_order_id:reservationId,refund_provider_id:'re_failed'}})
  const recovery=await f.lib.recoverGroupPayments({service:f.service,provider:f.provider})
  assert.deepEqual(recovery,{checked:1,confirmed:0,closed:0,pending:0,failed:1})
  assert.equal(f.stored.status,'payment_review');assert.equal(f.calls.refundCreates.length,0)
})

test('unresolved provider outcomes keep their capacity hold but advance the bounded recovery cursor',()=>withVideo(async()=>{
  const f=fixture({existing:true,reservation:{status:'creating',checkout_request_started_at:new Date(Date.now()-24*3600000).toISOString(),updated_at:'2000-01-01T00:00:00Z'}})
  const recovery=await f.lib.recoverGroupPayments({service:f.service,provider:f.provider})
  assert.deepEqual(recovery,{checked:1,confirmed:0,closed:0,pending:0,failed:1})
  assert.equal(f.stored.status,'creating');assert.equal(f.stored.booking_id,null)
  assert.ok(Date.parse(f.stored.updated_at)>Date.parse('2000-01-01T00:00:00Z'))
  assert.equal(f.calls.creates.length,0,'No replacement Checkout beyond the idempotency window')
}))
