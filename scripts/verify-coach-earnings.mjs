import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
const require=createRequire(import.meta.url)
function load(path,mocks={}){const m={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','exports','module',code)(n=>mocks[n]??require(n),m.exports,m);return m.exports}
const slots=load('src/lib/coaching-slots.ts'),earnings=load('src/lib/coach-earnings.ts',{'./coaching-slots':slots})
const row={id:'one',kind:'products',gross_cents:1000,platform_fee_cents:100,coach_net_cents:900,amount_refunded_cents:0,refund_requested_cents:0,amount_reversed_cents:0,transfer_amount_cents:900,stripe_transfer_id:'tr_test',stripe_payment_intent_id:'pi_test',state:'settled',fulfillment_state:'fulfilled',created_at:'2026-10-04T08:00:00Z'}
const now=Date.parse('2026-10-04T12:00:00Z')
test('realized product, booking and individual recurring cycles share one ledger metric definition',()=>{
 const rows=[row,{...row,id:'booking',kind:'booking'},{...row,id:'cycle-1',kind:'subscription'},{...row,id:'cycle-2',kind:'subscription'}]
 const s=earnings.summarizeEarnings(rows,now);assert.equal(s.all.gross,4000);assert.equal(s.all.net,3600);assert.equal(s.all.fee,400);assert.equal(s.all.transferred,3600);assert.equal(s.all.pending,0);assert.equal(s.sources.subscription.payments,2)
})
test('full refund and reversal remove revenue exactly once',()=>{
 const v=earnings.earningsForRow({...row,amount_refunded_cents:1000,refund_requested_cents:1000,amount_reversed_cents:900,state:'refunded'})
 assert.equal(v.gross,1000);assert.equal(v.refunded,1000);assert.equal(v.retained,0);assert.equal(v.fee,0);assert.equal(v.net,0);assert.equal(v.transferred,0);assert.equal(v.pending,0);assert.equal(v.reversed,900)
})
test('partial refund uses existing cumulative cent rounding and does not subtract the reversal again from earnings',()=>{
 const v=earnings.earningsForRow({...row,amount_refunded_cents:333,amount_reversed_cents:299});assert.equal(v.retained,667);assert.equal(v.net,601);assert.equal(v.fee,66);assert.equal(v.transferred,601)
 assert.equal(v.retained,v.fee+v.net)
})
test('unconfirmed transfer, held and failed transfer remain pending; these are captured payments, not failed checkouts',()=>{
 for(const state of ['pending','held','transferring','failed','awaiting_fulfillment']){const v=earnings.earningsForRow({...row,state,stripe_transfer_id:null});assert.equal(v.transferred,0);assert.equal(v.pending,900);assert.equal(v.net,900)}
 assert.equal(earnings.summarizeEarnings([],now).all.gross,0,'Failed/unpaid payment orders do not appear in settlement input')
})
test('requested refund is not confirmed; outstanding reversal is explicit and reconciles net with current balance',()=>{
 const requested=earnings.earningsForRow({...row,refund_requested_cents:1000});assert.equal(requested.retained,1000);assert.equal(requested.refundPending,1000)
 const reversedPending=earnings.earningsForRow({...row,amount_refunded_cents:1000});assert.equal(reversedPending.net,0);assert.equal(reversedPending.transferred,900);assert.equal(reversedPending.reversalPending,900)
 assert.equal(reversedPending.net,reversedPending.transferred+reversedPending.pending-reversedPending.reversalPending)
})
test('all-time totals and month use Berlin ledger dates; current tariffs/MRR never enter historical sums',()=>{
 const rows=[row,{...row,id:'previous',created_at:'2026-09-20T10:00:00Z'},{...row,id:'berlin-midnight',created_at:'2026-09-30T22:30:00Z',currentMonthlyRate:99999}]
 const s=earnings.summarizeEarnings(rows,now);assert.equal(s.all.gross,3000);assert.equal(s.month.gross,2000);assert.equal(s.days.reduce((sum,d)=>sum+d.revenue,0),20)
})
test('duplicate or corrupt records fail instead of producing plausible false financial totals',()=>{
 assert.throws(()=>earnings.summarizeEarnings([row,row],now));assert.throws(()=>earnings.earningsForRow({...row,amount_refunded_cents:1001}));assert.throws(()=>earnings.earningsForRow({...row,amount_reversed_cents:901}));assert.throws(()=>earnings.earningsForRow({...row,platform_fee_cents:99}));assert.throws(()=>earnings.earningsForRow({...row,created_at:'invalid'}))
})
test('historical actual payments exclude refunded sums and disputed/failure status, without inventing fees',()=>{
 assert.equal(earnings.historicalGross({paid:1000,refunded:300,payment_status:'partially_refunded'}),700);assert.equal(earnings.historicalGross({paid:1000,refunded:1000,payment_status:'refunded'}),0)
 for(const payment_status of ['failed','pending','disputed','chargeback','reversed'])assert.equal(earnings.historicalGross({paid:1000,refunded:0,payment_status}),null)
})
function fixture({owner={id:'owned'},ownerError=null,readError=null,ledger=Array.from({length:501},(_,i)=>({...row,id:String(i),stripe_payment_intent_id:`pi_${i}`})),legacy=[]}={}){
 const reads=[];let privilegedCalls=0
 const client={from(){return{select(){return this},eq(k,v){reads.push(['owner',k,v]);return this},maybeSingle:async()=>({data:owner,error:ownerError})}}}
 const service={from(table){const filters=[];return{select(){return this},eq(k,v){filters.push([k,v]);return this},not(){return this},gt(){return this},order(){return this},range:async(start,end)=>{reads.push([table,filters,start,end]);return{error:readError,data:(table==='payment_settlements'?ledger:table==='purchases'?legacy:[]).slice(start,end+1)}}}}}
 const server=load('src/lib/coach-earnings-server.ts',{'@/lib/supabase/server':{createServiceClient:async()=>{privilegedCalls++;return service}},'@/lib/stripe/connect-readiness':{configuredStripeLivemode:()=>false},'@/lib/coach-earnings':earnings})
 return{load:()=>server.loadCoachEarnings(client,'authenticated-user',now),reads,privilegedCalls:()=>privilegedCalls}
}
test('private financial reads derive coach ownership, keep TEST/LIVE separate and include more than 500 rows',async()=>{
 const f=fixture(),s=await f.load();assert.equal(s.all.gross,501000);assert.equal(s.testMode,true)
 assert.deepEqual(f.reads[0],['owner','user_id','authenticated-user'])
 const ledgerReads=f.reads.filter(r=>r[0]==='payment_settlements');assert.equal(ledgerReads.length,2)
 for(const [,filters] of ledgerReads){assert.ok(filters.some(([k,v])=>k==='creator_id'&&v==='owned'));assert.ok(filters.some(([k,v])=>k==='stripe_livemode'&&v===false))}
})
test('owner/auth and database errors fail closed, never return partial/all-zero successes',async()=>{
 for(const options of [{owner:null},{ownerError:{}},{readError:{}}]){const f=fixture(options);await assert.rejects(f.load());if(options.owner===null||options.ownerError)assert.equal(f.privilegedCalls(),0)}
})
test('legacy covered product positions are never counted twice; unknown history is clearly separated',async()=>{
 const f=fixture({ledger:[row],legacy:[{stripe_payment_intent_id:'pi_test',amount_paid:10,amount_refunded:0,payment_status:'paid'},{stripe_payment_intent_id:'pi_legacy',amount_paid:20,amount_refunded:5,payment_status:'partially_refunded'}]})
 const s=await f.load();assert.equal(s.all.retained,1000);assert.equal(s.legacy.products,1);assert.equal(s.legacy.knownProductGross,1500)
})
