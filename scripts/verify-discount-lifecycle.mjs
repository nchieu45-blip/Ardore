import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { discountFunctions as discount } from './fixtures/discount-reservation.mjs'

test('percent/fixed discount arithmetic is capped and never changes an offer into a negative amount', () => {
  assert.equal(discount.savingsCents('percent', 20, 999), 200)
  assert.equal(discount.savingsCents('percent', 100, 999), 999)
  assert.equal(discount.savingsCents('fixed', 5000, 999), 999)
  for (const [type, value, amount] of [['percent',101,500],['fixed',-1,500],['unknown',1,500],['fixed',1,-1]]) assert.throws(() => discount.savingsCents(type,value,amount))
})
test('minimum is checked at transaction level; free offers remain free and 1–49 cents are rejected', () => {
  for (const amount of [0,50,999]) assert.doesNotThrow(() => discount.requireStripeMinimum(amount))
  for (let amount=1;amount<50;amount++) assert.throws(() => discount.requireStripeMinimum(amount), {code:'minimum_payment',status:400})
  assert.deepEqual(discount.allocateDiscount([25,25,25],25),[17,17,16])
})
test('whole-cent allocations conserve the exact customer payment, including large and unequal baskets', () => {
  for (const amounts of [[1,1,1],[999,101,0],[1999999999,1],[50,30,20]]) {
    const total=amounts.reduce((a,b)=>a+b,0)
    for (const savings of [0,1,Math.floor(total/2),total]) {
      const allocation=discount.allocateDiscount(amounts,savings)
      assert.equal(allocation.reduce((a,b)=>a+b,0),total-savings)
      assert.ok(allocation.every((a,i)=>Number.isInteger(a)&&a>=0&&a<=amounts[i]))
    }
  }
})
test('the real server adapter passes immutable buyer/coach/scope/amount identity to its private atomic RPC', async () => {
  const input={id:'owned-request',discountId:'discount',buyerId:'buyer',creatorId:'coach',kind:'subscriptions',originalCents:500,tierId:'tier'}
  const calls=[]
  const service={rpc:async(name,args)=>{calls.push({name,args});return {data:{id:input.id,discount_id:input.discountId,original_cents:500,savings_cents:100,final_cents:400},error:null}}}
  const result=await discount.reserveDiscount(service,input)
  assert.equal(result.final_cents,400)
  assert.deepEqual(calls,[{name:'reserve_discount_redemption',args:{p_id:input.id,p_discount_id:'discount',p_buyer_id:'buyer',p_creator_id:'coach',p_kind:'subscriptions',p_original_cents:500,p_product_ids:[],p_tier_id:'tier'}}])
  for (const response of [{error:{}},{data:{error:'discount_limit_reached'}},{data:{id:'foreign'}}]) {
    await assert.rejects(discount.reserveDiscount({rpc:async()=>response},input),discount.DiscountError)
  }
})
test('checkout creation cannot mutate counters, and free/paid claim functions are not client callable', () => {
  for(const path of ['stripe/checkout','stripe/subscription','coaching/book']) {
    const source=readFileSync(new URL(`../src/app/api/${path}/route.ts`,import.meta.url),'utf8')
    assert.doesNotMatch(source,/update\(\{\s*redemption_count/)
    assert.match(source,/reserveDiscount/)
    assert.match(source,/requireStripeMinimum/)
  }
  const migration=readFileSync(new URL('../supabase/migrations/20261004170236_discount_redemption_lifecycle.sql',import.meta.url),'utf8')
  assert.match(migration,/FOR UPDATE/)
  assert.match(migration,/FROM PUBLIC,anon,authenticated/)
  assert.match(migration,/SECURITY INVOKER/)
  assert.doesNotMatch(migration,/SECURITY DEFINER/)
  assert.match(migration,/EXCEPTION WHEN SQLSTATE 'P0003'/)
})
