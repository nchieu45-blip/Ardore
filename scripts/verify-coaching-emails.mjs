// Application worker with mock service/provider boundaries; no network or .env.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
const require=createRequire(import.meta.url)
function load(file,overrides={}){const mod={exports:{}};new Function('require','module','exports','process',ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText)(n=>overrides[n]??require(n),mod,mod.exports,{env:{NEXT_PUBLIC_APP_URL:'https://www.ardore-health.com'}});return mod.exports}
function fixture(options={}){
 const rows=options.rows??['individual','group'].flatMap(kind=>['cancellation','refund'].flatMap(event=>['customer','coach'].map(role=>({
  id:kind+'-'+event+'-'+role,booking_kind:kind,booking_id:kind,event_kind:event,recipient_id:role,recipient_role:role,state:'pending',payload:null,
  details:{customer_id:'customer',coach_name:'Coach <b>',title:kind==='group'?'Yoga & Ruhe':'1:1-Coaching',scheduled_at:'2026-10-30T12:00:00Z',amount_cents:250,total_refunded_cents:750}}))))
 rows.sort((a,b)=>a.id.localeCompare(b.id));const emails=[],ledger=new Map(rows.map(r=>[r.id,r]));let fail=options.fail,completeFail=options.completeFail
 const service={from(table){assert.equal(table,'coaching_email_deliveries');let states=['pending','processing'],cursor=null,limit=100,booking=null,held=false;const q={select(_,o){held=!!o?.head;return q},in(k,v){assert.equal(k,'state');states=v;return q},order(){return q},limit(n){limit=n;return q},eq(k,v){if(k==='state')held=v==='held';else booking=v;return q},gt(k,v){assert.equal(k,'id');cursor=v;return q},then(resolve,reject){const data=[...ledger.values()].filter(r=>states.includes(r.state)&&(!cursor||r.id>cursor)&&(!booking||r.booking_id===booking)).slice(0,limit).map(r=>structuredClone(r));return Promise.resolve(options.readFail?{error:{},data:null}:{data:held?null:data,error:null,count:held?[...ledger.values()].filter(r=>r.state==='held').length:null}).then(resolve,reject)}};return q},
 auth:{admin:{async getUserById(id){return {data:{user:{email:id+'@example.test',user_metadata:{full_name:id+' <script>'}}},error:options.authFail||(options.deletedCustomer&&id==='customer')?{}:null}}}},
 async rpc(name,args){const r=ledger.get(args.p_id);assert.ok(r);if(name==='claim_coaching_email'){
  if(options.claimState)return {data:{state:options.claimState}}
  if(r.state==='sent'||r.state==='processing')return {data:{state:r.state==='sent'?'sent':'busy'}}
  r.state='processing';r.token=args.p_token;r.payload??=structuredClone(args.p_payload);return {data:{state:'claimed',payload:r.payload}}
 }if(name==='complete_coaching_email'){if(completeFail)return {data:false};assert.equal(r.token,args.p_token);r.state='sent';r.payload=null;r.details={};return {data:true}}
 assert.equal(name,'fail_coaching_email');if(options.releaseFail)throw Error('PRIVATE transport');assert.equal(r.token,args.p_token);r.state='pending';return {data:true}}}
 const templates=load('src/lib/email/templates.ts',{'@/lib/features':{VIDEO_CALLS_ENABLED:true}})
 const worker=load('src/lib/coaching-emails.ts',{'@/lib/supabase/server':{createServiceClient:async()=>service},'@/lib/app-url':{appOrigin:()=> 'https://www.ardore-health.com'},'@/lib/email/templates':templates,'@/lib/email':{FROM:'Ardore <noreply@ardore-health.com>',sendEmail:async(p,o)=>{emails.push(structuredClone({payload:p,options:o}));if(typeof fail==='function'?fail(p):fail)throw Error('PRIVATE')}}})
 return {run:worker.runCoachingEmails,emails,ledger,setFail:v=>{fail=v},setCompleteFail:v=>{completeFail=v}}
}
test('all eight role/event/format variants contain truthful copy, amount, Berlin time and existing account routes',async()=>{
 const f=fixture();assert.equal((await f.run()).sent,8);assert.equal(f.emails.length,8)
 for(const {payload:p,options:o}of f.emails){assert.match(o.idempotencyKey,/^coaching-update\//);assert.match(p.text,/13:00/);assert.match(p.text,/Europe\/Berlin/);assert.doesNotMatch(p.html,/<script>|daily\.co|localhost|undefined/);assert.match(p.html,/&lt;script&gt;/)
 if(p.subject.startsWith('Erstattung')){assert.match(p.text,/2,50/);assert.match(p.text,/7,50/);assert.doesNotMatch(p.text,/Auszahlung.*erstattet/)}else{assert.match(p.text,/separate E-Mail/);assert.doesNotMatch(p.text,/wurde eine Erstattung/)}
 const coach=p.to.startsWith('coach');assert.match(p.text,coach?/Buchung von customer/:/Deine Buchung|deine Buchung/)
 assert.match(p.text,p.subject.includes('Yoga')?coach?/creator\/settings\/video-classes/:/buyer\/video-classes/:coach?/creator\/sessions/:/buyer\/sessions/)
 }
})
test('repeated workers send nothing after durable completion',async()=>{const f=fixture();await f.run();assert.equal((await f.run()).sent,0);assert.equal(f.emails.length,8)})
test('simultaneous workers obtain one lease per delivery',async()=>{const f=fixture();await Promise.all([f.run(),f.run()]);assert.equal(f.emails.length,8);assert.equal([...f.ledger.values()].filter(r=>r.state==='sent').length,8)})
for(const failure of ['provider','completion'])test(failure+' ambiguity retries the frozen payload and identical provider key',async()=>{
 const f=fixture({fail:failure==='provider',completeFail:failure==='completion'});assert.equal((await f.run()).failed,8);const first=structuredClone(f.emails);f.setFail(false);f.setCompleteFail(false);assert.equal((await f.run()).sent,8);assert.deepEqual(f.emails.slice(8),first)
})
test('recipient failure does not suppress the other recipient',async()=>{const f=fixture({fail:p=>p.to.startsWith('customer')});const r=await f.run();assert.equal(r.sent,4);assert.equal(r.failed,4)})
for(const state of ['busy','held'])test(state+' claim sends no email and is visible as failure',async()=>{const f=fixture({claimState:state});assert.equal((await f.run()).failed,8);assert.equal(f.emails.length,0)})
test('read and recipient failures cannot become successful sends',async()=>{await assert.rejects(fixture({readFail:true}).run());const f=fixture({authFail:true});assert.equal((await f.run()).failed,8);assert.equal(f.emails.length,0)})
test('booking-scoped callbacks cannot drain unrelated bookings',async()=>{const f=fixture();assert.equal((await f.run('group')).sent,4);assert.ok(f.emails.every(e=>e.payload.subject.includes('Yoga')))})
test('keyset pagination does not starve a failing first page',async()=>{const base=[...fixture().ledger.values()][0];const f=fixture({rows:Array.from({length:205},(_,i)=>({...structuredClone(base),id:String(i).padStart(4,'0')})),fail:true});assert.equal((await f.run()).failed,205);assert.equal(f.emails.length,205)})

test('a deleted customer does not prevent coach notices',async()=>{const f=fixture({deletedCustomer:true});const r=await f.run();assert.equal(r.sent,4);assert.equal(r.failed,4);assert.ok(f.emails.every(e=>e.payload.to.startsWith('coach')));assert.ok(f.emails.every(e=>e.payload.text.includes('Kunde')))})
test('a release transport failure does not abort other recipients',async()=>{const f=fixture({fail:true,releaseFail:true});const r=await f.run();assert.equal(r.failed,8);assert.equal(f.emails.length,8)})
