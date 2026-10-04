// Owned synthetic fixtures only; no Stripe, email or calendar write requests.
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
const users=[],profiles=[],bookings=[],tag=`ardore-calendar-${randomUUID().slice(0,12)}`
const check=async p=>{const r=await p;if(r.error)throw new Error(`Synthetic operation failed (${r.error.code??'unknown'})`);return r.data}
const pass=s=>console.log(`PASS ${s}`)
async function actor(role){
 const email=`delivered+${tag}-${users.length}@resend.dev`,password=randomBytes(32).toString('base64url')
 const data=await check(service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role,full_name:'Synthetic calendar test'}}));users.push(data.user.id)
 const cookies=new Map(),client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}})
 await check(client.auth.signInWithPassword({email,password}))
 return{id:data.user.id,email,cookies,client,cookie:()=>[...cookies].map(([n,v])=>`${n}=${v}`).join('; ')}
}
let browser
try{
 const coach=await actor('creator'),other=await actor('creator'),buyer=await actor('buyer')
 for(const a of [coach,other]){const p=await check(service.from('creator_profiles').insert({user_id:a.id,display_name:'Synthetic calendar coach',slug:`${tag}-${profiles.length}`,category:'yoga',categories:['yoga']}).select('id').single());profiles.push(p.id)}
 const offer={is_enabled:true,price_cents:0,duration_minutes:60,description:'Synthetic calendar',buffer_minutes:15,min_notice_hours:0,max_horizon_days:60,cancellation_policy_hours:24}
 await check(service.rpc('replace_coach_availability',{p_creator_id:profiles[0],p_coach_user_id:coach.id,p_slots:Array.from({length:7},(_,day_of_week)=>({day_of_week,start_time:'09:00',end_time:'18:00'})),p_date_overrides:[],p_expected_revision:0,p_offer:offer}))
 for(const [i,status] of ['confirmed','pending_payment','cancelled','completed'].entries()){
 const row=await check(service.from('bookings').insert({creator_id:profiles[0],buyer_id:buyer.id,buyer_name:`Synthetic ${status}`,buyer_email:buyer.email,scheduled_at:berlinDateTimeToIso(date,`${10+i*2}:00`),duration_minutes:60,buffer_minutes:15,cancellation_policy_hours:24,stripe_livemode:false,price_cents:0,payment_status:status==='pending_payment'?'pending':'not_required',status,reservation_expires_at:status==='pending_payment'?new Date(Date.now()+3600000).toISOString():null}).select('id').single());bookings.push(row.id)
 }
 const before=await check(service.from('bookings').select('*').in('id',bookings).order('id'))
 const availabilityBefore=await check(service.rpc('get_coach_availability',{p_creator_id:profiles[0],p_coach_user_id:coach.id}))
 async function api(a,query=`date=${date}&view=week`){const r=await fetch(`${base}/api/coaching/calendar?${query}`,{headers:{Cookie:a?.cookie()??'', 'User-Agent':'Mozilla/5.0 ArdoreSyntheticCalendar'}});return {status:r.status,body:await r.json(),headers:r.headers}}
 const own=await api(coach);assert.equal(own.status,200);assert.equal(own.body.bookings.length,4);assert.equal(own.headers.get('cache-control'),'private, no-store');assert.ok(!JSON.stringify(own.body).includes(buyer.email))
 const foreign=await api(other,`date=${date}&view=week&creatorId=${profiles[0]}`);assert.equal(foreign.status,200);assert.equal(foreign.body.bookings.length,0)
 assert.equal((await api(buyer)).status,403);assert.equal((await api(null)).status,401)
 assert.equal((await check(buyer.client.from('bookings').select('id').in('id',bookings))).length,4)
 assert.equal((await check(other.client.from('bookings').select('id').in('id',bookings))).length,0)
 pass('production owner-only API, no customer email/private meeting URL exposure; foreign coach and unauthenticated access denied')
 const {chromium}=await import(process.env.ARDORE_PLAYWRIGHT_MODULE??'/Users/nam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
 browser=await chromium.launch({headless:true,executablePath:process.env.ARDORE_CHROME_EXECUTABLE??'/tmp/ardore-playwright-browsers/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
 const context=await browser.newContext();await context.addCookies([...coach.cookies].map(([name,value])=>({name,value,url:base})))
 const page=await context.newPage(),runtimeErrors=[];page.on('pageerror',e=>runtimeErrors.push(e.message))
 for(const width of [375,390,1280]){
 await page.setViewportSize({width,height:900});await page.goto(`${base}/creator/calendar`);await page.getByRole('button',{name:'Aktualisieren',exact:true}).waitFor();const consent=page.getByRole('button',{name:'Nur notwendige Cookies',exact:true});if(await consent.isVisible())await consent.click()
 await page.locator('input[type=date]:visible').fill(date)
 await page.getByRole('link',{name:/Synthetic confirmed/}).first().waitFor()
 const expected=width<768?'Tag':'Woche';assert.equal(await page.getByRole('button',{name:expected,exact:true}).getAttribute('aria-pressed'),'true')
 for(const label of ['Synthetic confirmed','Synthetic pending_payment','Synthetic cancelled','Synthetic completed'])assert.ok(await page.getByRole('link',{name:new RegExp(label)}).count())
 assert.ok(await page.getByText('Pufferzeit · gesperrt',{exact:true}).count());assert.ok(await page.getByText('Verfügbar',{exact:true}).count())
 assert.ok(await page.getByText('Kostenlos',{exact:true}).count());assert.ok(await page.getByText('Europe/Berlin',{exact:false}).count())
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow')
 await page.screenshot({path:`/tmp/ardore-calendar-${width}.png`,fullPage:true})
 await page.getByRole('button',{name:'Woche',exact:true}).click();await page.getByRole('button',{name:'Nächste Woche',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('Keine Termine',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Vorherige Woche',exact:true}).click();await page.getByRole('link',{name:/Synthetic confirmed/}).first().waitFor()
 await page.getByRole('button',{name:'Tag',exact:true}).click();await page.getByRole('button',{name:'Nächster Tag',exact:true}).click();await page.getByText('Keine Termine',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Vorheriger Tag',exact:true}).click();await page.getByRole('link',{name:/Synthetic confirmed/}).first().waitFor()
 await page.getByRole('link',{name:/Synthetic confirmed/}).first().focus();await page.keyboard.press('Enter');await page.waitForURL(`**/session/${bookings[0]}`);assert.ok(await page.getByText('Meeting-Link',{exact:false}).count())
 pass(`${width}px: default view, states, buffers, day/week navigation, keyboard details and no overflow`)
 }
 await page.goto(`${base}/creator/calendar`);await page.route('**/api/coaching/calendar?**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetischer Netzwerkfehler'})}));await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetischer Netzwerkfehler'}).waitFor();await page.unroute('**/api/coaching/calendar?**');await page.getByRole('button',{name:'Erneut versuchen',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetischer Netzwerkfehler'}).waitFor({state:'hidden'});await page.route('**/api/coaching/calendar?**',r=>r.abort('failed'));await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();await page.getByRole('alert').filter({hasText:'Bitte prüfe deine Verbindung'}).waitFor();await page.unroute('**/api/coaching/calendar?**');await page.getByRole('button',{name:'Erneut versuchen',exact:true}).click();await page.getByRole('alert').filter({hasText:'Bitte prüfe deine Verbindung'}).waitFor({state:'hidden'});await page.getByRole('button',{name:'Heute',exact:true}).click()
 assert.deepEqual(runtimeErrors,[]);pass('network error, retry, today and no browser runtime errors')
 assert.deepEqual(await check(service.from('bookings').select('*').in('id',bookings).order('id')),before)
 assert.deepEqual(await check(service.rpc('get_coach_availability',{p_creator_id:profiles[0],p_coach_user_id:coach.id})),availabilityBefore)
 pass('calendar reads left booking, payment and availability state unchanged')
}finally{
 if(browser)await browser.close()
 if(bookings.length)await check(service.from('bookings').delete().in('id',bookings))
 if(profiles.length)await check(service.from('creator_profiles').delete().in('id',profiles).in('user_id',users))
 for(const id of users)await check(service.auth.admin.deleteUser(id))
 assert.equal((await check(service.from('profiles').select('id').in('id',users))).length,0)
 pass('all owned synthetic bookings, availability, coaches and accounts cleaned')
}
