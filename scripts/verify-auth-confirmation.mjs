import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import React from 'react'
const require = createRequire(import.meta.url)
function load(path, mocks = {}) {
 const loadedModule = { exports: {} }
 const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText
 new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), loadedModule.exports, loadedModule)
 return loadedModule.exports
}
const appUrl = load('src/lib/app-url.ts')
function callback(result, throws = false) {
 const calls = []
 const client = {auth: Object.fromEntries(['verifyOtp', 'exchangeCodeForSession'].map(name => [name, async input => {
  calls.push({name, input}); if(throws)throw Error('Provider unavailable');return result
 }]))}
 return {calls, GET: load('src/app/auth/callback/route.ts', {'@/lib/app-url': appUrl, '@/lib/supabase/server': {createClient: async() => client}}).GET}
}
function request(query){return {nextUrl:new URL(`https://www.ardore-health.com/auth/callback?${query}`)}}
for(const type of ['signup', 'email', 'invite', 'magiclink', 'email_change', 'recovery'])test(`${type}: successful OTP requires a session and selects correct default`, async()=>{
 const {GET,calls}=callback({data:{session:{user:{id:'fixture'}}},error:null})
 const r=await GET(request(`token_hash=fixture&type=${type}`))
 assert.equal(new URL(r.headers.get('location')).pathname,type==='recovery'?'/reset-password':'/verify-success')
 assert.equal(calls.length,1);assert.equal(calls[0].input.type,type)
 assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'no-store')
})
for(const [label,result] of [['expired',{data:{session:null},error:{code:'otp_expired'}}],['missing session',{data:{session:null},error:null}]])test(`${label}: signup and recovery failures remain distinct`,async()=>{
 for(const type of ['signup','recovery']){
  const r=await callback(result).GET(request(`token_hash=fixture&type=${type}`));const u=new URL(r.headers.get('location'))
  assert.equal(u.pathname,type==='signup'?'/verify-email':'/forgot-password');assert.equal(u.searchParams.get('error'),'link_invalid')
 }
})
test('invalid token type cannot reach provider or fall through to code exchange',async()=>{
 const {GET,calls}=callback({data:{session:{}},error:null})
 for(const query of ['token_hash=fixture&type=unknown&code=other','token_hash=fixture',''])assert.equal(new URL((await GET(request(query))).headers.get('location')).pathname,'/verify-email')
 assert.equal(calls.length,0)
})
test('PKCE confirmation and legacy recovery work; external redirects are rejected',async()=>{
 for(const [query,expected] of [['code=fixture','/verify-success'],['code=fixture&next=/reset-password','/reset-password'],['code=fixture&next=//evil.example','/verify-success'],['token_hash=fixture&type=recovery&next=https://evil.example','/reset-password']]){
  const r=await callback({data:{session:{}},error:null}).GET(request(query));const u=new URL(r.headers.get('location'));assert.equal(u.pathname,expected);assert.equal(u.origin,appUrl.appOrigin())
 }
})
test('provider exceptions become clear signup error, not an uncaught server failure',async()=>{
 const r=await callback(null,true).GET(request('token_hash=fixture&type=signup'));assert.equal(new URL(r.headers.get('location')).pathname,'/verify-email')
})
// Run the actual form handlers with mocked hooks/provider; no network or users.
function form(path,auth,query='') {
 let handler,states=[],pushes=[],inFlight={current:false};const parameters=new URLSearchParams(query)
 const react={...React,useState:initial=>{const slot=states.length;states.push(initial);return [initial,value=>{states[slot]=typeof value==='function'?value(states[slot]):value}]},useRef:()=>inFlight,useEffect:()=>{},Suspense:({children})=>children}
 const mocks={react,'@/lib/app-url':appUrl,'@/lib/utils':{cn:(...parts)=>parts.filter(Boolean).join(' ')},'@/lib/supabase/client':{createClient:()=>({auth})},'next/navigation':{useRouter:()=>({push:url=>pushes.push(url),refresh:()=>{}}),useSearchParams:()=>parameters},'next/link':{__esModule:true,default:()=>null},'react-hook-form':{useForm:()=>({register:()=>({}),handleSubmit:fn=>{handler=fn;return fn},formState:{errors:{},isSubmitting:false}})}}
 for(const [name,exports] of [['@/components/ui/Button',{Button:()=>null}],['@/components/ui/Input',{Input:()=>null}],['@/components/layout/AuthShell',{AuthShell:()=>null}]])mocks[name]=exports
 const wrapper=load(path,mocks).default();const content=wrapper.props.children.type();
 function find(element,predicate){if(!element||typeof element!=='object')return; if(predicate(element))return element; for(const child of [element.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found}}
 handler??=find(content,e=>e.type==='form')?.props.onSubmit
 return {handler,states,pushes,inFlight}
}
const input={email:'delivered+auth-fixture@resend.dev',password:'Synthetic-only',full_name:'Synthetic Auth'}
for(const user of [{id:'fixture'},null])test(`signup without a session (${user?'user returned':'no user returned'}) goes to confirmation once`,async()=>{
 let calls=0;const f=form('src/app/(auth)/register/page.tsx',{signUp:async()=>{calls++;return {data:{user,session:null},error:null}}})
 await f.handler(input);assert.equal(calls,1);assert.deepEqual(f.pushes,[`/verify-email?email=${encodeURIComponent(input.email)}&sent=1`])
})
test('unexpected autoconfirm signup fails closed and only signs out the local session',async()=>{
 let scope;const f=form('src/app/(auth)/register/page.tsx',{signUp:async()=>({data:{user:{},session:{}},error:null}),signOut:async options=>{scope=options.scope;return {error:null}}})
 await f.handler(input);assert.equal(scope,'local');assert.deepEqual(f.pushes,[]);assert.match(f.states[1],/derzeit nicht verfügbar/)
})
test('unconfirmed login has confirmation-specific guidance, existing confirmed login keeps its destination',async()=>{
 const f=form('src/app/(auth)/login/page.tsx',{signInWithPassword:async()=>({error:{code:'email_not_confirmed'}})})
 await f.handler(input);assert.match(f.states[0],/bestätige zuerst/);assert.equal(f.states[1],input.email);assert.deepEqual(f.pushes,[])
 const existing=form('src/app/(auth)/login/page.tsx',{signInWithPassword:async()=>({error:null})},'redirect=/buyer')
 await existing.handler(input);assert.deepEqual(existing.pushes,['/buyer'])
})
test('resend blocks initial cooldown and simultaneous duplicates, resets loading on network failure',async()=>{
 let calls=0,resolve;const auth={resend:()=>{calls++;return new Promise(r=>{resolve=r})}}
 const initial=form('src/app/(auth)/verify-email/page.tsx',auth,`email=${input.email}&sent=1`)
 await initial.handler({preventDefault(){}});assert.equal(calls,0)
 const f=form('src/app/(auth)/verify-email/page.tsx',auth,`email=${input.email}`)
 const first=f.handler({preventDefault(){}});await f.handler({preventDefault(){}});assert.equal(calls,1)
 resolve({error:null});await first;assert.equal(f.inFlight.current,false);assert.equal(f.states[1],true);assert.equal(f.states[4],60)
 const offline=form('src/app/(auth)/verify-email/page.tsx',{resend:async()=>{throw Error('offline')}},`email=${input.email}`)
 await offline.handler({preventDefault(){}});assert.equal(offline.inFlight.current,false);assert.equal(offline.states[2],false);assert.match(offline.states[3],/Verbindung/)
})
test('resend rate limit has German error and preserves cooldown without claiming success',async()=>{
 const f=form('src/app/(auth)/verify-email/page.tsx',{resend:async()=>({error:{status:429}})},`email=${input.email}`)
 await f.handler({preventDefault(){}});assert.equal(f.states[1],false);assert.match(f.states[3],/warte/);assert.equal(f.states[4],60)
})
