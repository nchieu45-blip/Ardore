// Only disposable users created by this run. Credentials are memory-only.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
if (!process.argv.includes('--run-production-synthetic')) { console.log('Skipped: requires --run-production-synthetic'); process.exit(0) }
process.loadEnvFile('.env.local')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'yboeyxqeileicecqpwke.supabase.co')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
const base=process.argv.find(x=>x.startsWith('--base='))?.slice(7)??'https://www.ardore-health.com'
assert.ok(['http://127.0.0.1:3010','https://www.ardore-health.com'].includes(base))
const mobile=process.argv.includes('--mobile-browser')
assert.ok(!mobile||base==='http://127.0.0.1:3010','Local-only browser bridge')
const tag=`ardore-onboarding-${randomUUID().slice(0,12)}`
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,opts)
const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts)
const users=[],profiles=[],bookings=[]
const check=async promise=>{const r=await promise;if(r.error)throw new Error(`Synthetic operation failed (${r.error.code??'unknown'})`);return r.data}
const pass=label=>console.log(`PASS ${label}`)
async function actor(role) {
 const email=`delivered+${tag}-${users.length}@resend.dev`,password=randomBytes(32).toString('base64url')
 const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role,full_name:'Synthetic onboarding'}})
 if(error||!data.user)throw new Error('Synthetic GoTrue creation failed');users.push(data.user.id)
 const cookies=new Map()
 const login=()=>createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}})
 const client=login();await check(client.auth.signInWithPassword({email,password}))
 return {id:data.user.id,email,client,cookies,cookie:()=>[...cookies].map(([n,v])=>`${n}=${v}`).join('; '),async relogin(){await client.auth.signOut();cookies.clear();await check(client.auth.signInWithPassword({email,password}))}}
}
async function api(actor,path,method='GET',body) {
 return fetch(`${base}${path}`,{method,redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 ArdoreSyntheticOnboarding',...(actor?{Cookie:actor.cookie()}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function advance(actor,step,data={}) {
 const r=await api(actor,'/api/creator/onboarding','POST',step===5?{step,publish:true}:{step,data})
 assert.equal(r.status,200,`Onboarding step ${step} must save`)
 return (await r.json()).profile
}
async function visible(client,profile){return check(client.from('creator_profiles').select('id,is_published').eq('id',profile.id))}
let server,timeout,success=false
const existing=await check(service.from('creator_profiles').select('*').order('id'))
try {
 const coach=await actor('creator'),buyer=await actor('buyer'),foreignCoach=await actor('creator')
 assert.equal((await api(null,'/api/creator/onboarding')).status,401)
 let profile=await advance(coach,1,{display_name:'Synthetic onboarding coach',bio:'Completed data must remain saved',categories:['yoga']});profiles.push(profile.id)
 assert.equal(profile.is_published,false);assert.equal(profile.onboarding_step,2)
 for(const client of [anon,buyer.client,foreignCoach.client])assert.deepEqual(await visible(client,profile),[])
 assert.equal((await api(buyer,`/creators/${profile.slug}`)).status,404)
 for(const path of [`/api/coaching/slots?creatorId=${profile.id}&date=2026-10-10`,`/api/coaching/available-days?creatorId=${profile.id}&year=2026&month=9`])assert.equal((await api(null,path)).status,404)
 assert.equal((await api(coach,'/api/creator/onboarding','POST',{step:5,publish:true})).status,409)
 for(const path of ['/coaches','/marketplace','/']) {const r=await api(coach,path);assert.equal(r.status,200);assert.ok(!(await r.text()).includes(profile.slug),'Owner draft is absent from public discovery too')}
 pass('step 1 remains private via RLS, profile URL and all public discovery, including owner browsing')
 await coach.relogin()
 let result=await api(coach,'/api/creator/onboarding');let state=await result.json()
 assert.equal(state.profile.onboarding_step,2);assert.equal(state.profile.bio,'Completed data must remain saved')
 // Late retry after browser reload never replaces valid completed profile fields.
 const duplicate=await advance(coach,1,{display_name:'Do not overwrite',categories:['fitness']});assert.equal(duplicate.display_name,profile.display_name)
 pass('logout/login and reload resume step 2 without resetting completed fields')
 for(const actor of [coach,buyer,foreignCoach])for(const update of [{is_published:true},{onboarding_step:5},{is_verified:true},{verified_at:new Date().toISOString()},{stripe_account_active:true}]) {
  const r=await actor.client.from('creator_profiles').update(update).eq('id',profile.id);assert.equal(r.error?.code,'42501')
 }
 for(const actor of [coach,buyer,foreignCoach])assert.equal((await actor.client.rpc('advance_coach_onboarding',{p_user_id:coach.id,p_expected_step:5,p_publish:true})).error?.code,'42501')
 assert.equal((await api(foreignCoach,'/api/creator/onboarding','POST',{step:5,publish:true,user_id:coach.id})).status,400)
 assert.equal((await api(coach,'/api/creator/onboarding','POST',{step:1,data:{display_name:'Coach',categories:['yoga'],is_verified:true}})).status,400)
 assert.equal((await api(foreignCoach,'/api/creator/onboarding','POST',{step:5,publish:true})).status,409)
 pass('18 direct authority/RPC probes deny publishing, progress spoofing, verification and Connect status writes')
 await advance(coach,2)
 const tierInput={name:'Synthetic own-priced tier',price_monthly:123}
 await Promise.all([advance(coach,3,tierInput),advance(coach,3,tierInput)])
 const tiers=await check(service.from('subscription_tiers').select('id,price_monthly').eq('creator_id',profile.id));assert.equal(tiers.length,1);assert.equal(tiers[0].price_monthly,123)
 const productInput={title:'Synthetic own-priced product',type:'pdf',price:49.75}
 await Promise.all([advance(coach,4,productInput),advance(coach,4,productInput)])
 const products=await check(service.from('products').select('id,price').eq('creator_id',profile.id));assert.equal(products.length,1);assert.equal(products[0].price,49.75)
 // A coach controls product publication, but it cannot publish the coach profile.
 await check(coach.client.from('products').update({is_published:true}).eq('id',products[0].id))
 assert.deepEqual(await check(anon.from('products').select('id').eq('id',products[0].id)),[])
 assert.deepEqual(await check(buyer.client.from('subscription_tiers').select('id').eq('id',tiers[0].id)),[])
 assert.equal((await api(coach,'/api/stripe/checkout','POST',{productId:products[0].id,withdrawalConsent:true})).status,409)
 assert.equal((await api(coach,'/api/stripe/subscription','POST',{tierId:tiers[0].id,creatorId:profile.id})).status,409)
 assert.equal((await api(coach,'/api/coaching/book','POST',{creatorId:profile.id,date:'2026-10-10',time:'12:00',name:'Synthetic coach',email:coach.email})).status,409)
 pass('optional offer creation is atomic under duplicate/concurrent requests; draft coach cannot sell, prices preserved')
 // Preserve private context for an existing buyer without making draft publicly discoverable.
 await check(service.from('coaching_offers').insert({creator_id:profile.id,is_enabled:true,price_cents:0,duration_minutes:60}))
 const booking=await check(service.from('bookings').insert({creator_id:profile.id,buyer_id:buyer.id,buyer_email:buyer.email,buyer_name:'Synthetic onboarding',scheduled_at:new Date(Date.now()+48*3600000).toISOString(),duration_minutes:60,price_cents:0,status:'confirmed',payment_status:'not_required',cancellation_policy_hours:24}).select('id').single());bookings.push(booking.id)
 const joined=await check(buyer.client.from('bookings').select('id,creator_profiles(display_name)').eq('id',booking.id));assert.equal(joined.length,1);assert.ok(joined[0].creator_profiles)
 assert.equal((await visible(buyer.client,profile)).length,1)
 assert.deepEqual(await visible(foreignCoach.client,profile),[])
 const publicWithRelationship=await api(buyer,'/coaches');assert.ok(!(await publicWithRelationship.text()).includes(profile.slug))
 pass('existing booking participants retain private coach context without recursive RLS or public draft discovery')
 await check(coach.client.from('creator_profiles').update({display_name:' '}).eq('id',profile.id))
 const refused=await api(coach,'/api/creator/onboarding','POST',{step:5,publish:true});assert.equal(refused.status,409);assert.ok((await refused.json()).missing.includes('Coach-Name (2–50 Zeichen)'))
 await check(coach.client.from('creator_profiles').update({display_name:profile.display_name}).eq('id',profile.id))
 profile=await advance(coach,5)
 await Promise.all([advance(coach,5),advance(coach,5)])
 assert.equal(profile.is_published,true);assert.equal((await visible(anon,profile)).length,1)
 assert.equal((await api(null,`/creators/${profile.slug}`)).status,200)
 assert.ok((await(await api(null,'/coaches')).text()).includes(profile.slug))
 assert.equal((await check(anon.from('products').select('id').eq('id',products[0].id))).length,1)
 assert.equal((await check(anon.from('subscription_tiers').select('id').eq('id',tiers[0].id))).length,1)
 assert.equal((await api(buyer,'/api/stripe/checkout','POST',{productId:products[0].id,withdrawalConsent:true})).status,409,'Unconnected coach cannot take paid checkout')
 assert.equal((await api(buyer,'/api/stripe/subscription','POST',{tierId:tiers[0].id,creatorId:profile.id})).status,409)
 pass('complete profile publishes without Stripe; fresh payout safeguards still block paid checkout')
 await check(coach.client.from('creator_profiles').update({display_name:'Edited synthetic coach',bio:'A normal saved edit',categories:['yoga','fitness']}).eq('id',profile.id))
 assert.equal((await visible(anon,profile))[0].is_published,true)
 for(const data of [{display_name:' '},{categories:[],category:null},{slug:'../invalid'}])assert.equal((await coach.client.from('creator_profiles').update(data).eq('id',profile.id)).error?.code,'23514')
 await check(coach.client.from('products').update({price:69.99}).eq('id',products[0].id))
 await check(coach.client.from('subscription_tiers').update({price_monthly:199}).eq('id',tiers[0].id))
 assert.equal((await check(service.from('products').select('price').eq('id',products[0].id).single())).price,69.99)
 assert.equal((await check(service.from('subscription_tiers').select('price_monthly').eq('id',tiers[0].id).single())).price_monthly,199)
 pass('normal edits stay published; invalid required edits fail deterministically; coach prices remain fully editable')
 if(mobile) {
  const mobileActor=await actor('creator'),mobileProfile=await advance(mobileActor,1,{display_name:'Synthetic mobile coach',categories:['yoga']});profiles.push(mobileProfile.id)
  let finish
  const completed=new Promise(resolve=>{finish=resolve})
  server=createServer(async(req,res)=>{
   try {
    if(req.url==='/mobile-start') {res.setHeader('Set-Cookie',[...mobileActor.cookies].map(([name,value])=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax`));res.writeHead(303,{Location:'/creator/onboarding'});res.end();return}
    if(req.url==='/mobile-finish') {res.setHeader('Set-Cookie',[...mobileActor.cookies].map(([name])=>`${name}=; Path=/; Max-Age=0`));res.writeHead(200,{'Content-Type':'text/plain'});res.end('Synthetic mobile review finished');finish();return}
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const headers={...req.headers,host:'127.0.0.1:3010'};delete headers['connection'];delete headers['content-length']
    const r=await fetch(`${base}${req.url}`,{method:req.method,headers,redirect:'manual',...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})})
    res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([n])=>!['content-encoding','content-length','transfer-encoding'].includes(n))));res.end(Buffer.from(await r.arrayBuffer()))
   }catch{res.writeHead(503);res.end('Local synthetic preview unavailable')}
  })
  await new Promise(resolve=>server.listen(3011,'127.0.0.1',resolve))
  timeout=setTimeout(finish,10*60*1000)
  console.log('MOBILE REVIEW READY http://127.0.0.1:3011/mobile-start')
  await completed
  const row=await check(service.from('creator_profiles').select('onboarding_step,is_published').eq('id',mobileProfile.id).single())
  assert.deepEqual(row,{onboarding_step:5,is_published:true})
  pass('real mobile wizard completed through browser at 375/390 px, including optional skips and publish')
 }
 success=true
}finally {
 if(timeout)clearTimeout(timeout);if(server)await new Promise(resolve=>server.close(resolve))
 if(bookings.length)await check(service.from('bookings').delete().in('id',bookings))
 if(profiles.length)await check(service.from('creator_profiles').delete().in('id',profiles).in('user_id',users))
 for(const id of users){const {error}=await service.auth.admin.deleteUser(id);if(error)throw new Error('Synthetic GoTrue cleanup failed')}
 assert.deepEqual(await check(service.from('creator_profiles').select('*').order('id')),existing,'Existing coaches must remain unchanged')
 assert.equal((await check(service.from('profiles').select('id').in('id',users))).length,0)
 pass('all owned synthetic users/profiles/offers/bookings removed; existing coach data unchanged')
}
assert.ok(success)
console.log('SYNTHETIC ONBOARDING SUCCESS')
