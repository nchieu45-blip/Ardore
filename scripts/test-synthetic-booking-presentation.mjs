// Display-only synthetic bookings: no Stripe calls, emails or financial actions.
import assert from 'node:assert/strict'
import { randomBytes,randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
if(!process.argv.includes('--run-production-synthetic')){console.log('Skipped: requires --run-production-synthetic');process.exit(0)}
process.loadEnvFile('.env.local')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'yboeyxqeileicecqpwke.supabase.co')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
const base=process.argv.find(x=>x.startsWith('--base='))?.slice(7)??'https://www.ardore-health.com'
assert.ok(['http://127.0.0.1:3010','https://www.ardore-health.com'].includes(base))
const browser=process.argv.includes('--browser')
const tag=`ardore-booking-ux-${randomUUID().slice(0,12)}`
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const users=[],profiles=[],bookings=[]
const check=async promise=>{const r=await promise;if(r.error)throw new Error(`Synthetic operation failed (${r.error.code??'unknown'})`);return r.data}
const pass=label=>console.log(`PASS ${label}`)
async function actor(role){
 const email=`delivered+${tag}-${users.length}@resend.dev`,password=randomBytes(32).toString('base64url')
 const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role,full_name:'Synthetic booking UX'}})
 if(error||!data.user)throw new Error('Synthetic GoTrue creation failed');users.push(data.user.id)
 const cookies=new Map()
 const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}})
 await check(client.auth.signInWithPassword({email,password}))
 return {id:data.user.id,email,client,cookies,cookie:()=>[...cookies].map(([n,v])=>`${n}=${v}`).join('; ')}
}
async function page(actor,path){const r=await fetch(`${base}${path}`,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 ArdoreSyntheticBookingUX',Cookie:actor.cookie()}});return {status:r.status,html:await r.text()}}
let server,timeout,success=false
const existing=await check(service.from('creator_profiles').select('id').order('id'))
try{
 const coach=await actor('creator'),buyer=await actor('buyer'),foreign=await actor('buyer')
 const profile=await check(service.from('creator_profiles').insert({user_id:coach.id,display_name:'Synthetic booking coach',slug:tag,category:'yoga',categories:['yoga']}).select('id').single());profiles.push(profile.id)
 await check(service.from('coaching_offers').insert({creator_id:profile.id,is_enabled:true,price_cents:0,duration_minutes:60,cancellation_policy_hours:24}))
 const year=new Date().getUTCFullYear()+1
 const cases=[
  {name:'Free future',status:'confirmed',payment_status:'not_required',price_cents:0},
  {name:'Paid future',status:'confirmed',payment_status:'paid',price_cents:9000},
  {name:'Pending future',status:'pending_payment',payment_status:'pending',price_cents:9000,reservation_expires_at:new Date(Date.now()+86400000).toISOString()},
  {name:'Failed future',status:'payment_failed',payment_status:'failed',price_cents:9000},
  {name:'Cancelled future',status:'cancelled',payment_status:'paid',price_cents:9000},
  {name:'Refunded future',status:'cancelled',payment_status:'refunded',price_cents:9000,amount_refunded_cents:9000},
  {name:'Completed past',status:'completed',payment_status:'not_required',price_cents:0,scheduled_at:`${year-2}-01-15T09:00:00Z`},
 ]
 for(const [i,input] of cases.entries()){
  const {name,...fields}=input
  const row=await check(service.from('bookings').insert({creator_id:profile.id,buyer_id:buyer.id,buyer_name:name,buyer_email:buyer.email,scheduled_at:`${year}-01-${15+i}T09:00:00Z`,duration_minutes:60,buffer_minutes:0,cancellation_policy_hours:24,stripe_livemode:false,notes:name,...fields}).select('id').single());bookings.push(row.id)
 }
 const snapshot=await check(service.from('bookings').select('*').in('id',bookings).order('id'))
 for(const [actor,path] of [[buyer,'/buyer/sessions'],[coach,'/creator/sessions']]){
  const r=await page(actor,path);assert.equal(r.status,200)
  for(const label of ['Kostenlos','Bezahlt','Zahlung ausstehend','Zahlung fehlgeschlagen','Storniert','Erstattet','Abgeschlossen','Europe/Berlin','Vergangen'])assert.ok(r.html.includes(label),label)
  assert.ok(!r.html.includes('Nicht bezahlt'))
  for(const i of [0,1,2,3,4,5])assert.ok(r.html.indexOf(`/session/${bookings[i]}`)<r.html.indexOf('>Vergangen<'),'Future booking must stay in future section')
  assert.ok(r.html.includes('10:00'),'Winter timestamp shown in Berlin time')
 }
 for(const actor of [buyer,coach])for(const id of [bookings[0],bookings[1],bookings[5]]){const r=await page(actor,`/session/${id}`);assert.equal(r.status,200);assert.ok(r.html.includes('Europe/Berlin'))}
 assert.equal((await page(foreign,`/session/${bookings[0]}`)).status,404)
 assert.deepEqual(await check(service.from('bookings').select('*').in('id',bookings).order('id')),snapshot)
 pass('customer/coach lists and details display all states, correct grouping and Berlin times; data unchanged; foreign account denied')
 if(browser){
  let finish;const completed=new Promise(resolve=>{finish=resolve})
  server=createServer(async(req,res)=>{
   try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Read-only UX preview');return}
    const actor=req.url==='/as-coach'?coach:buyer
    if(['/as-coach','/as-buyer'].includes(req.url)){
     res.setHeader('Set-Cookie',[...actor.cookies].map(([name,value])=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax`));res.writeHead(303,{Location:req.url==='/as-coach'?'/creator/sessions':'/buyer/sessions'});res.end();return
    }
    if(req.url==='/ux-finish'){res.setHeader('Set-Cookie',[...buyer.cookies].map(([name])=>`${name}=; Path=/; Max-Age=0`));res.writeHead(200,{'Content-Type':'text/plain'});res.end('Synthetic UX review finished');finish();return}
    const headers={...req.headers,host:new URL(base).host};delete headers.connection;delete headers['content-length']
    const r=await fetch(`${base}${req.url}`,{method:req.method,headers,redirect:'manual'})
    res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([n])=>!['content-encoding','content-length','transfer-encoding'].includes(n))));res.end(Buffer.from(await r.arrayBuffer()))
   }catch{res.writeHead(503);res.end('Synthetic preview unavailable')}
  })
  await new Promise(resolve=>server.listen(3011,'127.0.0.1',resolve));timeout=setTimeout(finish,10*60*1000)
  console.log('BROWSER REVIEW READY http://127.0.0.1:3011/as-buyer and /as-coach (read-only)')
  await completed
  assert.deepEqual(await check(service.from('bookings').select('*').in('id',bookings).order('id')),snapshot,'Browser review must not change bookings')
  pass('browser review finished without booking/payment mutations')
 }
 success=true
}finally{
 if(timeout)clearTimeout(timeout);if(server)await new Promise(resolve=>server.close(resolve))
 if(bookings.length)await check(service.from('bookings').delete().in('id',bookings))
 if(profiles.length)await check(service.from('creator_profiles').delete().in('id',profiles).in('user_id',users))
 for(const id of users)await check(service.auth.admin.deleteUser(id))
 assert.deepEqual(await check(service.from('creator_profiles').select('id').order('id')),existing)
 assert.equal((await check(service.from('profiles').select('id').in('id',users))).length,0)
 pass('all synthetic accounts/bookings removed; existing coaches untouched')
}
assert.ok(success)
console.log('SYNTHETIC BOOKING PRESENTATION SUCCESS')
