// Explicit isolated GoTrue/PostgreSQL integration. No Stripe/Daily operations.
// Optional real email sends only to this run's official Resend test sinks.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
import ts from 'typescript'
import {createClient} from '@supabase/supabase-js'
const require=createRequire(import.meta.url),repo=path.resolve(new URL('..',import.meta.url).pathname)
const arg=name=>process.argv[process.argv.indexOf(name)+1]
if(!process.argv.includes('--credentials')){console.log('Opt in with --credentials /absolute/local-credentials.json [--resend-env /absolute/private.env] [--output /absolute/artifacts].');process.exit(0)}
const c=JSON.parse(fs.readFileSync(arg('--credentials'),'utf8'));assert.equal(c.url,'http://127.0.0.1:55131');assert.match(c.database,/^ardore_reschedule_test_[a-z0-9]+$/)
assert.equal(process.env.STRIPE_SECRET_KEY,undefined);assert.equal(process.env.DAILY_API_KEY,undefined)
process.env.NEXT_PUBLIC_APP_URL='https://www.ardore-health.com'
const real=process.argv.includes('--resend-env');if(real)process.loadEnvFile(arg('--resend-env'))
const output=process.argv.includes('--output')?arg('--output'):null;if(output)fs.mkdirSync(output,{recursive:true})
const service=createClient(c.url,c.service,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=()=>createClient(c.url,c.anon,{auth:{persistSession:false,autoRefreshToken:false}})
const tag='ardore-move-'+randomUUID().slice(0,8),actors={},callbacks=[],emails=[],attempts=[],cache=new Map();let actor=null,failCustomer=true,failGroupCustomer=true,failComplete=true,queue=Promise.resolve()
const check=async q=>{const r=await q;assert.equal(r.error,null,JSON.stringify(r.error));return r.data}
for(const role of ['coach','buyer','buyer2','buyer3','foreign']){const email=`delivered+${tag}-${role}@resend.dev`,password=randomBytes(24).toString('base64url');const u=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:role==='coach'?'creator':'buyer',full_name:role==='coach'?'Move-Coach & Ruhe':'Move-Kunde <Yoga>'}});assert.equal(u.error,null);const client=anon();assert.equal((await client.auth.signInWithPassword({email,password})).error,null);actors[role]={id:u.data.user.id,email,client}}
const coach=await check(service.from('creator_profiles').insert({user_id:actors.coach.id,display_name:'Move-Coach & Ruhe',slug:tag,category:'yoga',categories:['yoga'],is_published:true,onboarding_step:5}).select('id').single())
await check(service.from('coaching_offers').insert({creator_id:coach.id,is_enabled:true,price_cents:0,duration_minutes:30,buffer_minutes:0,min_notice_hours:0,max_horizon_days:60,cancellation_policy_hours:24}))
await check(service.from('availability_slots').insert(Array.from({length:7},(_,i)=>({creator_id:coach.id,day_of_week:i,start_time:'08:00',end_time:'20:00'}))))
const nativeRpc=service.rpc.bind(service)
service.rpc=async(name,args)=>{if(name==='complete_coaching_email'&&failComplete){failComplete=false;return {data:false,error:null}}return nativeRpc(name,args)}
const realEmail=real?load('src/lib/email/index.ts'):null
async function send(payload,options){const execute=async()=>{
 assert.ok(Object.values(actors).filter(a=>a!==actors.foreign).some(a=>a.email===payload.to));assert.ok(!payload.cc&&!payload.bcc);assert.match(options.idempotencyKey,/^coaching-update\//)
 attempts.push(structuredClone({payload,options}));assert.ok(attempts.length<20,'Refuse excessive sends')
 if(failGroupCustomer&&payload.subject.includes('Gruppen-Move')&&payload.to===actors.buyer2.email){failGroupCustomer=false;throw Error('Simulated group provider rejection before send')}
 if(failCustomer&&payload.to===actors.buyer.email){failCustomer=false;throw Error('Simulated provider rejection before send')}
 const previous=emails.find(e=>e.key===options.idempotencyKey);let id=previous?.id??'mock-'+options.idempotencyKey
 if(real){await new Promise(r=>setTimeout(r,700));id=(await realEmail.sendEmail(payload,options)).id}
 if(previous){assert.equal(id,previous.id);assert.deepEqual(payload,previous.payload)}else emails.push({id,key:options.idempotencyKey,payload:structuredClone(payload)})
 if(output)fs.writeFileSync(output+'/captures.json',JSON.stringify({tag,emails},null,2));return {id}
 };const result=queue.then(execute,execute);queue=result.then(()=>{},()=>{});return result}
function load(relative){if(cache.has(relative))return cache.get(relative);const mod={exports:{}};cache.set(relative,mod.exports);const imports=name=>{
 if(name==='next/server')return {...require(name),after:job=>callbacks.push(job)}
 if(name==='@/lib/supabase/server')return {createServiceClient:async()=>service,createClient:async()=>actor?.client??anon()}
 if(name==='@/lib/email')return {FROM:'Ardore <noreply@ardore-health.com>',sendEmail:send}
 if(name==='@/lib/stripe/server')return {stripe:new Proxy({},{get(){throw Error('Financial operation forbidden')}})}
 if(name.startsWith('@/')||name.startsWith('.')){const p=name.startsWith('@/')?'src/'+name.slice(2):path.posix.join(path.posix.dirname(relative),name);return load(fs.existsSync(repo+'/'+p+'.ts')?p+'.ts':p+'/index.ts')}
 return require(name)
 };new Function('require','module','exports','process','Buffer',ts.transpileModule(fs.readFileSync(repo+'/'+relative,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText)(imports,mod,mod.exports,process,Buffer);cache.set(relative,mod.exports);return mod.exports}
const slots=load('src/lib/coaching-slots.ts'),worker=load('src/lib/coaching-emails.ts'),individual=load('src/app/api/coaching/reschedule/route.ts'),group=load('src/app/api/video-classes/[id]/reschedule/route.ts')
const date=slots.addDaysToDateString(slots.currentBerlinDateString(),3),nextDate=slots.addDaysToDateString(date,1),iso=t=>slots.berlinDateTimeToIso(date,t)
const req=(url,body)=>new Request('https://www.ardore-health.com'+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.ardore-health.com'},body:JSON.stringify(body)})
const flush=async()=>{while(callbacks.length)await callbacks.shift()();await queue}
const b=await check(service.from('bookings').insert({creator_id:coach.id,buyer_id:actors.buyer.id,buyer_email:actors.buyer.email,buyer_name:'Move-Kunde <Yoga>',booking_request_key:randomUUID(),scheduled_at:iso('10:00'),duration_minutes:30,price_cents:0,status:'confirmed',payment_status:'not_required',cancellation_policy_hours:24}).select('*').single())
actor=actors.buyer;const first={bookingId:b.id,newDate:date,newTime:'12:00'};assert.equal((await individual.POST(req('/api/coaching/reschedule',first))).status,200);await flush()
assert.equal(failCustomer,false);assert.equal(failComplete,false);assert.equal(emails.length,1,'Other recipient was attempted despite customer failure')
assert.equal((await worker.runCoachingEmails(b.id)).sent,2);assert.equal(emails.length,2,'Accepted provider retry must use the same ID')
for(let i=0;i<2;i++){assert.equal((await individual.POST(req('/api/coaching/reschedule',first))).status,200);await flush()}assert.equal(emails.length,2)
actor=actors.coach;assert.equal((await individual.POST(req('/api/coaching/reschedule',{...first,newTime:'13:00'}))).status,200);await flush();assert.equal(emails.length,4)
const revisions=await check(service.from('coaching_email_deliveries').select('event_version,recipient_role').eq('booking_id',b.id));assert.equal(revisions.length,4);assert.deepEqual([...new Set(revisions.map(r=>r.event_version))].sort(),[1,2])
for(const who of [null,actors.foreign]){actor=who;assert.equal((await individual.POST(req('/api/coaching/reschedule',{...first,newTime:'14:00'}))).status,who?404:401)}
const course=await check(service.from('video_classes').insert({creator_id:coach.id,title:'Gruppen-Move & Ruhe',schedule_type:'once',starts_at:iso('15:00'),duration_minutes:45,max_participants:9,price_cents:0,active:true}).select('*').single())
const reservations=[]
for(const role of ['buyer','buyer2','buyer3']){
 const paid=role==='buyer3'
 if(paid)await check(service.from('video_classes').update({price_cents:700}).eq('id',course.id))
 const claim=await check(service.rpc('reserve_group_class_booking',{p_class_id:course.id,p_buyer_id:actors[role].id,p_request_id:randomUUID(),p_occurrence_start:course.starts_at,p_livemode:paid?true:null,p_account_id:paid?'acct_LocalFixture':null,p_expected_price_cents:paid?700:0}))
 if(paid){
  // Trusted fulfillment fixture only: no money or provider object is created.
  const r=claim.reservation
  await check(service.from('payment_orders').insert({id:r.id,kind:'group',buyer_id:r.buyer_id,creator_id:coach.id,account_id:'acct_LocalFixture',gross_cents:700,platform_fee_cents:70,coach_net_cents:630,currency:'eur',stripe_livemode:true,state:'fulfilled',reference:{reservationId:r.id,videoClassId:course.id,occurrenceStart:course.starts_at,durationMinutes:45}}))
  const paidBooking=await check(service.from('video_class_bookings').insert({video_class_id:course.id,user_id:r.buyer_id,price_paid_cents:700,status:'confirmed',occurrence_start:course.starts_at,duration_minutes:45,class_title:course.title,payment_order_id:r.id,reservation_id:r.id,payment_status:'paid',stripe_livemode:true}).select('*').single())
  await check(service.from('group_booking_reservations').update({status:'confirmed',payment_order_id:r.id,booking_id:paidBooking.id}).eq('id',r.id))
 }else assert.equal(claim.reservation.status,'confirmed')
 reservations.push(claim.reservation)
} 
const termsBefore=await check(service.from('group_booking_reservations').select('*').eq('video_class_id',course.id).order('id'))
const context={params:Promise.resolve({id:course.id})},url='/api/video-classes/'+course.id+'/reschedule',change={occurrenceStart:course.starts_at,expectedStart:course.starts_at,newDate:nextDate,newTime:'16:00',requestId:randomUUID()}
for(const who of [null,actors.buyer,actors.foreign]){actor=who;assert.equal((await group.POST(req(url,change),context)).status,who?403:401)}
actor=actors.coach
const simultaneous=await Promise.all([group.POST(req(url,change),context),group.POST(req(url,change),context)]);assert.ok(simultaneous.every(r=>r.status===200));await flush();assert.equal(emails.length,8);assert.equal(failGroupCustomer,false);assert.equal(attempts.filter(a=>a.payload.to===actors.buyer2.email&&a.payload.subject.includes('Gruppen-Move')).length,2)
assert.equal((await group.POST(req(url,change),context)).status,200);await flush();assert.equal(emails.length,8)
assert.deepEqual(await check(service.from('group_booking_reservations').select('*').eq('video_class_id',course.id).order('id')),termsBefore,'No financial or booking agreement field changes')
assert.equal((await group.POST(req(url,{...change,newTime:'17:00'}),context)).status,409,'A request ID cannot be rebound')
assert.equal((await group.POST(req(url,{...change,requestId:randomUUID(),newTime:'17:00'}),context)).status,409,'Stale expected time cannot overwrite the move')
const shifted=slots.berlinDateTimeToIso(nextDate,'16:00');assert.equal((await check(service.from('group_occurrence_schedules').select('*').eq('video_class_id',course.id).single())).revision,1)
const conflict={...change,requestId:randomUUID(),expectedStart:shifted,newDate:date,newTime:'13:00'};assert.equal((await group.POST(req(url,conflict),context)).status,409)
// Every source row is independently claimed; new users cannot read or enqueue private messages.
for(const client of [anon(),actors.buyer.client,actors.coach.client]){assert.ok((await client.from('coaching_email_deliveries').select('*')).error);assert.ok((await client.rpc('reschedule_group_occurrence',{p_class_id:course.id,p_occurrence:course.starts_at,p_expected_start:shifted,p_new_start:shifted,p_actor_id:actors.coach.id,p_request_id:randomUUID()})).error)}
const ours=[b.id,change.requestId];const ledger=await check(service.from('coaching_email_deliveries').select('*').in('booking_id',ours));assert.equal(ledger.length,8);assert.ok(ledger.every(r=>r.state==='sent'&&r.payload===null))
await Promise.all([worker.runCoachingEmails(change.requestId),worker.runCoachingEmails(change.requestId)]);assert.equal(emails.length,8)
for(const email of emails){assert.match(email.payload.subject,/Termin verschoben/);assert.match(email.payload.text,/Alter Termin:.*Europe\/Berlin/);assert.match(email.payload.text,/Neuer Termin:/);assert.doesNotMatch(email.payload.html,/<Yoga>|daily\.co|localhost|undefined/);if(output){const row=ledger.find(r=>email.key.endsWith(r.id));const name=[row.booking_kind,'revision'+row.event_version,row.recipient_role,row.recipient_id===actors.buyer2.id?'two':row.recipient_id===actors.buyer3.id?'three':'one'].join('-');fs.writeFileSync(output+'/'+name+'.html',email.payload.html);fs.writeFileSync(output+'/'+name+'.txt',email.payload.text)}}
// Additional database checks deliberately do not dispatch any further emails.
const makeCourse=async(title,day,time='09:00',extra={})=>check(service.from('video_classes').insert({creator_id:coach.id,title,schedule_type:'once',starts_at:slots.berlinDateTimeToIso(day,time),duration_minutes:45,max_participants:9,price_cents:0,active:true,...extra}).select('*').single())
const reserve=async(course,start=course.starts_at,role='buyer2',paid=false)=>check(service.rpc('reserve_group_class_booking',{p_class_id:course.id,p_buyer_id:actors[role].id,p_request_id:randomUUID(),p_occurrence_start:start,p_livemode:paid?true:null,p_account_id:paid?'acct_LocalFixture':null,p_expected_price_cents:paid?700:0}))
const move=async(course,identity,expected,next,key=randomUUID())=>check(service.rpc('reschedule_group_occurrence',{p_class_id:course.id,p_occurrence:identity,p_expected_start:expected,p_new_start:next,p_actor_id:actors.coach.id,p_request_id:key}))
const day7=slots.addDaysToDateString(nextDate,7),week2=slots.addDaysToDateString(day7,7),movedDay=slots.addDaysToDateString(day7,1)
const weekly=await makeCourse('Weekly move test',day7,'09:00',{schedule_type:'recurring',starts_at:null,recurring_weekday:slots.berlinDayOfWeek(day7),recurring_time:'09:00'})
const a=slots.berlinDateTimeToIso(day7,'09:00'),later=slots.berlinDateTimeToIso(week2,'09:00'),newTime=slots.berlinDateTimeToIso(movedDay,'09:00')
assert.equal((await reserve(weekly,a)).reservation.status,'confirmed');assert.equal((await reserve(weekly,later)).reservation.status,'confirmed')
for(const [i,[from,to]]of [[a,newTime],[newTime,a],[a,newTime]].entries()){const r=await move(weekly,a,from,to);assert.equal(r.ok,true);assert.equal(r.revision,i+1)}
assert.equal(new Date(await check(service.rpc('effective_group_start',{p_class_id:weekly.id,p_occurrence:later}))).getTime(),Date.parse(later))
const cycleRows=await check(service.from('coaching_email_deliveries').select('*').eq('booking_kind','group').eq('event_kind','reschedule').eq('recipient_id',actors.coach.id));assert.ok(cycleRows.filter(r=>r.details.title===weekly.title).length===3)
const pending=await makeCourse('Pending payment move test',slots.addDaysToDateString(date,5),'11:00',{price_cents:700});await reserve(pending,pending.starts_at,'buyer',true)
assert.equal((await move(pending,pending.starts_at,pending.starts_at,slots.berlinDateTimeToIso(slots.addDaysToDateString(date,6),'11:00'))).error,'payment_pending')
// Reminder claims retain stable original identity but use the effective schedule and revision.
const soonStart=new Date(Date.now()+60*60000).toISOString(),soonNext=new Date(Date.now()+120*60000).toISOString()
const soon=await makeCourse('Reminder move test',date,'09:00',{starts_at:soonStart});await reserve(soon)
const payload={from:'test',to:'delivered+reminder@resend.dev',subject:'old',html:'old',text:'old'},token1=randomUUID(),token2=randomUUID()
const ident={p_class_id:soon.id,p_occurrence:soon.starts_at,p_recipient_id:actors.buyer2.id,p_role:'participant'}
const oldClaim=await check(service.rpc('claim_current_group_reminder',{...ident,p_payload:payload,p_token:token1,p_expected_start:soonStart}));assert.equal(oldClaim.state,'claimed')
assert.equal((await move(soon,soon.starts_at,soonStart,soonNext)).error,'busy')
assert.equal(await check(service.rpc('complete_group_reminder',{p_id:oldClaim.id,p_token:token1})),true)
assert.equal((await move(soon,soon.starts_at,soonStart,soonNext)).ok,true)
const reminderRows=await check(service.from('group_reminder_recipients').select('*').eq('video_class_id',soon.id));assert.equal(reminderRows.length,2);assert.ok(reminderRows.every(r=>Date.parse(r.scheduled_at)===Date.parse(soonNext)))
assert.equal((await check(service.rpc('claim_current_group_reminder',{...ident,p_payload:payload,p_token:token2,p_expected_start:soonStart}))).state,'ineligible')
const newClaim=await check(service.rpc('claim_current_group_reminder',{...ident,p_payload:{...payload,subject:'new',text:'new',html:'new'},p_token:token2,p_expected_start:soonNext}));assert.equal(newClaim.state,'claimed');assert.notEqual(newClaim.id,oldClaim.id)
assert.equal(await check(service.rpc('complete_group_reminder',{p_id:newClaim.id,p_token:token2})),true)
// Cancellations use the effective date while all monetary agreement fields stay frozen.
const cancelled=await check(service.rpc('cancel_group_class_booking',{p_booking_id:reservations[0].booking_id,p_actor_id:actors.buyer.id}));assert.equal(cancelled.reservation.status,'cancelled')
const notice=await check(service.from('coaching_email_deliveries').select('details').eq('booking_id',reservations[0].booking_id).eq('event_kind','cancellation'));assert.equal(notice.length,2);assert.ok(notice.every(n=>Date.parse(n.details.scheduled_at)===Date.parse(shifted)))
// Real parallel SQL sessions: only a group move or a conflicting individual insert wins.
const raceDay=slots.addDaysToDateString(date,9),raceCourse=await makeCourse('Concurrent calendar test',raceDay,'10:00');await reserve(raceCourse)
const target=slots.berlinDateTimeToIso(raceDay,'12:00')
const race=await Promise.all([service.rpc('reschedule_group_occurrence',{p_class_id:raceCourse.id,p_occurrence:raceCourse.starts_at,p_expected_start:raceCourse.starts_at,p_new_start:target,p_actor_id:actors.coach.id,p_request_id:randomUUID()}),service.from('bookings').insert({creator_id:coach.id,buyer_id:actors.buyer.id,buyer_email:actors.buyer.email,buyer_name:'Calendar test',booking_request_key:randomUUID(),scheduled_at:target,duration_minutes:30,price_cents:0,status:'confirmed',payment_status:'not_required',cancellation_policy_hours:24})])
assert.equal(Number(race[0].data?.ok===true)+Number(!race[1].error),1)
assert.ok(race[0].data?.error==='conflict'||race[1].error?.code==='23P01')
// A -> B -> A is a genuine new revision; no-op writes are not.
for(const time of ['12:00','13:00','13:00'])await check(service.from('bookings').update({scheduled_at:iso(time)}).eq('id',b.id))
const individualCycle=await check(service.from('coaching_email_deliveries').select('event_version').eq('booking_id',b.id).eq('event_kind','reschedule'))
assert.equal(individualCycle.length,8);assert.deepEqual([...new Set(individualCycle.map(r=>r.event_version))].sort(),[1,2,3,4])
const report={date:new Date().toISOString(),tag,scope:'Real isolated GoTrue/PostgreSQL and actual application routes; '+(real?'real Resend test sinks':'mock email transport'),uniqueMessages:8,attempts:attempts.length,duplicates:0,checks:['1:1 buyer and coach moves','No-op and repeated requests','Group coach plus three participants','Parallel group requests','Independent failed recipient retry','Accepted provider request then DB completion failure uses identical key/payload/ID','Stale requests and request-ID rebinding denied','Coach calendar conflict denied','Immutable paid/free financial/booking terms (paid state simulated locally)','Anonymous/foreign actors and browser RPCs denied','A-B-A-B revisions remain distinct; other weekly occurrences unchanged','Open payments prevent moves','Reminder claims follow effective time; old claims do not suppress new revisions','Cancellation mail uses effective date','Two real SQL sessions serialize overlapping group/individual writes'],emails:emails.map(e=>({id:e.id,to:e.payload.to,subject:e.payload.subject,lastEvent:real?'pending_dashboard_verification':'mocked'})),productionBookingDataChanged:false,financialOperations:false}
if(output)fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
