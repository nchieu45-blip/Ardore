// Owned synthetic fixtures only; no Stripe, email or reschedule write requests.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
if(!process.argv.includes('--run-production-synthetic'))process.exit(0)
process.loadEnvFile('.env.local')
const base=process.argv.find(v=>v.startsWith('--base='))?.slice(7)??'https://www.ardore-health.com'
assert.ok(['http://127.0.0.1:3010','https://www.ardore-health.com'].includes(base))
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'yboeyxqeileicecqpwke.supabase.co')
const require=createRequire(import.meta.url),mod={exports:{}}
new Function('require','exports','module',ts.transpileModule(readFileSync('src/lib/coaching-slots.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(require,mod.exports,mod)
const {currentBerlinDateString,addDaysToDateString,berlinDateTimeToIso}=mod.exports
const date=addDaysToDateString(currentBerlinDateString(),7)
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const users=[],profiles=[],bookings=[],tag=`ardore-reschedule-${randomUUID().slice(0,12)}`
const check=async p=>{const r=await p;if(r.error)throw new Error(`Synthetic operation failed (${r.error.code??'unknown'})`);return r.data}
const pass=s=>console.log(`PASS ${s}`)
async function actor(role){
 const email=`delivered+${tag}-${users.length}@resend.dev`,password=randomBytes(32).toString('base64url')
 const data=await check(service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role,full_name:'Synthetic reschedule test'}}));users.push(data.user.id)
 const cookies=new Map(),client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}})
 await check(client.auth.signInWithPassword({email,password}))
 return{id:data.user.id,email,cookies,client,cookie:()=>[...cookies].map(([n,v])=>`${n}=${v}`).join('; ')}
}
let browser
try {
 const coach=await actor('creator'),buyer=await actor('buyer'),foreign=await actor('buyer')
 const p=await check(service.from('creator_profiles').insert({user_id:coach.id,display_name:'Synthetic reschedule coach',slug:tag,category:'yoga',categories:['yoga']}).select('id').single());profiles.push(p.id)
 await check(service.rpc('replace_coach_availability',{p_creator_id:p.id,p_coach_user_id:coach.id,p_slots:Array.from({length:7},(_,day_of_week)=>({day_of_week,start_time:'09:00',end_time:'18:00'})),p_date_overrides:[],p_expected_revision:0,p_offer:{is_enabled:true,price_cents:0,duration_minutes:60,description:'Synthetic reschedule',buffer_minutes:15,min_notice_hours:0,max_horizon_days:60,cancellation_policy_hours:24}}))
 const row=await check(service.from('bookings').insert({creator_id:p.id,buyer_id:buyer.id,buyer_name:'Synthetic reschedule buyer',buyer_email:buyer.email,scheduled_at:berlinDateTimeToIso(date,'10:00'),duration_minutes:60,buffer_minutes:15,cancellation_policy_hours:24,stripe_livemode:false,price_cents:0,payment_status:'not_required',status:'confirmed'}).select('id').single());bookings.push(row.id)
 async function api(a,payload){return fetch(`${base}/api/coaching/reschedule`,{method:'POST',headers:{Cookie:a?.cookie()??'','Content-Type':'application/json'},body:JSON.stringify(payload)})}
 const payload={bookingId:row.id,newDate:date,newTime:'12:45'}
 assert.ok([403,404].includes((await api(foreign,payload)).status));assert.equal((await api(null,payload)).status,401);assert.equal((await api(buyer,{...payload,newDate:'invalid'})).status,400);pass('customer authentication, foreign ownership and invalid input')
 const {chromium}=await import('/Users/nam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
 browser=await chromium.launch({headless:true,executablePath:'/tmp/ardore-playwright-browsers/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
 const context=await browser.newContext({locale:'de-DE'});await context.addCookies([...buyer.cookies].map(([name,value])=>({name,value,url:base})))
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 async function open(){await page.goto(`${base}/buyer/sessions`);const consent=page.getByRole('button',{name:'Nur notwendige Cookies',exact:true});if(await consent.isVisible())await consent.click();const trigger=page.getByRole('button',{name:'Verschieben',exact:true}).first();await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'Session verschieben'}).waitFor();return trigger}
 async function choose(){const d=page.getByRole('dialog');await d.getByText('Verfügbare Tage werden geladen …').waitFor({state:'hidden'});await d.locator(`input[value="${date}"]`).focus();await page.keyboard.press('Space');await d.locator('input[value="12:45"]').waitFor();await d.locator('input[value="12:45"]').focus();await page.keyboard.press('Space');return d}
 for(const width of [375,390,1280]){
 await page.setViewportSize({width,height:900});const trigger=await open();const d=page.getByRole('dialog');await d.getByText('Verfügbare Tage werden geladen …').waitFor({state:'hidden'})
 assert.equal(await d.evaluate(el=>el.contains(document.activeElement)),true)
 for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.equal(await d.evaluate(el=>el.contains(document.activeElement)),true)}
 assert.ok(await d.evaluate(el=>el.getBoundingClientRect().width<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 const ids=await d.locator('[id]').evaluateAll(es=>es.map(e=>e.id));assert.equal(new Set(ids).size,ids.length)
 assert.ok(await d.locator('input').evaluateAll(es=>es.every(e=>e.labels.length>0&&e.required)))
 await page.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);pass(`${width}px modal focus trap, labels, Escape and focus restoration`)
 }
 await open();await choose()
 let calls=0,release
 await page.route('**/api/coaching/reschedule',async r=>{calls++;await new Promise(resolve=>release=resolve);await r.fulfill({status:500,contentType:'application/json',body:'{"error":"Synthetic failure"}'})})
 const submit=page.getByRole('button',{name:'Neuen Termin bestätigen'});await submit.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(calls,1);release();await page.getByRole('alert').waitFor();assert.ok(await page.locator('input[value="12:45"]').isChecked());await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='alert');pass('duplicate submit blocked; server error visible, selection retained, focus on error')
 await page.unroute('**/api/coaching/reschedule');await page.route('**/api/coaching/reschedule',r=>r.fulfill({status:409,contentType:'application/json',body:'{"error":"Der Termin ist nicht mehr verfügbar."}'}));await submit.click();await page.getByRole('alert').filter({hasText:'anderen'}).waitFor();assert.equal(await page.locator('input[value="12:45"]').isChecked(),false);pass('409 slot conflict clears only time and reloads availability')
 await page.unroute('**/api/coaching/reschedule');await page.locator('input[value="12:45"]').focus();await page.keyboard.press('Space');await page.route('**/api/coaching/reschedule',r=>r.abort('failed'));await submit.click();await page.getByRole('button',{name:'Buchung neu laden'}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);pass('network ambiguity visibly requires reload, no blind duplicate submission')
 await page.unroute('**/api/coaching/reschedule');await page.keyboard.press('Escape')
 await open();await choose();await page.getByRole('button',{name:'Neuen Termin bestätigen'}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('status').filter({hasText:'erfolgreich verschoben'}).waitFor()
 const after=await check(service.from('bookings').select('scheduled_at,status,payment_status,price_cents,cancellation_policy_hours,buffer_minutes').eq('id',row.id).single());assert.equal(Date.parse(after.scheduled_at),Date.parse(berlinDateTimeToIso(date,'12:45')));assert.equal(after.status,'confirmed');assert.equal(after.payment_status,'not_required');assert.equal(after.price_cents,0);assert.equal(after.cancellation_policy_hours,24);assert.equal(after.buffer_minutes,15);assert.deepEqual(errors,[]);pass('real synthetic reschedule success with unchanged rules/payment and visible confirmation')
} finally {
 if(browser)await browser.close()
 if(bookings.length)await check(service.from('bookings').delete().in('id',bookings))
 if(users.length)await check(service.from('notifications').delete().in('user_id',users))
 if(profiles.length)await check(service.from('creator_profiles').delete().in('id',profiles).in('user_id',users))
 for(const id of users)await check(service.auth.admin.deleteUser(id))
 assert.equal((await check(service.from('profiles').select('id').in('id',users))).length,0);pass('owned synthetic data cleaned')
}
