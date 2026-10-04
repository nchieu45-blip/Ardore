// Opt-in only. GoTrue users and every row written belong to this disposable run.
// Credentials/passwords/cookies remain in memory, and no email/payment is sent.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
if(!process.argv.includes('--run-production-synthetic')){console.log('Skipped: requires --run-production-synthetic');process.exit(0)}
process.loadEnvFile('.env.local')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'yboeyxqeileicecqpwke.supabase.co')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
const base=process.argv.find(x=>x.startsWith('--base='))?.slice(7)??'https://www.ardore-health.com'
assert.ok(['http://127.0.0.1:3010','https://www.ardore-health.com'].includes(base))
const tag=`ardore-availability-${randomUUID().slice(0,12)}`
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,opts)
const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts)
const users=[],profiles=[],bookings=[]
const check=async promise=>{const r=await promise;if(r.error)throw new Error(`Synthetic operation failed (${r.error.code??'unknown'})`);return r.data}
const pass=label=>console.log(`PASS ${label}`)
async function actor(role){
 const email=`delivered+${tag}-${users.length}@resend.dev`,password=randomBytes(32).toString('base64url')
 const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role,full_name:'Synthetic availability'}})
 if(error||!data.user)throw new Error('Synthetic GoTrue creation failed');users.push(data.user.id)
 const cookies=new Map()
 const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}})
 await check(client.auth.signInWithPassword({email,password}))
 return {id:data.user.id,email,client,cookie:()=>[...cookies].map(([n,v])=>`${n}=${v}`).join('; ')}
}
async function api(actor,method='GET',body){
 const response=await fetch(`${base}/api/coaching/availability`,{method,redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 ArdoreSyntheticAvailability',...(actor?{Cookie:actor.cookie()}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={}}
 return {status:response.status,data}
}
const weekly=(start='09:00',end='17:00',day=1)=>({day_of_week:day,start_time:start,end_time:end})
const offer={is_enabled:true,price_cents:12345,duration_minutes:60,description:'Synthetic availability settings',buffer_minutes:30,min_notice_hours:0,max_horizon_days:60,cancellation_policy_hours:24}
const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10)
const dow=new Date(`${date}T12:00:00Z`).getUTCDay()
// Derive Berlin offset for the test date (works across seasonal timezone changes).
const berlinIso=(hour)=>{
 for(let offset=-180;offset<=180;offset+=15){const candidate=new Date(`${date}T${String(hour).padStart(2,'0')}:00:00Z`).getTime()-offset*60000;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(candidate));const part=t=>parts.find(p=>p.type===t)?.value;if(`${part('year')}-${part('month')}-${part('day')}`===date&&part('hour')===String(hour).padStart(2,'0')&&part('minute')==='00')return new Date(candidate).toISOString()}
 throw new Error('Synthetic Berlin conversion failed')
}
const snapshot=async id=>({
 slots:await check(service.from('availability_slots').select('*').eq('creator_id',id).order('id')),
 overrides:await check(service.from('date_overrides').select('*').eq('creator_id',id).order('id')),
 state:await check(service.from('coaching_availability_state').select('*').eq('creator_id',id)),
 offers:await check(service.from('coaching_offers').select('*').eq('creator_id',id)),
})
const existing={}
for(const table of ['availability_slots','date_overrides','coaching_offers','coaching_availability_state'])existing[table]=await check(service.from(table).select('*').order(table==='coaching_availability_state'?'creator_id':'id'))
let success=false
try{
 const coach=await actor('creator'),buyer=await actor('buyer'),foreign=await actor('creator')
 const profile=await check(service.from('creator_profiles').insert({user_id:coach.id,display_name:'Synthetic availability coach',slug:tag,category:'yoga',categories:['yoga']}).select('id').single());profiles.push(profile.id)
 assert.equal((await api(null)).status,401)
 assert.equal((await api(coach)).data.revision,0)
 async function save(slots,dateOverrides=[],extra={}){
  const current=await api(coach);assert.equal(current.status,200)
  const input={expectedRevision:current.data.revision,slots,dateOverrides,...extra}
  const result=await api(coach,'POST',input)
  assert.equal(result.status,200,'Synthetic update must succeed')
  assert.equal(result.data.revision,input.expectedRevision+1)
  assert.deepEqual((await api(coach)).data,result.data.ok?Object.fromEntries(Object.entries(result.data).filter(([key])=>key!=='ok')):result.data)
  return result.data
 }
 await save([weekly()],[],{offer})
 assert.equal((await api(coach)).data.offer.price_cents,12345)
 await save([weekly(),weekly('09:00','17:00',2)])
 await save([weekly('08:00','12:00'),weekly('13:00','18:00')],[{date,type:'unavailable',start_time:'10:00',end_time:'11:00'}])
 await save([weekly('09:00','17:00')])
 await save([],[])
 await save([weekly(),weekly('09:00','17:00',3)])
 pass('normal/add/remove/multiple replacement and exact reload; coach price unchanged')
 let before=await snapshot(profile.id)
 for(const input of [
  {slots:[weekly('17:00','09:00')],dateOverrides:[]},
  {slots:[weekly(),weekly('10:00','11:00')],dateOverrides:[]},
  {slots:[weekly()],dateOverrides:[{date:'2026-02-30',type:'unavailable',start_time:null,end_time:null}]},
  {slots:[weekly()],dateOverrides:[{date,type:'available',start_time:null,end_time:null}]},
  {slots:[weekly()],dateOverrides:[{date,type:'unavailable',start_time:null,end_time:null},{date,type:'available',start_time:'18:00',end_time:'19:00'}]},
 ]){
  const state=(await api(coach)).data;assert.equal((await api(coach,'POST',{...input,expectedRevision:state.revision})).status,400)
  assert.deepEqual(await snapshot(profile.id),before)
 }
 // Bypass HTTP validation with service-only RPC to prove database validation itself is safe.
 const revision=(await api(coach)).data.revision
 for(const slots of [[weekly('17:00','09:00')],[weekly(),weekly()]]){
  const r=await service.rpc('replace_coach_availability',{p_creator_id:profile.id,p_coach_user_id:coach.id,p_slots:slots,p_date_overrides:[],p_expected_revision:revision,p_offer:null});assert.equal(r.error?.code,'22023');assert.deepEqual(await snapshot(profile.id),before)
 }
 pass('invalid/overlapping/date exceptions rejected by HTTP and database before destructive writes')
 // Integer cast fails AFTER availability deletes/inserts in the function; the entire
 // transaction must restore row IDs, created_at, offer and revision byte-for-byte.
 const failed=await service.rpc('replace_coach_availability',{p_creator_id:profile.id,p_coach_user_id:coach.id,p_slots:[weekly('07:00','19:00')],p_date_overrides:[{date,type:'unavailable',start_time:'12:00',end_time:'13:00'}],p_expected_revision:revision,p_offer:{...offer,price_cents:2147483648}})
 assert.equal(failed.error?.code,'22003');assert.deepEqual(await snapshot(profile.id),before)
 assert.equal((await api(coach)).data.revision,revision)
 pass('real PostgreSQL mid-operation failure rolls back exact IDs/timestamps/offer/revision; reload unchanged')
 const alternatives=[[weekly('07:00','18:00')],[weekly('08:00','19:00'),weekly('09:00','15:00',3)]]
 const results=await Promise.all(alternatives.map(slots=>api(coach,'POST',{expectedRevision:revision,slots,dateOverrides:[]})))
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
 const winner=results.findIndex(r=>r.status===200),state=(await api(coach)).data
 assert.deepEqual(state.slots,alternatives[winner]);assert.equal(state.revision,revision+1)
 pass('concurrent updates: exactly one commit, stale request refused, no mixed rows')
 for(const client of [anon,coach.client,buyer.client,foreign.client]){
  for(const table of ['availability_slots','date_overrides']){
   for(const operation of ['insert','update','delete']){
    let request
    const row=table==='availability_slots'?{creator_id:profile.id,...weekly()}:{creator_id:profile.id,date,type:'unavailable',start_time:null,end_time:null}
    if(operation==='insert')request=client.from(table).insert(row)
    else if(operation==='update')request=client.from(table).update(table==='availability_slots'?{start_time:'07:00'}:{type:'available'}).eq('creator_id',profile.id)
    else request=client.from(table).delete().eq('creator_id',profile.id)
    assert.equal((await request).error?.code,'42501')
   }
  }
  for(const name of ['get_coach_availability','replace_coach_availability']){
   const args={p_creator_id:profile.id,p_coach_user_id:coach.id,...(name.startsWith('replace')?{p_slots:[],p_date_overrides:[],p_expected_revision:state.revision,p_offer:null}:{})}
   assert.equal((await client.rpc(name,args)).error?.code,'42501')
  }
 }
 assert.equal((await service.rpc('replace_coach_availability',{p_creator_id:profile.id,p_coach_user_id:foreign.id,p_slots:[],p_date_overrides:[],p_expected_revision:state.revision,p_offer:null})).error?.code,'42501')
 assert.equal((await api(foreign,'POST',{creator_id:profile.id,expectedRevision:state.revision,slots:[],dateOverrides:[]})).status,404)
 pass('owner/foreign/buyer/anonymous raw writes and RPC bypass denied; service RPC checks owner')
 await save([weekly('09:00','17:00',dow)])
 const bookingInput={creator_id:profile.id,buyer_id:buyer.id,buyer_email:buyer.email,buyer_name:'Synthetic availability',scheduled_at:berlinIso(10),duration_minutes:60,buffer_minutes:30,price_cents:0,status:'confirmed',payment_status:'not_required',cancellation_policy_hours:24}
 const booking=await check(service.from('bookings').insert(bookingInput).select('*').single());bookings.push(booking.id)
 before=await snapshot(profile.id)
 for(const input of [{slots:[],dateOverrides:[]},{slots:[weekly('12:00','17:00',dow)],dateOverrides:[]},{slots:[weekly('09:00','17:00',dow)],dateOverrides:[{date,type:'unavailable',start_time:'10:30',end_time:'11:30'}]}]){
  const result=await api(coach,'POST',{...input,expectedRevision:(await api(coach)).data.revision});assert.equal(result.status,409)
  assert.deepEqual(await snapshot(profile.id),before);assert.deepEqual(await check(service.from('bookings').select('*').eq('id',booking.id).single()),booking)
 }
 await save([weekly('08:00','18:00',dow)])
 const badBooking=await service.from('bookings').insert({...bookingInput,scheduled_at:berlinIso(6)});assert.equal(badBooking.error?.code,'23P01')
 const overlapBooking=await service.from('bookings').insert({...bookingInput,scheduled_at:berlinIso(11)});assert.equal(overlapBooking.error?.code,'23P01','Original booking buffer blocks overlapping slot')
 pass('protected booking/window conflicts refused, existing booking untouched, new stale slot and booked buffer denied')
 // Race booking INSERT against narrowing availability. Exactly one wins and the
 // loser sees committed state after the same per-coach advisory lock.
 const raceState=(await api(coach)).data
 const race=await Promise.all([
  service.from('bookings').insert({...bookingInput,scheduled_at:berlinIso(16)}).select('id').single(),
  api(coach,'POST',{expectedRevision:raceState.revision,slots:[weekly('08:00','15:00',dow)],dateOverrides:[]}),
 ])
 if(!race[0].error){bookings.push(race[0].data.id);assert.equal(race[1].status,409)}
 else {assert.equal(race[0].error.code,'23P01');assert.equal(race[1].status,200)}
 pass('concurrent booking creation vs availability change serializes safely')
 success=true
}finally{
 for(const id of bookings)await check(service.from('bookings').delete().eq('id',id))
 for(const id of profiles)await check(service.from('creator_profiles').delete().eq('id',id))
 for(const id of users)await check(service.auth.admin.deleteUser(id))
 for(const table of Object.keys(existing))assert.deepEqual(await check(service.from(table).select('*').order(table==='coaching_availability_state'?'creator_id':'id')),existing[table],'Existing production configuration unchanged')
 const {data,error}=await service.auth.admin.listUsers({page:1,perPage:1000});assert.equal(error,null);assert.ok(!data.users.some(u=>u.email?.includes(tag)))
 pass('all synthetic bookings/profiles/auth users cleaned; existing production availability/offers unchanged')
}
assert.ok(success)
console.log(`PASS atomic availability test suite (${base.includes('127.')?'local production build':'deployed production app'})`)
