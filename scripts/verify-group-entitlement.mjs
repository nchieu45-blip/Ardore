// Local HTTP and entitlement contracts only: no external clients or side effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, overrides) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', source)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule, { env: { NEXT_PUBLIC_APP_URL: 'https://www.ardore-health.com' } },
  )
  return loadedModule.exports
}
const origin = 'https://www.ardore-health.com'
const classId = '20000000-0000-4000-8000-000000000001'
const buyerId = '00000000-0000-4000-8000-000000000011'
const requestId = '30000000-0000-4000-8000-000000000001'
const occurrenceStart = '2099-01-01T18:00:00Z'
const validation = load('../src/lib/group-booking-validation.ts', {})
const entitlement = load('../src/lib/subscription-entitlement.ts', {})
const http = load('../src/lib/group-booking-http.ts', { '@/lib/app-url': { appOrigin: () => origin } })
const validSub = {
  creator_id: 'coach-a', status: 'active', current_period_end: '2099-01-01T00:00:00Z',
  stripe_subscription_id: 'sub_trusted', stripe_livemode: true, subscription_tiers: { creator_id: 'coach-a' },
}
function fixture({ user = { id: buyerId }, result = { httpStatus: 200, reservationId: requestId, status: 'confirmed' }, throws = false } = {}) {
  const calls = [], services = []
  const service = { synthetic: true }
  const handlers = {
    async reserveGroupBooking(args) { calls.push(['reserve',args]); if(throws)throw new Error('secret-service-detail'); return result },
    async startOrResumeGroupCheckout(args) { calls.push(['resume',args]); return result },
    async cancelGroupBooking(args) { calls.push(['cancel',args]); return result }, ...validation,
  }
  const overrides = {
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
      createServiceClient: async () => { services.push(service); return service } },
    '@/lib/group-booking-payments': handlers, '@/lib/group-booking-http': http,
  }
  const book = load('../src/app/api/video-classes/[id]/book/route.ts', overrides)
  const retry = load('../src/app/api/video-classes/reservations/[id]/retry/route.ts', overrides)
  const cancel = load('../src/app/api/video-classes/bookings/[id]/cancel/route.ts', overrides)
  async function run({ payload = { requestId, expectedPriceCents: 500, occurrenceStart }, headers = {}, id = classId, action = 'book', raw } = {}) {
    const request = new Request(`${origin}/api/video-classes/${id}/${action}`, { method:'POST',
      headers: { Origin: origin, 'Content-Type':'application/json', ...headers }, body: raw ?? JSON.stringify(payload) })
    return ({ book, retry, cancel })[action].POST(request,{params:Promise.resolve({id})})
  }
  return { calls, services, service, run }
}
test('group HTTP booking requires authentication before any privileged work',async()=>{
  const f=fixture({user:null});assert.equal((await f.run()).status,401);assert.deepEqual(f.services,[]);assert.deepEqual(f.calls,[])
})
test('cross-site, missing-origin and non-JSON group mutations are rejected before authentication/database',async()=>{
  for(const headers of [{Origin:'https://evil.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'}]){
    const f=fixture();assert.ok([403,415].includes((await f.run({headers})).status));assert.deepEqual(f.services,[]);assert.deepEqual(f.calls,[])
  }
})
test('browser cannot supply buyer, payment state, Stripe mode, price override or arbitrary columns',async()=>{
  for(const extra of [{buyerId:'attacker'},{priceCents:0},{status:'confirmed'},{stripeLivemode:true},{paymentOrderId:requestId}]){
    const f=fixture();assert.equal((await f.run({payload:{requestId,expectedPriceCents:500,occurrenceStart,...extra}})).status,400);assert.equal(f.calls.length,0)
  }
})
test('strict request and occurrence validation never reaches reservation RPC for malformed payloads',async()=>{
  for(const payload of [null,[],{}, {requestId:'bad',expectedPriceCents:500},{requestId,expectedPriceCents:'0'},
    {requestId,expectedPriceCents:0.1},{requestId,expectedPriceCents:500,occurrenceStart:'tomorrow'}]){
    const f=fixture();assert.equal((await f.run({payload})).status,400);assert.equal(f.calls.length,0)
  }
  const f=fixture();assert.equal((await f.run({raw:'{'})).status,400);assert.equal((await f.run({id:'bad'})).status,400)
})
test('group booking delegates only validated comparison price and server-authenticated buyer identity',async()=>{
  const f=fixture({result:{httpStatus:202,reservationId:requestId,status:'processing'}});const response=await f.run()
  assert.equal(response.status,202);assert.deepEqual(f.calls,[['reserve',{service:f.service,classId,buyerId,requestId,expectedPriceCents:500,occurrenceStart}]])
  assert.deepEqual(await response.json(),{reservationId:requestId,status:'processing'})
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer')
})
test('capacity and configuration failures remain explicit and do not fabricate a confirmed booking',async()=>{
  for(const result of [{httpStatus:409,code:'full',error:'Ausgebucht'},{httpStatus:503,code:'video_not_configured',error:'Videoanrufe sind noch nicht eingerichtet'}]){
    const f=fixture({result});const response=await f.run();assert.equal(response.status,result.httpStatus);const body=await response.json();assert.equal(body.code,result.code);assert.equal(body.bookingId,undefined)
  }
})
test('retry and cancellation derive owner from authentication and accept no replacement financial terms',async()=>{
  for(const action of ['retry','cancel']){
    const f=fixture();const response=await f.run({action,payload:{}});assert.equal(response.status,200)
    assert.deepEqual(f.calls[0],[action==='retry'?'resume':'cancel',action==='retry'?{service:f.service,reservationId:classId,buyerId}:{service:f.service,bookingId:classId,actorId:buyerId}])
    assert.equal((await f.run({action,payload:{buyerId:'attacker'}})).status,400)
    assert.equal((await fixture({user:null}).run({action,payload:{}})).status,401)
  }
})
test('unpaid, expired, canceled or foreign-tier subscriptions never grant a free group entitlement',()=>{
  for(const subscription of [null,{...validSub,stripe_livemode:false},{...validSub,status:'canceled'},
    {...validSub,current_period_end:'2000-01-01T00:00:00Z'},{...validSub,subscription_tiers:{creator_id:'coach-b'}},
    {...validSub,stripe_livemode:null,stripe_subscription_id:'freeXforged'}]) assert.equal(entitlement.hasActiveSubscriptionEntitlement(subscription),false)
})
test('only live paid and server-issued free active benefits qualify for group inclusion',()=>{
  assert.equal(entitlement.hasActiveSubscriptionEntitlement(validSub),true)
  assert.equal(entitlement.hasActiveSubscriptionEntitlement({...validSub,stripe_livemode:null,stripe_subscription_id:'free_server-issued'}),true)
})
test('uncertain backend exceptions stay retryable without leaking service details',async()=>{
  const f=fixture({throws:true});const response=await f.run();assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(await response.json()),/secret-service-detail/)
})
