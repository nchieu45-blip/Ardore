// Real application functions, synthetic service boundaries; no network or .env.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const NOW = new Date('2026-10-27T08:00:00Z')
const row = (changes = {}) => ({ video_class_id: 'class', occurrence_start: '2026-10-27T17:00:00Z',
  recipient_id: 'buyer', recipient_role: 'participant', class_title: 'Yoga & Entspannung', duration_minutes: 45,
  coach_name: 'Testcoach', ...changes })
function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function('require','module','exports','process',code)(name => overrides[name] ?? require(name), mod, mod.exports,
    { env: { CRON_SECRET: 'test-cron' } })
  return mod.exports
}
function fixture(options = {}) {
  const rows = options.rows ?? [row(), row({ recipient_id: 'coach', recipient_role: 'coach' })]
  const ledger = new Map(), emails = [], queries = [], rpc = [], auth = []
  let eligibilityCalls = 0, failure = options.failure, completionFailure = options.completionFailure
  const service = { from(table) {
    assert.equal(table, 'group_reminder_recipients')
    let start = 0, end = Infinity
    const q = { select(fields) { queries.push(fields); return q }, gt(k,v) { assert.equal(k,'occurrence_start'); assert.equal(v,NOW.toISOString()); return q },
      lte(k,v) { assert.equal(k,'occurrence_start'); assert.equal(v,'2026-10-28T08:00:00.000Z'); return q }, order() { return q },
      range(a,b) { start=a; end=b; return q }, then(resolve,reject) { return Promise.resolve(options.readFailure
        ? { data: null, error: new Error('PRIVATE') } : { data: rows.slice(start,end+1), error: null }).then(resolve,reject) } }
    return q
  }, auth: { admin: { async getUserById(id) { auth.push(id); return { data: { user: { email: id+'@example.test', user_metadata: { full_name: '<b>'+id+'</b>' } } }, error: options.authFailure ? {} : null } } } },
  async rpc(name,args) {
    rpc.push({ name,args })
    if(name==='group_reminder_is_eligible') { eligibilityCalls++; return { data: typeof options.eligible==='function' ? options.eligible(eligibilityCalls) : options.eligible ?? true, error: options.eligibilityFailure ? {} : null } }
    if(name==='claim_group_reminder') {
      if(options.claimState) return { data: { state: options.claimState } }
      const key=[args.p_class_id,args.p_occurrence,args.p_recipient_id].join('|')
      let d=ledger.get(key)
      if(d?.state==='sent'||d?.state==='processing')return { data: { state: d.state==='sent'?'sent':'busy' } }
      if(!d){ d={id:'delivery-'+ledger.size,payload:structuredClone(args.p_payload),state:'pending'}; ledger.set(key,d) }
      d.state='processing';d.token=args.p_token
      return { data: { state:'claimed',id:d.id,payload:d.payload } }
    }
    const d=[...ledger.values()].find(d=>d.id===args.p_id);assert.ok(d)
    if(name==='complete_group_reminder') { if(completionFailure)return { data:false };d.state='sent'; return { data:true } }
    assert.equal(name,'fail_group_reminder');d.state='pending';return { data:true }
  } }
  const templates = load('src/lib/email/templates.ts', { '@/lib/features': { VIDEO_CALLS_ENABLED:true } })
  const lib = load('src/lib/group-session-reminders.ts', {
    '@/lib/supabase/server': { createServiceClient: async()=>service }, '@/lib/app-url': { appOrigin:()=> 'https://www.ardore-health.com' },
    '@/lib/email/templates': templates, '@/lib/email': { FROM:'Ardore <noreply@ardore-health.com>', sendEmail:async(payload,options)=>{
      emails.push({payload:structuredClone(payload),options});if(options?.idempotencyKey===undefined)throw Error('Missing provider idempotency');
      if(typeof failure==='function'?failure(payload):failure)throw Error('PRIVATE provider data')
    } },
  })
  return { run:()=>lib.runGroupSessionReminders(NOW), emails, ledger, queries, rpc, auth,
    setFailure:v=>{failure=v},setCompletionFailure:v=>{completionFailure=v} }
}
test('participant and coach receive role-specific Berlin occurrence details and protected links',async()=>{
  const f=fixture();const r=await f.run();assert.equal(r.sent,2);assert.equal(r.failed,0);assert.equal(f.emails.length,2)
  for(const {payload,options}of f.emails){assert.match(payload.subject,/18:00/);assert.match(payload.text,/Europe\/Berlin/);assert.match(payload.text,/45 Minuten/)
    assert.match(payload.text,/group-session\/class\?occurrenceStart=2026-10-27T17%3A00%3A00Z/);assert.match(options.idempotencyKey,/^group-reminder\/delivery-/)
    assert.doesNotMatch(payload.html,/<b>buyer|<b>coach/);assert.match(payload.html,/&lt;b&gt;/);assert.doesNotMatch(payload.html,/daily\.co|meeting-token|127\.0\.0\.1/)}
  assert.match(f.emails[0].payload.text,/Gruppencoaching mit Testcoach/);assert.match(f.emails[1].payload.text,/Dein Gruppentermin/)
})
test('durable sent claims suppress all duplicate provider calls on repeated job',async()=>{
  const f=fixture();await f.run();const repeat=await f.run();assert.equal(repeat.sent,0);assert.equal(repeat.skipped,2);assert.equal(f.emails.length,2)
})
test('failed email retries frozen payload under the same provider idempotency key',async()=>{
  const f=fixture({rows:[row()],failure:true});assert.equal((await f.run()).failed,1);f.setFailure(false);assert.equal((await f.run()).sent,1)
  assert.deepEqual(f.emails[0],f.emails[1])
})
test('provider success followed by DB completion failure retains identical retry identity',async()=>{
  const f=fixture({rows:[row()],completionFailure:true});assert.equal((await f.run()).failed,1);f.setCompletionFailure(false);assert.equal((await f.run()).sent,1)
  assert.deepEqual(f.emails[0],f.emails[1])
})
test('one failed recipient does not suppress the remaining recipient',async()=>{
  const f=fixture({failure:p=>p.to==='buyer@example.test'});const r=await f.run();assert.equal(r.failed,1);assert.equal(r.sent,1);assert.equal(f.emails.length,2)
})
test('cancellation or opt-out after claim releases it without sending',async()=>{
  const f=fixture({rows:[row()],eligible:n=>n===1});const r=await f.run();assert.equal(r.sent,0);assert.equal(r.skipped,1);assert.equal(f.emails.length,0);assert.ok(f.rpc.some(x=>x.name==='fail_group_reminder'))
})
test('ineligible candidates do not read email addresses or obtain a delivery claim',async()=>{
  const f=fixture({eligible:false});assert.equal((await f.run()).skipped,2);assert.equal(f.auth.length,0);assert.equal(f.rpc.filter(x=>x.name==='claim_group_reminder').length,0)
})
for(const state of ['busy','held'])test(state+' claims fail visibly without SMTP',async()=>{
  const f=fixture({claimState:state});const r=await f.run();assert.equal(r.failed,2);assert.equal(r[state],2);assert.equal(f.emails.length,0)
})
test('candidate and eligibility read failures do not become successful empty/sent results',async()=>{
  await assert.rejects(fixture({readFailure:true}).run(),/group_reminder_read_failed/)
  const f=fixture({eligibilityFailure:true});assert.equal((await f.run()).failed,2);assert.equal(f.emails.length,0)
})
test('pagination includes more than one candidate page',async()=>{
  const f=fixture({rows:Array.from({length:205},(_,i)=>row({recipient_id:'buyer-'+i}))});assert.equal((await f.run()).sent,205);assert.equal(f.queries.length,2)
})
test('the existing authenticated cron runs both kinds even if one fails and leaks no details',async()=>{
  for(const fail of ['individual','group',null]){
    const calls=[];const good={sent:1,skipped:0,failed:0,legacySkipped:0,busy:0,held:0}
    const invoke=async kind=>{calls.push(kind);if(fail===kind)throw Error('PRIVATE');return good}
    const api=load('src/app/api/cron/session-reminders/route.ts',{
      '@/lib/session-cron':{runSessionNotifications:()=>invoke('individual')},'@/lib/group-session-reminders':{runGroupSessionReminders:()=>invoke('group')},
      '@/lib/cron':{isCronAuthorized:r=>r.headers.get('authorization')==='Bearer test-cron',cronJson:(body,status=200)=>Response.json(body,{status})},
    })
    assert.equal((await api.GET(new Request('https://example.test'))).status,401);assert.equal(calls.length,0)
    const r=await api.GET(new Request('https://example.test',{headers:{authorization:'Bearer test-cron'}}));assert.equal(r.status,fail?503:200);assert.deepEqual(calls,['individual','group']);const body=await r.json();assert.equal(body.sent,fail?1:2);assert.equal(body.failed,fail?1:0);assert.doesNotMatch(JSON.stringify(body),/PRIVATE/)
  }
})
