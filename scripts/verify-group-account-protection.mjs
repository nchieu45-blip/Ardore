// Deletion preflight fixtures never run any real Auth, mail or payment operation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
function fixture({creator=true,creatorError=false,groupCount=1,groupError=false,bookingCount=0,benefitCount=0,agreementCount=0,agreementError=false}={}){
  const calls=[],effects=[];let groupReads=0
  const service={from(table){calls.push(table);if(table==='group_booking_reservations')groupReads++;const benefit=groupReads>1;const q={select(){return this},eq(){return this},not(){return this},gt(){return this},or(){return this},
    async single(){return {data:{full_name:'Synthetic'},error:null}},async maybeSingle(){return {data:creator?{id:'coach',display_name:'Coach'}:null,error:creatorError?new Error('private preflight error'):null}},
    then(resolve,reject){return Promise.resolve({count:table==='group_booking_reservations'?(benefit?benefitCount:groupCount):table==='video_class_occurrences'?agreementCount:bookingCount,error:((groupError&&table==='group_booking_reservations')||(agreementError&&table==='video_class_occurrences'))?new Error('private preflight error'):null}).then(resolve,reject)},
    delete(){effects.push('delete');throw new Error('Unexpected side effect')}};return q},auth:{admin:{deleteUser(){effects.push('auth-delete');throw new Error('Unexpected side effect')}}}}
  const modules={ 'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
    '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'buyer'}}})}}),createServiceClient:async()=>service},
    '@/lib/stripe/server':{stripe:{subscriptions:{cancel(){effects.push('cancel');throw new Error('Unexpected side effect')}}}} }
  const compiled=ts.transpileModule(readFileSync(new URL('../src/app/api/account/delete/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const fixtureModule={exports:{}}
  new Function('require','exports','module','console',compiled)(name=>{assert.ok(name in modules,`Unexpected dependency ${name}`);return modules[name]},fixtureModule.exports,fixtureModule,{error(){}})
  return {calls,effects,run:()=>fixtureModule.exports.POST()}
}
test('paid group records prevent buyer or coach deletion before notifications or provider side effects',async()=>{
  for(const creator of [false,true]){const f=fixture({creator});const response=await f.run();assert.equal(response.status,409);assert.deepEqual(f.calls,['profiles','creator_profiles','group_booking_reservations']);assert.deepEqual(f.effects,[])}
})
test('unknown group financial scope fails closed before account-deletion effects',async()=>{
  for(const opts of [{creatorError:true},{groupError:true},{groupCount:null}]){const f=fixture(opts);const response=await f.run();assert.equal(response.status,500);assert.deepEqual(f.effects,[]);assert.doesNotMatch(JSON.stringify(response),/private preflight/)}
})
test('existing 1:1 financial guard remains in force after a clear group preflight',async()=>{
  const f=fixture({groupCount:0,bookingCount:1});assert.equal((await f.run()).status,409);assert.deepEqual(f.calls,['profiles','creator_profiles','group_booking_reservations','group_booking_reservations','video_class_occurrences','bookings']);assert.deepEqual(f.effects,[])
})

test('coach free/host-initialized occurrence agreements block deletion before any unrelated side effects',async()=>{
  const f=fixture({groupCount:0,agreementCount:1});assert.equal((await f.run()).status,409)
  assert.deepEqual(f.calls,['profiles','creator_profiles','group_booking_reservations','group_booking_reservations','video_class_occurrences']);assert.deepEqual(f.effects,[])
})
test('subscription-backed free participation and unknown coach agreement state both fail before cancellation/deletion',async()=>{
  const benefit=fixture({creator:false,groupCount:0,benefitCount:1});assert.equal((await benefit.run()).status,409);assert.deepEqual(benefit.effects,[])
  assert.deepEqual(benefit.calls,['profiles','creator_profiles','group_booking_reservations','group_booking_reservations'])
  for(const options of [{agreementCount:null},{agreementError:true}]){const f=fixture({groupCount:0,...options});assert.equal((await f.run()).status,500);assert.deepEqual(f.effects,[])}
})
