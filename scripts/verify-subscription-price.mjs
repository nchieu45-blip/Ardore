import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const loaded={exports:{}}
new Function('exports','module',ts.transpileModule(readFileSync(new URL('../src/lib/subscription-price.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText)(loaded.exports,loaded)
const {subscriptionPriceLabel:label,subscriptionPriceLabels:labels}=loaded.exports
const sub={id:'s',buyer_id:'b',creator_id:'c',tier_id:'t',stripe_subscription_id:'sub_owned',stripe_livemode:false,tier:{price_monthly:9}}
const order={buyer_id:'b',creator_id:'c',stripe_subscription_id:'sub_owned',stripe_livemode:false,gross_cents:400,reference:{tierId:'t'}}
test('discounted subscription shows agreed monthly payment despite later coach tariff changes',()=>{
  assert.match(label(sub,'b',[order]),/4,00/)
  assert.doesNotMatch(label(sub,'b',[order]),/9,00/)
})
test('trusted free subscription displays free even though its coach tier has a paid tariff',()=>{
  assert.equal(label({...sub,stripe_subscription_id:'free_discount_owned',stripe_livemode:null},'b',[]),'Kostenlos')
})
test('foreign or mismatched owner, tier, coach, subscription and mode cannot supply the billed-price label',()=>{
  assert.equal(label(sub,'other',[order]),'Preis nicht verfügbar')
  for(const change of [{buyer_id:'other'},{creator_id:'other'},{reference:{tierId:'other'}},{stripe_subscription_id:'sub_other'},{stripe_livemode:true}])assert.match(label(sub,'b',[{...order,...change}]),/^Tarifpreis/)
})
test('legacy subscription price is explicitly a tariff rather than an invented actual billed amount',()=>{
  assert.match(label(sub,'b',[]),/^Tarifpreis/)
})
test('private agreed-price lookup is buyer scoped before any privileged reads',async()=>{
  const calls=[]
  const query={select(){return this},eq(k,v){calls.push([k,v]);return this},in(k,v){calls.push([k,v]);return Promise.resolve({data:[order],error:null})}}
  const result=await labels({from(t){assert.equal(t,'payment_orders');return query}},'b',[sub])
  assert.deepEqual(calls,[['buyer_id','b'],['kind','subscription'],['stripe_subscription_id',['sub_owned']]])
  assert.match(result.s,/4,00/)
})
