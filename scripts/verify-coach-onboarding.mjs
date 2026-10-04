import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(import.meta.url)
function load(path, overrides = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop:true } }).outputText
  const loadedModule = { exports: {} }
  new Function('require','exports','module',compiled)(name => name in overrides ? overrides[name] : require(name),loadedModule.exports,loadedModule)
  return loadedModule.exports
}
const rules = load('src/lib/coach-publication.ts', { '@/lib/categories': { CATEGORY_LABEL_MAP: { yoga:'Yoga',fitness:'Fitness' } } })
const profile = { id:'synthetic',display_name:'Synthetic coach',slug:'synthetic-coach',categories:['yoga'],category:'yoga',onboarding_step:5,is_published:false }
for (const [name,patch,expected] of [
  ['complete setup',{},[]], ['whitespace name',{display_name:'  '},['Coach-Name (2–50 Zeichen)']],
  ['short name',{display_name:'X'},['Coach-Name (2–50 Zeichen)']],['invalid slug',{slug:'../hidden'},['Gültige Profiladresse']],
  ['missing category',{categories:[],category:null},['Mindestens eine Kategorie']],
  ['legacy category',{categories:[],category:'fitness'},[]],
  ['optional stage pending',{onboarding_step:2},['Einrichtung fortsetzen: Bilder']],
]) test(`publication completeness: ${name}`,()=>assert.deepEqual(rules.missingCoachRequirements({...profile,...patch}),expected))
test('existing required profile fields validated without adding prices, Stripe, images or biography requirements',()=>{
  assert.equal(rules.coachProfileSchema.safeParse({display_name:'  Coach  ',categories:['yoga']}).success,true)
  assert.equal(rules.coachProfileSchema.parse({display_name:'  Coach  ',categories:['yoga']}).display_name,'Coach')
  for(const data of [{display_name:'Coach',categories:[]},{display_name:'Coach',categories:['bogus']},{display_name:'Coach',categories:['yoga'],is_verified:true}]) assert.equal(rules.coachProfileSchema.safeParse(data).success,false)
})
function routeFixture({user={id:'actor'},current=profile,rpcError=null}={}) {
  const calls=[]
  const client={auth:{getUser:async()=>({data:{user}})},from(table){ assert.equal(table,'creator_profiles'); return {select(){return this},eq(key,value){assert.deepEqual([key,value],['user_id',user.id]);return this},maybeSingle:async()=>({data:current,error:null})} }}
  const service={rpc:async(name,args)=>{calls.push({name,args});return {data:profile,error:rpcError}}}
  const route=load('src/app/api/creator/onboarding/route.ts',{
    '@/lib/supabase/server':{createClient:async()=>client,createServiceClient:async()=>service},
    '@/lib/coach-publication':rules,'@/lib/utils':{slugify:()=> 'synthetic-coach'},
  })
  return {...route,calls,post:body=>route.POST({json:async()=>body})}
}
test('anonymous requests cannot read or publish onboarding',async()=>{
 const f=routeFixture({user:null});assert.equal((await f.GET()).status,401);assert.equal((await f.post({step:5,publish:true})).status,401);assert.equal(f.calls.length,0)
})
test('read resumes stored progress and returns private no-store response',async()=>{
 const f=routeFixture({current:{...profile,onboarding_step:3}});const r=await f.GET();assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).profile.onboarding_step,3)
})
test('profile save derives owner/category/slug and never accepts authority fields',async()=>{
 const f=routeFixture();assert.equal((await f.post({step:1,data:{display_name:'Coach',categories:['yoga']}})).status,200)
 assert.equal(f.calls[0].args.p_user_id,'actor');assert.equal(f.calls[0].args.p_data.category,'yoga');assert.match(f.calls[0].args.p_data.slug,/^synthetic-coach-/)
 for(const field of ['is_published','onboarding_step','is_verified','stripe_account_active','user_id']) assert.equal((await f.post({step:1,data:{display_name:'Coach',categories:['yoga'],[field]:true}})).status,400)
 assert.equal((await f.post({step:5,publish:true,user_id:'victim'})).status,400);assert.equal(f.calls.length,1)
})
for(const step of [2,3,4]) test(`optional step ${step} may be skipped and persists through server RPC`,async()=>{
 const f=routeFixture();assert.equal((await f.post({step,data:{}})).status,200);assert.equal(f.calls[0].args.p_expected_step,step)
})
test('coach tier/product prices stay coach-controlled',async()=>{
 const f=routeFixture();await f.post({step:3,data:{name:'VIP',price_monthly:123}});await f.post({step:4,data:{title:'Own offer',price:249.75,type:'pdf'}})
 assert.equal(f.calls[0].args.p_data.price_monthly,123);assert.equal(f.calls[1].args.p_data.price,249.75)
})
test('failed publish reports incomplete requirements and never reports success',async()=>{
 const f=routeFixture({current:{...profile,display_name:' ',onboarding_step:2},rpcError:{code:'22023'}})
 const r=await f.post({step:5,publish:true});assert.equal(r.status,409);assert.equal((await r.json()).missing.length,2)
})
const connect=load('src/lib/stripe/connect-readiness.ts',{'@/lib/stripe/server':{stripe:{}}})
for(const [name,row,error,status] of [['draft',{id:'coach',is_published:false},null,409],['missing',null,null,409],['read failure',null,{code:'failure'},503],['published',{id:'coach',is_published:true},null,null]]) test(`checkout publication gate: ${name}`,async()=>{
 const service={from(table){assert.equal(table,'creator_profiles');return {select(columns){assert.equal(columns,'id,is_published');return this},eq(){return this},maybeSingle:async()=>({data:row,error})}}}
 if(status) await assert.rejects(()=>connect.requirePublishedCoach(service,'coach'),e=>e.status===status)
 else await connect.requirePublishedCoach(service,'coach')
})
test('setup banner provides one next action and published state',()=>{
 const component=load('src/components/creator/CoachSetupStatus.tsx',{'next/navigation':{usePathname:()=>'/creator',useRouter:()=>({})},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},'@/lib/coach-publication':rules,'@/components/ui/Button':{Button:({children,loading,...props})=>React.createElement('button',{...props,disabled:loading},children)}}).CoachSetupStatus
 const markup=p=>renderToStaticMarkup(React.createElement(component,{profile:p}))
 assert.match(markup({...profile,onboarding_step:2}),/Einrichtung fortsetzen/);assert.match(markup(profile),/Profil veröffentlichen/)
 assert.doesNotMatch(markup({...profile,is_published:true}),/Profil veröffentlichen|Einrichtung fortsetzen/)
})
test('database publication/progress are trusted and stage writes are atomic/idempotent',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261004004329_coach_onboarding_publication.sql',import.meta.url),'utf8')
 assert.match(sql,/is_published boolean NOT NULL DEFAULT false/);assert.match(sql,/REVOKE INSERT \(is_published,onboarding_step\), UPDATE/)
 assert.match(sql,/FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION public.advance_coach_onboarding.* TO service_role/)
 assert.match(sql,/FOR UPDATE/);assert.match(sql,/c.onboarding_step>p_expected_step/);assert.match(sql,/pg_advisory_xact_lock/)
 assert.match(sql,/UPDATE public.creator_profiles SET is_published=true, onboarding_step=5\nWHERE private.coach_profile_complete/)
 assert.match(sql,/RAISE EXCEPTION 'Veröffentlichtes Profil benötigt/)
 assert.doesNotMatch(sql,/UPDATE public.(products|coaching_offers|subscription_tiers).*price/)
})
for(const endpoint of ['slots','available-days']) test(`private coach cannot leak availability through ${endpoint} privileged API`,async()=>{
 const route=load(`src/app/api/coaching/${endpoint}/route.ts`,{
  '@/lib/supabase/server':{createClient:async()=>({from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})})}),createServiceClient:()=>assert.fail('Private availability must be checked before any service access')},
  '@/lib/coaching-slots':{isValidDateString:()=>true},'@/lib/coaching-booking':{},'@/lib/coaching-payment-lifecycle':{},
 })
 assert.equal((await route.GET({url:'https://www.ardore-health.com/api/coaching/'+endpoint+'?creatorId=hidden&date=2026-10-10&year=2026&month=9'})).status,404)
})
