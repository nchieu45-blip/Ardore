// Local contract tests; no credentials, network or real provider access.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {loadUiComponent} from './fixtures/load-ui-component.mjs'
const id='20000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000001'
const occurrence='2026-11-01T12:00:00Z',body={occurrenceStart:occurrence,expectedStart:occurrence,newDate:'2026-11-02',newTime:'16:00',requestId:'30000000-0000-4000-8000-000000000001'}
const zero={sent:0,skipped:0,failed:0,legacySkipped:0,busy:0,held:0}
function fixture(options={}){
 const calls=[],after=[]
 const api=loadUiComponent('src/app/api/video-classes/[id]/reschedule/route.ts',{
  'next/server':{NextResponse:Response,after:job=>after.push(job)},
  '@/lib/app-url':{appOrigin:()=> 'https://www.ardore-health.com'},
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:actor}},error:null})}}),createServiceClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:options.result??{ok:true,eventId:body.requestId,scheduledAt:'2026-11-02T15:00:00Z'},error:options.error??null}}})},
  '@/lib/coaching-emails':{runCoachingEmails:async id=>{calls.push({delivery:id});return zero}},
 })
 return {calls,after,post:(payload=body,headers={})=>api.POST(new Request('https://www.ardore-health.com/api/video-classes/'+id+'/reschedule',{method:'POST',headers:{Origin:'https://www.ardore-health.com','Content-Type':'application/json',...headers},body:JSON.stringify(payload)}),{params:Promise.resolve({id})})}
}
test('group reschedule binds server-authenticated actor and Berlin-converted time to the service-only RPC',async()=>{
 const f=fixture();assert.equal((await f.post()).status,200);assert.equal(f.after.length,1);assert.deepEqual(f.calls[0],{name:'reschedule_group_occurrence',args:{p_class_id:id,p_occurrence:occurrence,p_expected_start:occurrence,p_new_start:'2026-11-02T15:00:00.000Z',p_actor_id:actor,p_request_id:body.requestId}});await f.after[0]();assert.deepEqual(f.calls[1],{delivery:body.requestId})
})
test('group reschedule refuses unauthenticated/cross-site requests and client financial/actor authority',async()=>{
 const a=fixture({anonymous:true});assert.equal((await a.post()).status,401);assert.equal(a.calls.length,0)
 for(const [payload,headers,status]of [[body,{Origin:'https://evil.test'},403],[body,{'Content-Type':'text/plain'},415],[{...body,actorId:actor},{},400],[{...body,priceCents:1},{},400],[{...body,requestId:'bad'},{},400],[{...body,newDate:'2026-02-30'},{},400],[{...body,newTime:'25:00'},{},400],[{...body,newDate:'2027-03-28',newTime:'02:30'},{},400],[{...body,newDate:'2027-10-31',newTime:'02:30'},{},400]]){const f=fixture();assert.equal((await f.post(payload,headers)).status,status);assert.equal(f.calls.length,0)}
})
for(const [error,status]of [['forbidden',403],['not_found',404],['stale',409],['request_conflict',409],['conflict',409],['time',409],['payment_pending',409],['busy',409]])test('group '+error+' refusal cannot dispatch mail',async()=>{const f=fixture({result:{error}});const r=await f.post();assert.equal(r.status,status);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(f.after.length,0)})
test('uncertain DB failure is retryable and exposes no private provider details',async()=>{const f=fixture({error:{message:'PRIVATE'}});const r=await f.post();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/PRIVATE/);assert.equal(f.after.length,0)})
test('effective group time is scoped by class/occurrence and read failures fail closed',async()=>{
 const lib=loadUiComponent('src/lib/group-effective-schedule.ts');const filters=[];const client={from(table){assert.equal(table,'group_occurrence_schedules');const q={select:()=>q,eq(k,v){filters.push([k,v]);return q},maybeSingle:async()=>({data:{scheduled_at:'2026-11-02T15:00:00Z'},error:null})};return q}}
 assert.equal(await lib.effectiveGroupStart(client,id,occurrence),'2026-11-02T15:00:00Z');assert.deepEqual(filters,[['video_class_id',id],['occurrence_start',occurrence]])
 await assert.rejects(lib.effectiveGroupStart({from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:{}})};return q}},id,occurrence),/group_schedule_unavailable/)
})
