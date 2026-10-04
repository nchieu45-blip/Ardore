import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
const require=createRequire(import.meta.url)
function load(path,mocks={}){const m={exports:{}};new Function('require','exports','module',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>mocks[n]??require(n),m.exports,m);return m.exports}
const slots=load('src/lib/coaching-slots.ts'),ui=load('src/lib/reschedule-ui.ts',{'./coaching-slots':slots})
const args={bookingId:'synthetic',date:'2026-10-20',time:'12:00',signal:new AbortController().signal}
test('valid server confirmation uses the unchanged reschedule payload and requires explicit ok',async()=>{
 let calls=0;const result=await ui.submitReschedule({...args,request:async(url,options)=>{calls++;assert.equal(url,'/api/coaching/reschedule');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{bookingId:'synthetic',newDate:'2026-10-20',newTime:'12:00'});return new Response(JSON.stringify({ok:true}),{status:200})}});assert.equal(result.ok,true);assert.equal(calls,1)
})
test('invalid inputs are German validation failures without any API request',async()=>{
 for(const patch of [{date:null},{time:null},{date:'2026-02-30'},{time:'25:00'}]){const result=await ui.submitReschedule({...args,...patch,request:async()=>assert.fail('Invalid input must not send')});assert.equal(result.ok,false);assert.match(result.message,/gültiges Datum/);assert.equal(result.uncertain,false)}
})
test('slot conflict stays explicit/retryable, while missing cutoff never masquerades as slot loss',async()=>{
 const conflict=await ui.submitReschedule({...args,request:async()=>new Response(JSON.stringify({error:'Dieser Zeitslot wurde gerade vergeben.'}),{status:409})});assert.equal(conflict.conflict,true);assert.match(conflict.message,/vergeben.*anderen Termin/)
 const cutoff=await ui.submitReschedule({...args,request:async()=>new Response(JSON.stringify({policyUnavailable:true}),{status:409})});assert.equal(cutoff.conflict,false);assert.match(cutoff.message,/Ardore-Support/)
})
test('server failure, unauthorized access and invalid JSON responses always produce visible German error text',async()=>{
 for(const status of [400,401,403,500,502]){const result=await ui.submitReschedule({...args,request:async()=>new Response('<html>private error</html>',{status})});assert.equal(result.ok,false);assert.equal(result.uncertain,false);assert.ok(result.message.length>20);assert.ok(!result.message.includes('private'))}
})
test('lost/aborted/malformed successful responses never claim success or invite blind duplicate POST retries',async()=>{
 for(const request of [async()=>{throw new TypeError('Failed to fetch')},async()=>{throw new DOMException('Timed out','AbortError')},async()=>new Response('broken',{status:200}),async()=>new Response('{}',{status:200})]){const result=await ui.submitReschedule({...args,request});assert.equal(result.ok,false);assert.equal(result.uncertain,true);assert.match(result.message,/möglicherweise bereits geändert.*Buchung neu/);assert.ok(!result.message.includes('Failed to fetch'))}
})
test('availability data is strictly validated and duplicate radios cannot result from duplicate API values',()=>{
 assert.deepEqual(ui.rescheduleDays({days:[2,2,3]},31),[2,3]);assert.deepEqual(ui.rescheduleSlots({slots:['10:00','10:00','11:00']}),['10:00','11:00'])
 for(const body of [null,{}, {days:[0]},{days:[32]},{days:['2']}])assert.throws(()=>ui.rescheduleDays(body,31))
 for(const body of [null,{}, {slots:['25:00']},{slots:[2]}])assert.throws(()=>ui.rescheduleSlots(body))
})
