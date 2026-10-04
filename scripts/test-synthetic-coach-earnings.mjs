// Financial display fixtures only: no Stripe API, email, transfer or refund action.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
if(!process.argv.includes('--run-production-synthetic'))process.exit(0)
process.loadEnvFile('.env.local')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'yboeyxqeileicecqpwke.supabase.co')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
const base=process.argv.find(v=>v.startsWith('--base='))?.slice(7)??'https://www.ardore-health.com'
assert.ok(['http://127.0.0.1:3010','https://www.ardore-health.com'].includes(base))
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const tag=`ardore-earnings-${randomUUID().slice(0,12)}`,users=[],coaches=[],orders=[],ledgers=[],products=[],purchases=[]
const check=async p=>{const r=await p;if(r.error)throw new Error(`Owned synthetic operation failed (${r.error.code??'unknown'})`);return r.data}
const pass=s=>console.log(`PASS ${s}`)
async function actor(role){
 const email=`delivered+${tag}-${users.length}@resend.dev`,password=randomBytes(32).toString('base64url')
 const data=await check(service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role,full_name:'Synthetic earnings test'}}));users.push(data.user.id)
 const cookies=new Map(),client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}})
 await check(client.auth.signInWithPassword({email,password}));return{id:data.user.id,email,cookies,client,cookie:()=>[...cookies].map(([n,v])=>`${n}=${v}`).join('; ')}
}
let browser
try{
 const coach=await actor('creator'),foreign=await actor('creator'),buyer=await actor('buyer')
 for(const a of [coach,foreign]){const p=await check(service.from('creator_profiles').insert({user_id:a.id,display_name:'Synthetic earnings coach',slug:`${tag}-${coaches.length}`,category:'yoga',categories:['yoga']}).select('id').single());coaches.push(p.id)}
 const now=new Date(),monthDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(now)
 const previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15,12)).toISOString()
 const cases=[['products',10000,'settled',0,now.toISOString()],['booking',5000,'held',0,now.toISOString()],['subscription',2000,'settled',0,now.toISOString()],['products',4000,'refunded',4000,now.toISOString()],['subscription',3000,'settled',0,previous]]
 for(const [i,[kind,gross,state,refunded,created_at]] of cases.entries()){
 const fee=Math.round(gross/10),net=gross-fee,orderId=randomUUID(),id=randomUUID(),account_id='acct_SyntheticEarnings'
 await check(service.from('payment_orders').insert({id:orderId,kind,buyer_id:buyer.id,creator_id:coaches[0],account_id,gross_cents:gross,platform_fee_cents:fee,coach_net_cents:net,currency:'eur',stripe_livemode:false,reference:{synthetic:tag},state:'fulfilled',created_at}));orders.push(orderId)
 await check(service.from('payment_settlements').insert({id,order_id:orderId,kind,buyer_id:buyer.id,creator_id:coaches[0],account_id,gross_cents:gross,platform_fee_cents:fee,coach_net_cents:net,currency:'eur',stripe_livemode:false,stripe_payment_intent_id:`pi_${tag.replaceAll('-','')}${i}`,stripe_charge_id:`ch_${tag.replaceAll('-','')}${i}`,stripe_invoice_id:kind==='subscription'?`in_${tag.replaceAll('-','')}${i}`:null,cycle_key:`synthetic:${i}`,state,fulfillment_state:state==='refunded'?'refunded':'fulfilled',stripe_transfer_id:state==='held'?null:`tr_${tag.replaceAll('-','')}${i}`,transfer_amount_cents:state==='held'?null:net,amount_refunded_cents:refunded,refund_requested_cents:refunded,amount_reversed_cents:refunded?net:0,created_at,lease_token:randomUUID(),lease_expires_at:new Date(Date.now()+3600000).toISOString()}));ledgers.push(id)
 }
 const unpaid=randomUUID();await check(service.from('payment_orders').insert({id:unpaid,kind:'products',buyer_id:buyer.id,creator_id:coaches[0],account_id:'acct_SyntheticEarnings',gross_cents:7000,platform_fee_cents:700,coach_net_cents:6300,stripe_livemode:false,reference:{synthetic:tag},state:'created'}));orders.push(unpaid)
 const product=await check(service.from('products').insert({creator_id:coaches[0],title:'Synthetic earnings product',description:'Display fixture',type:'pdf',price:12,is_published:false}).select('id').single());products.push(product.id)
 const purchase=await check(service.from('purchases').insert({buyer_id:buyer.id,product_id:product.id,amount_paid:12,amount_refunded:2,payment_status:'partially_refunded',stripe_livemode:false,stripe_payment_intent_id:`pi_${tag.replaceAll('-','')}legacy`}).select('id').single());purchases.push(purchase.id)
 for(const client of [coach.client,foreign.client,buyer.client]){
 const r=await client.from('payment_settlements').select('id').in('id',ledgers);assert.ok(r.error,'Private ledger remains inaccessible to clients')
 }
 const before=await check(service.from('payment_settlements').select('*').in('id',ledgers).order('id'))
 const {chromium}=await import('/Users/nam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
 browser=await chromium.launch({headless:true,executablePath:'/tmp/ardore-playwright-browsers/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
 const context=await browser.newContext({locale:'de-DE'});await context.addCookies([...coach.cookies].map(([name,value])=>({name,value,url:base})))
 const page=await context.newPage(),runtimeErrors=[];page.on('pageerror',e=>runtimeErrors.push(e.message))
 async function metric(scope,label){const index=(await scope.locator('dt').allTextContents()).indexOf(label);assert.ok(index>=0,`Metric missing: ${label}`);return(await scope.locator('dd').nth(index).innerText()).replaceAll(/\s/g,'')}
 for(const width of [375,390,1280]){
 await page.setViewportSize({width,height:900})
 await page.goto(`${base}/creator/earnings?creatorId=${coaches[1]}`)
 const all=page.locator('[data-testid=earnings-all]:visible');await all.waitFor()
 for(const [label,value] of [['Bruttoumsatz nach Erstattungen','200,00€'],['Ardore-Gebühr nach Erstattungen','20,00€'],['Coach-Nettoerlös','180,00€'],['Auf Stripe-Guthaben übertragen','135,00€'],['Übertragung ausstehend','45,00€'],['An Kunden erstattet','40,00€']])assert.equal(await metric(all,label),value)
 assert.equal(await metric(page.locator('[data-testid=earnings-month]:visible'),'Bruttoumsatz nach Erstattungen'),'170,00€')
 const body=await page.locator('body').innerText();assert.ok(body.includes('Stripe-Testmodus'));assert.ok(body.includes('Produktkäufe · 2 Zahlungen'));assert.ok(body.includes('Bezahlte Coaching-Buchungen · 1 Zahlung'));assert.ok(body.includes('Bezahlte Abo-Zyklen · 2 Zahlungen'));assert.ok(body.includes('Produkte 10,00'));assert.ok(body.includes('210,00'));assert.ok(!body.includes('pi_'));assert.ok(!body.includes('tr_'));assert.ok(!body.includes('Gesamtumsatz'))
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow')
 const cookie=page.getByRole('button',{name:'Nur notwendige',exact:false});if(await cookie.isVisible())await cookie.click()
 await page.screenshot({path:`/tmp/ardore-earnings-${width}.png`,fullPage:true})
 await page.goto(`${base}/creator`);await page.locator('[data-testid=earnings-all]:visible').waitFor();assert.equal(await metric(page.locator('[data-testid=earnings-all]:visible'),'Coach-Nettoerlös'),'180,00€');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 pass(`${width}px: product, booking, subscription cycles, refund, pending/completed transfer, all-time/month and overview reconciliation`)
 }
 const other=await browser.newContext({locale:'de-DE'});await other.addCookies([...foreign.cookies].map(([name,value])=>({name,value,url:base})));const otherPage=await other.newPage();await otherPage.goto(`${base}/creator/earnings?creatorId=${coaches[0]}`);await otherPage.locator('[data-testid=earnings-all]:visible').waitFor();assert.equal(await metric(otherPage.locator('[data-testid=earnings-all]:visible'),'Bruttoumsatz nach Erstattungen'),'0,00€');assert.ok(!(await otherPage.locator('body').innerText()).includes('Historische Abrechnung nicht vollständig'))
 await other.close();assert.deepEqual(runtimeErrors,[])
 assert.deepEqual(await check(service.from('payment_settlements').select('*').in('id',ledgers).order('id')),before)
 pass('private ledger denied to all browser roles; coach isolation; financial state unchanged; no runtime errors')
 assert.ok(monthDate)
}finally{
 if(browser)await browser.close()
 if(purchases.length)await check(service.from('purchases').delete().in('id',purchases))
 if(ledgers.length){await check(service.from('payment_settlement_actions').delete().in('settlement_id',ledgers));await check(service.from('payment_settlements').delete().in('id',ledgers))}
 if(orders.length)await check(service.from('payment_orders').delete().in('id',orders))
 if(products.length)await check(service.from('products').delete().in('id',products))
 if(coaches.length)await check(service.from('creator_profiles').delete().in('id',coaches).in('user_id',users))
 for(const id of users)await check(service.auth.admin.deleteUser(id))
 assert.equal((await check(service.from('profiles').select('id').in('id',users))).length,0)
 pass('all owned synthetic accounts, ledger/orders, purchase and products cleaned')
}
