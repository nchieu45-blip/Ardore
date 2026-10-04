import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
const require=createRequire(import.meta.url)
function load(path,mocks={}) { const loadedModule={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','exports','module',code)(name=>mocks[name]??require(name),loadedModule.exports,loadedModule);return loadedModule.exports }
const slots=load('src/lib/coaching-slots.ts')
const calendar=load('src/lib/coach-calendar.ts',{'./coaching-slots':slots})
const date='2026-10-20',start=slots.berlinToUtcMs(date,'10:00')
const offer={is_enabled:true,buffer_minutes:15,min_notice_hours:0,max_horizon_days:60}
const fixture=(bookings=[])=>({loadedAt:slots.berlinToUtcMs('2026-10-19','00:00'),availability:{offer,slots:[{day_of_week:2,start_time:'09:00',end_time:'17:00'}],dateOverrides:[]},bookings})
const booking={id:'one',scheduled_at:new Date(start).toISOString(),duration_minutes:60,buffer_minutes:30,status:'confirmed'}
const at=(segments,hhmm)=>segments.find(s=>s.start<=slots.berlinToUtcMs(date,hhmm)&&s.end>slots.berlinToUtcMs(date,hhmm))
test('available, confirmed and buffers replace the availability projection without mutation',()=>{
 const data=fixture([booking]),before=JSON.stringify(data),segments=calendar.calendarSegments(date,data)
 assert.equal(at(segments,'09:00').kind,'available');assert.equal(at(segments,'09:45').kind,'buffer');assert.equal(at(segments,'10:00').kind,'booking');assert.equal(at(segments,'11:25').kind,'buffer');assert.equal(at(segments,'11:30').kind,'available');assert.equal(at(segments,'18:00').kind,'unavailable');assert.equal(JSON.stringify(data),before)
})
test('pending reservations remain protected even when expiry passes; display never releases payment holds',()=>{
 assert.equal(at(calendar.calendarSegments(date,fixture([{...booking,status:'pending_payment',reservation_expires_at:'2025-01-01'}])),'10:00').kind,'booking')
})
test('canceled, failed, expired and completed bookings remain discoverable but do not block slots',()=>{
 for(const status of ['cancelled','completed','payment_failed','expired']){
 const data=fixture([{...booking,status}]);assert.equal(at(calendar.calendarSegments(date,data),'10:00').kind,'available');assert.equal(calendar.bookingsForDate(date,data.bookings).length,1)
 }
})
test('date overrides, disabled offer, notice and horizon are respected',()=>{
 const data=fixture();data.availability.dateOverrides=[{date,type:'unavailable',start_time:'12:00',end_time:'14:00'}];assert.equal(at(calendar.calendarSegments(date,data),'13:00').kind,'unavailable')
 data.availability.offer={...offer,is_enabled:false};assert.ok(calendar.calendarSegments(date,data).every(s=>s.kind==='unavailable'))
 data.availability.offer={...offer,min_notice_hours:48};assert.equal(at(calendar.calendarSegments(date,data),'10:00').kind,'unavailable')
 data.availability.offer={...offer,max_horizon_days:0};assert.equal(at(calendar.calendarSegments(date,data),'10:00').kind,'unavailable')
})
test('Berlin spring/fall calendar days cover exactly 23/25 real hours, repeated wall times retain offsets',()=>{
 for(const [d,hours] of [['2026-03-29',23],['2026-10-25',25]]){
 const data=fixture();data.loadedAt=slots.berlinToUtcMs(slots.addDaysToDateString(d,-1),'00:00');const result=calendar.calendarSegments(d,data);assert.equal(result.reduce((n,s)=>n+s.end-s.start,0),hours*3600000)
 }
 const first=calendar.calendarTime(Date.parse('2026-10-25T00:30:00Z')),second=calendar.calendarTime(Date.parse('2026-10-25T01:30:00Z'));assert.ok(first.startsWith('02:30'));assert.ok(second.startsWith('02:30'));assert.notEqual(first,second)
})
test('day/week navigation is Berlin Monday-first and independent of runtime timezone',()=>{
 assert.deepEqual(calendar.calendarDates('2026-10-25','week'),['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);assert.deepEqual(calendar.calendarDates(date,'day'),[date]);assert.equal(slots.addDaysToDateString('2026-03-29',1),'2026-03-30')
})
test('cross-midnight booking and buffer from previous day override today',()=>{
 const b={...booking,scheduled_at:new Date(slots.berlinToUtcMs('2026-10-19','23:30')).toISOString(),duration_minutes:60}
 assert.equal(calendar.bookingsForDate(date,[b]).length,1);assert.equal(at(calendar.calendarSegments(date,fixture([b])),'00:15').kind,'booking');assert.equal(at(calendar.calendarSegments(date,fixture([b])),'00:45').kind,'buffer')
})
function routeFixture({user={id:'owner'},coach={id:'owned'},error=null,bookingsError=null,availabilityError=null}={}){
 const predicates=[],rpc=[];const client={auth:{getUser:async()=>({data:{user}})},from(table){return{select(){return this},eq(k,v){predicates.push([table,k,v]);return this},gte(){return this},lt(){return this},order(){return this},limit:async()=>({data:[],error:bookingsError}),maybeSingle:async()=>({data:coach,error})}}}
 const service={rpc:async(name,args)=>{rpc.push({name,args});return{data:fixture().availability,error:availabilityError}}}
 const route=load('src/app/api/coaching/calendar/route.ts',{'next/server':{NextResponse:{json:(body,init)=>({body,...init})}},'@/lib/supabase/server':{createClient:async()=>client,createServiceClient:async()=>service},'@/lib/coaching-slots':slots,'@/lib/coach-calendar':calendar})
 return{route,predicates,rpc}
}
const request=(query='date=2026-10-20&view=week')=>({nextUrl:new URL(`https://www.ardore-health.com/api/coaching/calendar?${query}`)})
test('calendar endpoint derives owner, ignores supplied foreign coach id and returns private uncached data',async()=>{
 const f=routeFixture();const r=await f.route.GET(request('date=2026-10-20&view=week&creatorId=foreign'));assert.equal(r.headers['Cache-Control'],'private, no-store');assert.ok(f.predicates.some(([t,k,v])=>t==='bookings'&&k==='creator_id'&&v==='owned'));assert.deepEqual(f.rpc[0].args,{p_creator_id:'owned',p_coach_user_id:'owner'})
})
test('calendar rejects unauthenticated/noncoach/invalid dates and fails closed on either data source failure',async()=>{
 for(const [options,status] of [[{user:null},401],[{coach:null},403],[{error:{code:'failure'}},503],[{bookingsError:{}},503],[{availabilityError:{}},503]])assert.equal((await routeFixture(options).route.GET(request())).status,status)
 for(const query of ['date=2026-02-30&view=week','date=2026-10-20&view=month'])assert.equal((await routeFixture().route.GET(request(query))).status,400)
})
