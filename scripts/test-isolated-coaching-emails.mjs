// Explicit loopback-only integration. Creates synthetic GoTrue users and bookings.
// Financial provider observations below are simulated; no Stripe calls are made.
// Optional real email is restricted to this run's official Resend test recipients.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
const require=createRequire(import.meta.url)
const flag=n=>process.argv[process.argv.indexOf(n)+1]
if(!process.argv.includes('--credentials')){console.log('Opt in with --credentials /absolute/local-credentials.json [--resend-env /absolute/test-only.env] [--output /absolute/artifacts]. Only loopback URLs and own Resend test sinks are accepted.');process.exit(0)}
const credentials=JSON.parse(fs.readFileSync(flag('--credentials'),'utf8'))
assert.equal(new URL(credentials.url).hostname,'127.0.0.1');assert.equal(new URL(credentials.url).protocol,'http:')
assert.match(credentials.database,/^ardore_lifecycle_test_[a-z0-9]+$/)
assert.equal(process.env.STRIPE_SECRET_KEY,undefined);assert.equal(process.env.DAILY_API_KEY,undefined)
const real=process.argv.includes('--resend-env')
if(real){process.loadEnvFile(flag('--resend-env'));assert.match(process.env.RESEND_API_KEY,/^re_/)}
process.env.NEXT_PUBLIC_APP_URL='https://www.ardore-health.com'
const out=process.argv.includes('--output')?flag('--output'):null;if(out)fs.mkdirSync(out,{recursive:true})
const service=createClient(credentials.url,credentials.service,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=()=>createClient(credentials.url,credentials.anon,{auth:{persistSession:false,autoRefreshToken:false}})
const tag='ardore-lifecycle-'+randomUUID().slice(0,8),actors={},callbacks=[],emails=[],requests=[],providerIds=new Set(),cache=new Map()
let actor=null,completionFailure=true,failedCompletionId=null,mailQueue=Promise.resolve()
const check=async q=>{const r=await q;assert.equal(r.error,null,JSON.stringify(r.error));return r.data}
for(const role of ['customer','coach','foreign']){
 const email=`delivered+${tag}-${role}@resend.dev`,password=randomBytes(24).toString('base64url')
 const result=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:role==='coach'?'Testcoach & Ruhe':'Testkunde <Yoga>',role:role==='coach'?'creator':'buyer'}})
 assert.equal(result.error,null);const client=anon();assert.equal((await client.auth.signInWithPassword({email,password})).error,null);actors[role]={id:result.data.user.id,email,client}
}
const coach=await check(service.from('creator_profiles').insert({user_id:actors.coach.id,display_name:'Testcoach & Ruhe',slug:tag,category:'yoga',categories:['yoga'],is_published:true,onboarding_step:5}).select('id').single())
await check(service.from('coaching_offers').insert({creator_id:coach.id,is_enabled:true,price_cents:0,duration_minutes:30,min_notice_hours:0,cancellation_policy_hours:24}))
const nativeRpc=service.rpc.bind(service)
service.rpc=async(name,args)=>{if(name==='complete_coaching_email'&&completionFailure){completionFailure=false;failedCompletionId=args.p_id;return {data:false,error:null}}return nativeRpc(name,args)}
const realEmail=real?load('src/lib/email/index.ts'):null
const send=async(payload,options)=>{
 const execute=async()=>{
  assert.ok([actors.customer.email,actors.coach.email].includes(payload.to));assert.ok(!payload.cc&&!payload.bcc);assert.match(options.idempotencyKey,/^coaching-update\//)
  assert.ok(requests.length<12,'Refuse unexpected extra emails');requests.push(structuredClone({payload,options}))
  const previous=emails.find(e=>e.key===options.idempotencyKey)
  let id=previous?.id??'mock-'+options.idempotencyKey
  if(real){await new Promise(r=>setTimeout(r,700));id=(await realEmail.sendEmail(payload,options)).id}
  if(previous){assert.equal(id,previous.id);assert.deepEqual(payload,previous.payload)}else{providerIds.add(id);emails.push({id,key:options.idempotencyKey,payload:structuredClone(payload)})}
  if(out)fs.writeFileSync(out+'/captures-running.json',JSON.stringify({tag,emails},null,2))
  return {id}
 };const result=mailQueue.then(execute,execute);mailQueue=result.then(()=>{},()=>{});return result
}
function load(relative){
 if(cache.has(relative))return cache.get(relative)
 const mod={exports:{}};cache.set(relative,mod.exports)
 const imports=name=>{
  if(name==='next/server')return {...require(name),after:job=>callbacks.push(job)}
  if(name==='@/lib/supabase/server')return {createServiceClient:async()=>service,createClient:async()=>actor?.client??anon()}
  if(name==='@/lib/email')return {FROM:'Ardore <noreply@ardore-health.com>',sendEmail:send}
  if(name==='@/lib/stripe/server')return {stripe:new Proxy({},{get(){throw Error('Financial operations forbidden in email integration')}})}
  if(name.startsWith('@/')||name.startsWith('.')){const p=name.startsWith('@/')?'src/'+name.slice(2):path.posix.join(path.posix.dirname(relative),name);return load(fs.existsSync(new URL('../'+p+'.ts',import.meta.url))?p+'.ts':p+'/index.ts')}
  return require(name)
 }
 new Function('require','module','exports','process','Buffer',ts.transpileModule(fs.readFileSync(new URL('../'+relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText)(imports,mod,mod.exports,process,Buffer)
 cache.set(relative,mod.exports);return mod.exports
}
const individual=load('src/app/api/coaching/cancel/route.ts'),group=load('src/app/api/video-classes/bookings/[id]/cancel/route.ts'),worker=load('src/lib/coaching-emails.ts')
const request=(url,body)=>new Request('https://www.ardore-health.com'+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.ardore-health.com'},body:JSON.stringify(body)})
const flush=async()=>{while(callbacks.length)await callbacks.shift()();await mailQueue}
const createIndividual=async(price=0)=>check(service.from('bookings').insert({creator_id:coach.id,buyer_id:actors.customer.id,buyer_email:actors.customer.email,buyer_name:'Testkunde <Yoga>',booking_request_key:randomUUID(),scheduled_at:new Date(Date.now()+72*3600000).toISOString(),duration_minutes:30,price_cents:price,status:'confirmed',payment_status:price?'paid':'not_required',amount_paid_cents:price,stripe_payment_intent_id:price?'pi_local_fixture_'+randomUUID():null,stripe_livemode:price?false:null,cancellation_policy_hours:24}).select('*').single())
const b=await createIndividual();actor=actors.customer
assert.equal((await individual.POST(request('/api/coaching/cancel',{bookingId:b.id}))).status,200);await flush()
assert.equal(emails.length,2);assert.ok(failedCompletionId)
const retry=await worker.runCoachingEmails(b.id);assert.equal(retry.sent,1);assert.equal(emails.length,2);assert.equal(requests.length,3,'Provider retry reuses the accepted message ID')
assert.equal((await individual.POST(request('/api/coaching/cancel',{bookingId:b.id}))).status,200);await flush();assert.equal(emails.length,2)
const course=await check(service.from('video_classes').insert({creator_id:coach.id,title:'Gruppencoaching Yoga & Ruhe',schedule_type:'once',starts_at:new Date(Date.now()+80*3600000).toISOString(),duration_minutes:45,max_participants:9,price_cents:0,active:true}).select('*').single())
const claim=await check(service.rpc('reserve_group_class_booking',{p_class_id:course.id,p_buyer_id:actors.customer.id,p_request_id:randomUUID(),p_occurrence_start:course.starts_at,p_livemode:null,p_account_id:null,p_expected_price_cents:0}))
const groupId=claim.reservation.booking_id;actor=actors.coach
for(let i=0;i<2;i++){assert.equal((await group.POST(request('/api/video-classes/bookings/'+groupId+'/cancel',{}),{params:Promise.resolve({id:groupId})})).status,200);await flush()}
assert.equal(emails.length,4)
for(const invalid of [null,actors.foreign]){actor=invalid;const status=invalid?403:401;assert.equal((await individual.POST(request('/api/coaching/cancel',{bookingId:b.id}))).status,status);assert.equal((await group.POST(request('/api/video-classes/bookings/'+groupId+'/cancel',{}),{params:Promise.resolve({id:groupId})})).status,status)}
// Reconciliation database boundary: emulate a provider-confirmed amount only in
// this disposable DB. Pending/failed observations must not queue refund receipts.
const paid=await createIndividual(500)
await check(service.from('bookings').update({refund_status:'pending'}).eq('id',paid.id))
assert.equal((await check(service.from('coaching_email_deliveries').select('*').eq('booking_id',paid.id))).length,0)
await check(service.rpc('apply_coaching_refund_state',{p_booking_id:paid.id,p_state:null,p_payment_status:'refunded',p_amount_refunded_cents:500,p_amount_paid_cents:500,p_provider_checked_at:new Date().toISOString()}))
// A group refund projection can arrive without a preceding cancellation request.
const gb=await check(service.from('video_class_bookings').insert({video_class_id:course.id,user_id:actors.customer.id,price_paid_cents:700,status:'confirmed',occurrence_start:course.starts_at,duration_minutes:45,class_title:course.title,payment_status:'paid',stripe_livemode:false}).select('*').single())
await check(service.from('video_class_bookings').update({refund_status:'failed'}).eq('id',gb.id))
assert.equal((await check(service.from('coaching_email_deliveries').select('*').eq('booking_id',gb.id))).length,0)
await check(service.from('video_class_bookings').update({payment_status:'refunded',refund_status:'succeeded',amount_refunded_cents:700}).eq('id',gb.id))
const outcomes=await Promise.all([worker.runCoachingEmails(),worker.runCoachingEmails()]);await mailQueue
assert.equal(outcomes.reduce((n,r)=>n+r.sent,0),4);assert.equal(emails.length,8);assert.equal(providerIds.size,8)
await check(service.from('bookings').update({amount_refunded_cents:500,payment_status:'refunded'}).eq('id',paid.id))
await check(service.from('video_class_bookings').update({amount_refunded_cents:700,payment_status:'refunded'}).eq('id',gb.id))
assert.equal((await worker.runCoachingEmails()).sent,0);assert.equal(emails.length,8)
const rows=await check(service.from('coaching_email_deliveries').select('*').in('booking_id',[b.id,groupId,paid.id,gb.id]));assert.equal(rows.length,8);assert.ok(rows.every(r=>r.state==='sent'&&r.payload===null&&Object.keys(r.details).length===0))
for(const email of emails){assert.ok(email.payload.html&&email.payload.text);assert.doesNotMatch(email.payload.html,/daily\.co|meeting-token|localhost|undefined|<Yoga>/);if(out){const row=rows.find(r=>email.key.endsWith(r.id));const name=[row.booking_kind,row.event_kind,row.recipient_role].join('-');fs.writeFileSync(out+'/'+name+'.html',email.payload.html);fs.writeFileSync(out+'/'+name+'.txt',email.payload.text)}}
for(const client of [anon(),actors.customer.client,actors.coach.client]){const denied=await client.from('coaching_email_deliveries').select('*');assert.ok(denied.error);const deniedRpc=await client.rpc('claim_coaching_email',{p_id:rows[0].id,p_payload:{},p_token:randomUUID()});assert.ok(deniedRpc.error)}
// Real SQL lease/token/window checks, without sending these extra fixtures.
const lease=await check(service.from('coaching_email_deliveries').insert({booking_kind:'individual',booking_id:randomUUID(),event_kind:'cancellation',event_version:0,recipient_id:actors.customer.id,recipient_role:'customer',details:{}}).select('*').single())
const message={from:'test',to:'delivered+lease@resend.dev',subject:'lease',html:'html',text:'text'},tokens=[randomUUID(),randomUUID()]
const contenders=await Promise.all(tokens.map(token=>nativeRpc('claim_coaching_email',{p_id:lease.id,p_payload:message,p_token:token})))
assert.deepEqual(contenders.map(r=>r.data.state).sort(),['busy','claimed'])
const winner=tokens[contenders.findIndex(r=>r.data.state==='claimed')]
assert.equal((await nativeRpc('complete_coaching_email',{p_id:lease.id,p_token:randomUUID()})).data,false)
await check(service.from('coaching_email_deliveries').update({lease_until:new Date(Date.now()-1000).toISOString()}).eq('id',lease.id))
const replacement=randomUUID(),reclaim=await nativeRpc('claim_coaching_email',{p_id:lease.id,p_payload:{...message,subject:'changed'},p_token:replacement})
assert.deepEqual(reclaim.data.payload,message)
assert.equal((await nativeRpc('complete_coaching_email',{p_id:lease.id,p_token:winner})).data,false)
await check(service.from('coaching_email_deliveries').update({lease_until:new Date(Date.now()-1000).toISOString(),first_attempt_at:new Date(Date.now()-24*3600000).toISOString()}).eq('id',lease.id))
assert.equal((await nativeRpc('claim_coaching_email',{p_id:lease.id,p_payload:message,p_token:randomUUID()})).data.state,'held')
await check(service.from('coaching_email_deliveries').delete().eq('id',lease.id))
// Distinct partial refunds generate only the increment; repeated observations
// cannot queue duplicate cumulative versions. These test rows are not mailed.
const partial=await createIndividual(1000)
for(const amount of [100,100,300,300])await check(service.rpc('apply_coaching_refund_state',{p_booking_id:partial.id,p_state:null,p_payment_status:'partially_refunded',p_amount_refunded_cents:amount,p_amount_paid_cents:1000,p_provider_checked_at:new Date().toISOString()}))
const increments=await check(service.from('coaching_email_deliveries').select('*').eq('booking_id',partial.id).order('event_version'))
assert.equal(increments.length,4);assert.deepEqual(increments.map(r=>r.details.amount_cents),[100,100,200,200])
await check(service.from('coaching_email_deliveries').delete().eq('booking_id',partial.id))
const report={date:new Date().toISOString(),tag,scope:'Real isolated GoTrue, PostgreSQL triggers/RPCs, actual cancellation routes; financial observations simulated locally; '+(real?'real Resend test sinks':'mock email transport'),uniqueMessages:8,providerRequests:requests.length,duplicates:0,checks:['Both recipient roles for cancellation/refund and individual/group','Repeated cancellation and provider observations','Concurrent workers','Provider acceptance then database completion failure: identical payload/key/message ID','Pending/failed observations do not confirm refunds','Anonymous/foreign cancellation refused','Anonymous/authenticated outbox access and RPC execution denied','Sent payload and personal snapshot cleared','Real SQL concurrent claims, expired lease, stale token, frozen payload and 23h hold','Distinct partial refund increments; repeated observations deduplicated'],emails:emails.map(e=>({id:e.id,to:e.payload.to,subject:e.payload.subject,lastEvent:real?'pending_dashboard_verification':'mocked'})),productionDataChanged:false}
if(out)fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
