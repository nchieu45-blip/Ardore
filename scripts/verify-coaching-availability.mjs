import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require=createRequire(import.meta.url)
function load(path, mocks={}) {
 const loadedModule={exports:{}}
 const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}})
 new Function('require','exports','module',compiled.outputText)(name=>mocks[name]??require(name),loadedModule.exports,loadedModule)
 return loadedModule.exports
}
const slots=load('src/lib/coaching-slots.ts')
const availability=load('src/lib/coaching-availability.ts',{'@/lib/coaching-slots':slots})
const weekly=(start='09:00',end='17:00',day=1)=>({day_of_week:day,start_time:start,end_time:end})
const override=(type,start,end)=>({date:'2026-10-12',type,start_time:start,end_time:end})
const valid={expectedRevision:0,slots:[weekly()],dateOverrides:[]}
let user={id:'coach'},rpcCalls=[],rpcError=null
const service={rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:{revision:1,slots:args?.p_slots??[],dateOverrides:args?.p_date_overrides??[]},error:rpcError}}}
const client={auth:{getUser:async()=>({data:{user}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'owned-creator'}})})})})}
const route=load('src/app/api/coaching/availability/route.ts',{'@/lib/supabase/server':{createClient:async()=>client,createServiceClient:async()=>service},'@/lib/coaching-availability':availability})
async function post(body,raw=false){const response=await route.POST(new Request('http://localhost/api/coaching/availability',{method:'POST',body:raw?body:JSON.stringify(body)}));return {status:response.status,data:await response.json()}}
test('complete replacement validation: invalid, overlap, contradictory exceptions, adjacent, empty',()=>{
 for(const input of [null,{}, {...valid,expectedRevision:undefined},{...valid,slots:[null]},{...valid,slots:[weekly('25:00')]},{...valid,dateOverrides:[{...override('available','09:00','10:00'),date:'2026-02-30'}]}])assert.equal(availability.availabilityInput.safeParse(input).success,false)
 for(const input of [{...valid,slots:[weekly('17:00','09:00')]},{...valid,slots:[weekly(),weekly('10:00','11:00')]},{...valid,dateOverrides:[override('available',null,null)]},{...valid,dateOverrides:[override('unavailable',null,null),override('available','18:00','19:00')]},{...valid,dateOverrides:[override('available','10:00','11:00')]}])assert.ok(availability.availabilityValidationError(input), JSON.stringify(input))
 for(const input of [valid,{...valid,slots:[]},{...valid,slots:[weekly('09:00','12:00'),weekly('12:00','17:00')]},{...valid,dateOverrides:[override('unavailable','10:00','11:00'),override('available','18:00','19:00')]}])assert.equal(availability.availabilityValidationError(input),null)
})
test('route authenticates, rejects before writes and makes one transactional call with server-owned IDs',async()=>{
 rpcCalls=[];user=null;assert.equal((await post(valid)).status,401);user={id:'coach'}
 for(const input of [null,{...valid,creator_id:'victim'},{...valid,slots:[weekly(),weekly()]},{...valid,offer:{price_cents:-1}}])assert.equal((await post(input)).status,400)
 assert.equal((await post('{',true)).status,400);assert.equal(rpcCalls.length,0)
 assert.equal((await post(valid)).status,200);assert.equal(rpcCalls.length,1)
 assert.equal(rpcCalls[0].name,'replace_coach_availability');assert.equal(rpcCalls[0].args.p_creator_id,'owned-creator');assert.equal(rpcCalls[0].args.p_coach_user_id,'coach')
 const get=await route.GET();assert.equal(get.status,200);assert.equal(get.headers.get('Cache-Control'),'private, no-store')
})
test('database failures and concurrency return clear safe errors without leaking database details',async()=>{
 for(const [code,status] of [['PT409',409],['40001',409],['23P01',409],['42501',403],['22023',400],['XX000',503]]){
  rpcError={code,message:'private SQL details'};const result=await post(valid);assert.equal(result.status,status);assert.ok(!JSON.stringify(result.data).includes('private SQL'))
 }
 rpcError=null
})
test('stored booking buffer remains protected after coach changes current buffer; Berlin DST unchanged',()=>{
 const start=slots.berlinToUtcMs('2026-10-12','10:00')
 const booked=[{scheduled_at:new Date(start).toISOString(),duration_minutes:60,buffer_minutes:30}]
 assert.deepEqual(slots.generateSlots('2026-10-12',[{start:'11:00',end:'12:00'}],30,0,booked,0),['11:30'])
 assert.equal(slots.berlinToUtcMs('2026-10-25','02:30'),null)
 assert.equal(slots.berlinToUtcMs('2027-03-28','02:30'),null)
})

test('availability settings preserve coach-selected cents on reload',()=>{
 const form=load('src/app/creator/settings/videocoaching/VideoCoachingForm.tsx',{
  '@/lib/toast':{toast:{}},'@/lib/utils':{cn:(...parts)=>parts.filter(p=>typeof p==='string').join(' ')},
  '@/components/ui/Button':{Button:({children,...props})=>React.createElement('button',props,children)},
  '@/components/ui/Input':{Input:props=>React.createElement('input',props)},
 }).default
 const html=renderToStaticMarkup(React.createElement(form,{initialOffer:{is_enabled:true,price_cents:12345,duration_minutes:60},initialSlots:[],initialDateOverrides:[],initialRevision:5}))
 assert.match(html,/value="123.45"/)
})
test('failed initial database read shows recovery action, never an editable empty availability form',async()=>{
 const page=load('src/app/creator/settings/videocoaching/page.tsx',{
  '@/lib/supabase/server':{createClient:async()=>client,createServiceClient:async()=>({rpc:async()=>({error:{code:'XX000'},data:null})})},
  './VideoCoachingForm':{__esModule:true,default:()=>assert.fail('Do not initialize an empty form after a read failure')},
  'next/navigation':{redirect:()=>assert.fail('Authenticated coach must retain settings error')},
  'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
 }).default
 const html=renderToStaticMarkup(await page())
 assert.match(html,/role="alert"/);assert.match(html,/Erneut laden/);assert.match(html,/unverändert/)
})
