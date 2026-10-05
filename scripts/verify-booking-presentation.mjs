import { loadUiComponent } from './fixtures/load-ui-component.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require=createRequire(import.meta.url)
function load(path,mocks={}){const loadedModule={exports:{}};const code=ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;new Function('require','exports','module',code)(name=>mocks[name]??require(name),loadedModule.exports,loadedModule);return loadedModule.exports}
const presentation=load('src/lib/booking-presentation.ts')
const base={price_cents:12345,payment_status:'paid',status:'confirmed',is_subscription_session:false,scheduled_at:'2026-10-20T08:00:00Z',duration_minutes:60}
for(const [name,patch,label] of [
 ['free',{price_cents:0,payment_status:'not_required'},'Kostenlos'],['legacy free',{price_cents:0,payment_status:'unpaid'},'Kostenlos'],
 ['subscription',{price_cents:0,is_subscription_session:true},'Inklusiv (Abo)'],['paid',{},'Bezahlt'],
 ['pending',{status:'pending_payment',payment_status:'pending'},'Zahlung ausstehend'],['failed',{status:'payment_failed',payment_status:'failed'},'Zahlung fehlgeschlagen'],
 ['cancelled paid',{status:'cancelled'},'Bezahlt'],['refunded',{status:'cancelled',payment_status:'refunded'},'Erstattet'],
 ['partial refund',{payment_status:'partially_refunded'},'Teilweise erstattet'],['expired',{payment_status:'expired'},'Zahlung abgelaufen'],
 ['disputed',{payment_status:'disputed'},'Zahlung in Klärung'],['chargeback',{payment_status:'chargeback'},'Zahlung zurückgebucht'],
 ['unknown',{payment_status:'unexpected'},'Zahlungsstatus wird geprüft'],
])test(`payment presentation: ${name}`,()=>assert.equal(presentation.bookingPaymentLabel({...base,...patch}),label))
test('cancellation is distinct from payment; refund pending/failure does not falsely say refunded',()=>{
 assert.equal(presentation.bookingStatusLabel('cancelled'),'Storniert')
 for(const refund_status of ['pending','failed'])assert.equal(presentation.bookingPaymentLabel({...base,status:'cancelled',refund_status}),'Bezahlt')
 assert.equal(presentation.bookingPaymentSummary({...base,price_cents:0,payment_status:'unpaid'}),'Kostenlos')
 assert.equal(presentation.bookingPaymentSummary(base),'123,45 € · Bezahlt')
})
test('grouping depends only on scheduled end, includes future cancelled/pending/failed/refunded, nearest future first',()=>{
 const rows=['confirmed','cancelled','pending_payment','payment_failed','refunded','completed'].map((status,i)=>({...base,id:status,status,scheduled_at:`2026-10-${20+i}T08:00:00Z`}))
 const original=JSON.stringify(rows)
 const result=presentation.groupBookingsByTime([...rows].reverse(),Date.parse('2026-10-19T00:00:00Z'))
 assert.deepEqual(result.current.map(b=>b.id),rows.map(b=>b.id));assert.deepEqual(result.past,[])
 assert.equal(JSON.stringify(rows),original,'No status/payment/data mutation')
 const ended=presentation.groupBookingsByTime(rows,Date.parse('2026-10-20T09:00:00Z'));assert.equal(ended.past.length,1)
 const ongoing=presentation.groupBookingsByTime(rows,Date.parse('2026-10-20T08:30:00Z'));assert.equal(ongoing.current.length,6)
})
function pageFixture(rows){
 const user={id:'buyer'}
 const client={auth:{getUser:async()=>({data:{user}})},from(table){return {select(){return this},eq(){return this},order:async()=>({data:table==='bookings'?rows:[]}),single:async()=>({data:{id:'coach'}}),in:async()=>({data:[]}),then(resolve){resolve({data:[]})}}}}
 const empty=()=>null
 return {
  '@/components/ui/StatusBadge':loadUiComponent('src/components/ui/StatusBadge.tsx'),
  '@/lib/supabase/server':{createClient:async()=>client},'@/lib/booking-presentation':presentation,
  'next/navigation':{redirect:()=>assert.fail('Unexpected redirect')},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  '@/lib/coaching-payment':{hasValidCoachingPayment:()=>false},'@/lib/features':{VIDEO_CALLS_ENABLED:false},
  '@/components/BookingActions':{__esModule:true,default:empty,BookingRefundStatus:empty},
  '@/components/BookingPaymentActions':{__esModule:true,default:empty,BookingPaymentReconciliationStatus:empty},'@/components/SessionReviewPrompt':{__esModule:true,default:empty},
 }
}
for(const [role,path] of [['customer','buyer'],['coach','creator']])test(`${role} actual page shows all payment states and Berlin times in correct groups`,async()=>{
 const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10)
 const rows=[{...base,id:'free',price_cents:0,payment_status:'unpaid'},{...base,id:'paid'},{...base,id:'pending',status:'pending_payment',payment_status:'pending'},{...base,id:'failed',status:'payment_failed',payment_status:'failed'},{...base,id:'cancelled',status:'cancelled'},{...base,id:'refunded',status:'cancelled',payment_status:'refunded'}].map((b,i)=>({...b,scheduled_at:`${future}T${String(8+i).padStart(2,'0')}:00:00Z`,creator_id:'coach',buyer_name:'Synthetic buyer',buyer_email:'delivered+synthetic@resend.dev',creator_profiles:{id:'coach',display_name:'Synthetic coach'},refund_status:'not_requested',stripe_livemode:false}))
 rows.push({...rows[1],id:'past',scheduled_at:'2025-01-15T09:00:00Z',status:'completed'})
 const page=load(`src/app/${path}/sessions/page.tsx`,pageFixture(rows)).default
 const html=renderToStaticMarkup(await page({searchParams:Promise.resolve({})}))
 for(const label of ['Kostenlos','Bezahlt','Zahlung ausstehend','Zahlung fehlgeschlagen','Storniert','Erstattet','Abgeschlossen','Europe/Berlin','Vergangen'])assert.ok(html.includes(label),label)
 assert.ok(!html.includes('Nicht bezahlt'));assert.ok(html.indexOf('/session/cancelled')<html.indexOf('>Vergangen<'))
 assert.ok(html.indexOf('/session/pending')<html.indexOf('>Vergangen<'))
 assert.ok(html.includes('10:00 Uhr (Europe/Berlin)'),'Winter UTC 09:00 displays Berlin 10:00')
})
