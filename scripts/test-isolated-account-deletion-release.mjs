// Explicitly opted-in, disposable LOCAL Supabase clone. No production credentials,
// customer rows, Stripe calls or external email. Auth fixtures use GoTrue only.
import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'

if (!process.argv.includes('--run-isolated')) {
  console.log('Opt in with --run-isolated. Creates/removes only its own local database and loopback service containers.')
  process.exit(0)
}
const repo = resolve(new URL('..', import.meta.url).pathname)
const legacyBaseline = 'ceea6d43f5aa2a85e9a5fcfeb2f3a201184e26a1'
const require = createRequire(import.meta.url)
const id = randomBytes(6).toString('hex'), database = `ardore_delete_release_test_${id}`
const root = mkdtempSync(join(tmpdir(), 'ardore-delete-release-')); chmodSync(root, 0o700)
const docker = ['--context', 'colima-ardore-test'], dbContainer = 'supabase_db_ardore-local-test'
const owned = [], envFiles = [], checks = [], pendingLegacyRequests = []
let created = false, proxy, releaseLegacy, releaseLegacyMail, stage = 'inspect', failure = false
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { cwd: repo, input, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('Local subprocess failed; raw output suppressed')
  return r.stdout
}
const inspect = name => JSON.parse(run('docker', [...docker, 'inspect', name]))[0]
const sqlArgs = db => [...docker, 'exec', '-i', dbContainer, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-d', db]
const sql = (text, db = database) => run('docker', sqlArgs(db), text).trim()
const record = name => { checks.push(name); console.log(JSON.stringify({ check: name, passed: true })) }
const result = r => { assert.equal(r.error, null, 'Local fixture request failed'); return r.data }
const wait = ms => new Promise(r => setTimeout(r, ms))
function load(source, modules) {
  const mod = { exports: {} }
  new Function('require', 'exports', 'module', 'console', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(name => {
    assert.ok(name in modules, 'Unapproved external import in isolated deletion test')
    return modules[name]
  }, mod.exports, mod, { error() {} })
  return mod.exports
}
const source = path => readFileSync(join(repo, path), 'utf8')
const repairFiles = ['20261018120029_guard_account_storage_deletion.sql',
  '20261019131618_scope_public_view_projections.sql', '20261023090520_account_deletion_write_barrier.sql']

try {
  const original = inspect(dbContainer)
  assert.equal(original.Name, '/'+dbContainer); assert.equal(original.State.Running, true)
  assert.equal(original.HostConfig.NetworkMode, 'ardore-local-loopback')
  const originalUsers = sql('SELECT count(*) FROM auth.users;', 'postgres')
  assert.equal(sql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`, 'postgres'), '0')
  stage = 'schema_clone'
  // Schema and service migration VERSION metadata only; no application/Auth data.
  const schema = run('docker', [...docker, 'exec', dbContainer, 'pg_dump', '-U', 'postgres', '--schema-only', '--no-publications', '-d', 'postgres'])
  const metadata = run('docker', [...docker, 'exec', dbContainer, 'pg_dump', '-U', 'postgres', '--data-only', '--table=auth.schema_migrations', '--table=storage.migrations', '-d', 'postgres'])
  sql('CREATE DATABASE '+database+' OWNER postgres;', 'postgres'); created = true
  sql(schema); sql(metadata)
  assert.equal(sql('SELECT count(*) FROM auth.users;'), '0')
  record('new_schema_only_database_contains_no_copied_auth_or_customer_rows')
  // The existing local fixture schema already has the three pending repairs.
  // Remove ONLY their artifacts in this empty disposable clone to rehearse the
  // production apply order (new gate FIRST). The three review views are absent
  // until their exact migration recreates them; this is not a production dump.
  const repairNames=[...new Set(repairFiles.flatMap(f=>[...source('supabase/migrations/'+f)
    .matchAll(/CREATE(?: OR REPLACE)? FUNCTION ([a-z_]+\.[a-z_]+)/g)].map(m=>m[1])))]
  assert.ok(repairNames.every(n=>/^(private|public)\.[a-z_]+$/.test(n)))
  sql(`DO $$ DECLARE target regprocedure; BEGIN LOOP
    SELECT p.oid::regprocedure INTO target FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname||'.'||p.proname IN (${repairNames.map(n=>"'"+n+"'").join(',')}) LIMIT 1;
    EXIT WHEN NOT FOUND; EXECUTE format('DROP FUNCTION %s CASCADE',target); END LOOP; END; $$;
    DROP TABLE private.account_deletion_barriers;`)
  assert.equal(sql("SELECT to_regprocedure('public.begin_account_deletion(uuid)') IS NULL;"),'t')
  record('disposable_baseline_has_no_pending_deletion_rpcs_or_barrier_before_gate_installation')

  stage = 'local_services'
  const envs = {}
  const names = { auth: `ardore-delete-release-auth-${id}`, rest: `ardore-delete-release-rest-${id}`, storage: `ardore-delete-release-storage-${id}` }
  for (const kind of ['auth', 'rest', 'storage']) {
    const originalName = { auth: 'supabase_auth_ardore-local-test', rest: 'supabase_rest_ardore-local-test', storage: 'supabase_storage_ardore-local-test' }[kind]
    const d = inspect(originalName), env = Object.fromEntries(d.Config.Env.map(v => { const i=v.indexOf('='); return [v.slice(0,i),v.slice(i+1)] }))
    const dbField = { auth: 'GOTRUE_DB_DATABASE_URL', rest: 'PGRST_DB_URI', storage: 'DATABASE_URL' }[kind]
    assert.ok(env[dbField]?.includes('supabase_') || env[dbField]?.includes('postgres'), 'Expected local DB configuration')
    env[dbField] = env[dbField].replace(/\/[^/?]+(?=\?|$)/, '/'+database)
    if (kind === 'auth') Object.assign(env, { GOTRUE_SITE_URL: 'http://127.0.0.1:3011', API_EXTERNAL_URL: 'http://127.0.0.1:55141', GOTRUE_URI_ALLOW_LIST: 'http://127.0.0.1:3011/**', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_JWT_ISSUER: 'http://127.0.0.1:55141/auth/v1' })
    if (kind === 'storage') Object.assign(env, { POSTGREST_URL: `http://${names.rest}:3000`, STORAGE_BACKEND: 'file', FILE_STORAGE_BACKEND_PATH: '/var/lib/storage' })
    envs[kind] = env
    const path = join(root, kind+'.env'); writeFileSync(path, Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n', { mode: 0o600 }); envFiles.push(path)
    const port = { auth: 55142, rest: 55143, storage: 55144 }[kind], inside = { auth: 9999, rest: 3000, storage: 5000 }[kind]
    const args = [...docker, 'run', '-d', '--name', names[kind], '--label', `ardore.delete-release-test=${id}`, '--network', 'ardore-local-loopback', '--env-file', path, '-p', `127.0.0.1:${port}:${inside}`]
    if (kind === 'storage') args.push('--tmpfs', '/var/lib/storage:rw')
    args.push(d.Config.Image); run('docker', args); owned.push(names[kind])
  }
  proxy = createServer((req, res) => {
    const match = /^\/(auth|rest|storage)\/v1(?=\/|\?|$)/.exec(req.url || '')
    if (!match) { res.writeHead(404).end(); return }
    const port = { auth: 55142, rest: 55143, storage: 55144 }[match[1]]
    const upstream = httpRequest({ hostname: '127.0.0.1', port, method: req.method,
      path: req.url.slice(match[0].length) || '/', headers: { ...req.headers, host: '127.0.0.1:'+port } }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(503); res.end() }); req.pipe(upstream)
  })
  await new Promise((ok, no) => { proxy.once('error', no); proxy.listen(55141, '127.0.0.1', ok) })
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const jwt = role => { const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:'supabase',role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}); return token+'.'+createHmac('sha256',envs.auth.GOTRUE_JWT_SECRET).update(token).digest('base64url') }
  const anonKey=jwt('anon'), serviceKey=jwt('service_role'), url='http://127.0.0.1:55141'
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const legacy = createClient(url,serviceKey,options)
  const modern = createClient(url,serviceKey,{ ...options, global: { headers: { 'X-Ardore-Service-Protocol': 'v2', 'X-Ardore-Account-Deletion-Protocol': 'v2' } } })
  const currentApp = createClient(url,serviceKey,{ ...options, global: { headers: { 'X-Ardore-Service-Protocol': 'v2' } } })
  for (let n=0;n<80;n++) { if (!(await legacy.from('profiles').select('id').limit(1)).error) break; if(n===79) throw new Error('Local services not ready'); await wait(100) }
  const actors = []
  async function user(label) {
    const email=`release.${label}.${id}@example.invalid`, password=randomUUID()
    const data=result(await legacy.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'LOCAL '+label,local_deletion_release:id}}))
    const client=createClient(url,anonKey,options); result(await client.auth.signInWithPassword({email,password}))
    const actor={ id:data.user.id,email,client }; actors.push(actor); return actor
  }
  const coach=await user('coach')
  const profile=result(await legacy.from('creator_profiles').insert({user_id:coach.id,display_name:'Local release coach',slug:'release-'+id,category:'fitness',categories:['fitness'],is_published:true,onboarding_step:5}).select('id').single())
  const tier=result(await legacy.from('subscription_tiers').insert({creator_id:profile.id,name:'LOCAL release',price_monthly:1,is_active:false}).select('id').single())
  const stale=await user('legacy-in-flight')
  const subscription=result(await legacy.from('subscriptions').insert({buyer_id:stale.id,creator_id:profile.id,tier_id:tier.id,stripe_subscription_id:'sub_localRelease'+id,stripe_livemode:false,status:'active',current_period_end:'2099-01-01T00:00:00Z'}).select('id').single())
  const legacyBooking=result(await legacy.from('bookings').insert({creator_id:profile.id,buyer_id:stale.id,
    scheduled_at:new Date(Date.now()+2*86400000).toISOString(),duration_minutes:30,status:'confirmed',
    price_cents:0,payment_status:'not_required',buyer_email:stale.email,buyer_name:'LOCAL legacy recipient'}).select('id').single())
  const missing=await user('missing-profile')
  sql(`DELETE FROM public.profiles WHERE id='${missing.id}';`) // LOCAL historical partial-delete fixture, never auth.users SQL.

  const legacySource=run('git',['show',legacyBaseline+':src/app/api/account/delete/route.ts'],undefined)
  let cancels=0, enteredResolve
  const entered=new Promise(r=>{enteredResolve=r}), pending=new Promise(r=>{releaseLegacy=r})
  const oldRoute=load(legacySource,{
    'next/server':require('next/server'), '@/lib/supabase/server':{createClient:async()=>stale.client,createServiceClient:async()=>legacy},
    '@/lib/stripe/server':{stripe:{subscriptions:{cancel:async()=>{cancels++;enteredResolve();await pending;return {status:'canceled'}}}}},
  })
  const oldRequest=oldRoute.POST()
  pendingLegacyRequests.push(oldRequest)
  await Promise.race([entered,wait(5000).then(()=>{throw new Error('Legacy request did not reach intended local boundary')})])
  record('actual_legacy_route_is_paused_after_preflight_inside_simulated_provider_call')
  let mailEnteredResolve, oldMailRevoked=false, oldProviderRevoked=false, mailAttempts=0, acceptedLegacyMail=0, lateProviderAttempts=0
  const mailEntered=new Promise(r=>{mailEnteredResolve=r}), pendingMail=new Promise(r=>{releaseLegacyMail=r})
  const oldMail=async()=>{mailAttempts++;mailEnteredResolve();await pendingMail;if(oldMailRevoked)throw new Error('Retired LOCAL mail credential');acceptedLegacyMail++}
  const oldCoachRoute=load(legacySource,{
    'next/server':require('next/server'),'@/lib/supabase/server':{createClient:async()=>coach.client,createServiceClient:async()=>legacy},
    '@/lib/email/send':{sendBookingCancelledNotice:oldMail,sendSubscriptionCancelledNotice:oldMail},
    '@/lib/stripe/server':{stripe:{subscriptions:{cancel:async()=>{lateProviderAttempts++;if(oldProviderRevoked)throw new Error('Retired LOCAL Stripe credential');return {status:'canceled'}}}}},
  })
  const oldCoachRequest=oldCoachRoute.POST()
  pendingLegacyRequests.push(oldCoachRequest)
  await Promise.race([mailEntered,wait(5000).then(()=>{throw new Error('Legacy coach did not reach intended local mail boundary')})])
  record('actual_legacy_coach_is_paused_before_simulated_email_acceptance')

  stage='gate_lock_timeout'
  const gate=source('supabase/migrations/20261029005756_account_deletion_release_gate.sql')
  sql(`ALTER ROLE authenticator IN DATABASE ${database} SET pgrst.db_pre_request='public.existing_security_hook';`)
  const existingHook=spawnSync('docker',sqlArgs(database),{input:'SET ROLE postgres;\n'+gate,encoding:'utf8',timeout:35000})
  assert.notEqual(existingHook.status,0)
  assert.equal(sql(`SELECT count(*) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) item WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname='${database}') AND item='pgrst.db_pre_request=public.existing_security_hook';`),'1')
  assert.equal(sql("SELECT to_regclass('private.account_deletion_release') IS NULL;"),'t')
  sql(`ALTER ROLE authenticator IN DATABASE ${database} RESET pgrst.db_pre_request;`)
  record('migration_refuses_to_replace_an_existing_request_hook_and_preserves_its_configuration')
  const blocker=spawn('docker',sqlArgs(database),{stdio:['pipe','pipe','pipe']}); let locked=''
  blocker.stdout.on('data',c=>{locked+=c});blocker.stderr.on('data',()=>{})
  blocker.stdin.write("BEGIN; LOCK TABLE public.messages IN ROW EXCLUSIVE MODE; SELECT 'LOCKED';\n")
  for(let n=0;!locked.includes('LOCKED');n++){assert.ok(n<80);await wait(25)}
  const blocked=spawnSync('docker',sqlArgs(database),{input:'SET ROLE postgres;\n'+gate,encoding:'utf8',timeout:35000,maxBuffer:1024*1024})
  blocker.stdin.end('ROLLBACK;\n\\q\n');await new Promise(r=>blocker.on('close',r))
  if(!/55P03/.test(blocked.stderr)) console.log(JSON.stringify({localGateFailureSqlstates:[...new Set(blocked.stderr.match(/\b[0-9A-Z]{5}\b/g)||[])]}))
  assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/55P03/)
  assert.equal(sql("SELECT to_regclass('private.account_deletion_release') IS NULL;"),'t')
  record('contended_gate_migration_times_out_and_rolls_back_every_guard_atomically')

  stage='install_closed_gate';sql('SET ROLE postgres;\n'+gate)
  for(let n=0;n<80;n++){
    const status=await modern.rpc('account_deletion_release_ready')
    const head=await legacy.from('group_booking_reservations').select('id',{count:'exact',head:true})
    if(!status.error&&status.data===false&&head.status===503)break
    if(n===79)throw new Error('Request hook reload not confirmed');await wait(100)
  }
  record('real_postgrest_hook_blocks_unmarked_legacy_head_before_any_new_provider_call')
  const groupClaim={p_class_id:randomUUID(),p_occurrence:new Date().toISOString(),p_recipient_id:randomUUID(),p_role:'participant',p_payload:{},p_token:randomUUID()}
  for(const [name,args] of [
    ['claim_coaching_email',{p_id:randomUUID(),p_payload:{},p_token:randomUUID()}],
    ['claim_group_reminder',groupClaim],
    ['claim_current_group_reminder',{...groupClaim,p_expected_start:groupClaim.p_occurrence}],
    ['claim_session_notification',{p_booking_id:randomUUID(),p_recipient_id:randomUUID(),p_type:'reminder',p_channel:'email',p_occurrence:groupClaim.p_occurrence,p_payload:{},p_token:randomUUID()}],
  ]) assert.equal((await modern.rpc(name,args)).error?.code,'PT503')
  record('all_four_durable_notification_claim_endpoints_are_paused_during_provider_handover')
  for(const name of ['complete_coaching_email','fail_coaching_email','complete_group_reminder','fail_group_reminder','complete_session_notification','fail_session_notification']) {
    const previous=await modern.rpc(name,{p_id:randomUUID(),p_token:randomUUID()})
    assert.equal(previous.error,null);assert.equal(previous.data,false)
  }
  record('existing_delivery_completion_and_failure_endpoints_remain_available_during_claim_pause')
  oldMailRevoked=true;oldProviderRevoked=true;releaseLegacyMail();releaseLegacy()
  const [oldResponse,oldCoachResponse]=await Promise.all([oldRequest,oldCoachRequest])
  assert.equal(oldResponse.status,500);assert.equal(oldCoachResponse.status,500)
  assert.ok(result(await legacy.auth.admin.getUserById(stale.id)).user)
  assert.equal(result(await modern.from('subscriptions').select('id').eq('id',subscription.id).single()).id,subscription.id)
  assert.equal(result(await modern.from('profiles').select('id').eq('id',stale.id).single()).id,stale.id)
  record('already_admitted_legacy_request_cannot_remove_auth_profile_or_subscription_after_gate')
  assert.ok(mailAttempts>0);assert.equal(acceptedLegacyMail,0);assert.ok(lateProviderAttempts>0)
  assert.ok(result(await legacy.auth.admin.getUserById(coach.id)).user)
  assert.equal(result(await modern.from('bookings').select('id').eq('id',legacyBooking.id).single()).id,legacyBooking.id)
  record('retired_simulated_provider_credentials_reject_late_coach_email_and_stripe_work_without_erasing_accounts')
  assert.equal(cancels,1)
  record('provider_effect_accepted_before_gate_is_not_claimed_to_be_undone_and_requires_reconciliation')
  const rejected=await oldRoute.POST();assert.equal(rejected.status,500);assert.equal(cancels,1)
  record('rollback_to_actual_legacy_route_is_rejected_before_stripe')
  const tables=['profiles','availability_slots','bookings','coaching_offers','creator_profiles','date_overrides','messages','products','purchases','reviews','subscription_tiers','subscriptions']
  for(const table of tables){const r=await legacy.from(table).delete().eq('id',randomUUID());assert.equal(r.error?.code,'55000')}
  assert.equal((await modern.from('messages').delete().eq('id',randomUUID())).error?.code,'55000')
  record('all_twelve_legacy_rest_delete_targets_reject_even_empty_or_protocol_marked_deletes')
  assert.ok((await legacy.auth.admin.deleteUser(missing.id)).error)
  assert.ok(result(await legacy.auth.admin.getUserById(missing.id)).user)
  record('auth_validation_protects_even_an_account_with_an_already_missing_profile')
  assert.equal((await createClient(url,anonKey,options).rpc('account_deletion_release_ready')).error?.code,'42501')
  record('browser_role_cannot_read_or_enable_the_private_release_switch')
  stage='normal_group_reads'
  assert.equal((await legacy.from('group_booking_reservations').select('id').limit(1)).error,null)
  stage='public_coach_discovery'
  const anonymous=createClient(url,anonKey,options)
  assert.equal((await anonymous.from('creator_profiles').select('id,display_name').eq('id',profile.id)).error,null)
  assert.ok((await anonymous.from('public_profiles').select('*').limit(1)).error, 'Private chat-profile directory stays protected')
  stage='authenticated_owner_crud'
  const disposableTier=result(await currentApp.from('subscription_tiers').insert({creator_id:profile.id,name:'LOCAL disposable tier',price_monthly:1,is_active:false}).select('id').single())
  assert.equal((await coach.client.from('subscription_tiers').delete().eq('id',disposableTier.id)).error,null)
  assert.equal(result(await legacy.from('subscription_tiers').select('id').eq('id',disposableTier.id).maybeSingle()),null)
  record('normal_unmarked_group_reads_public_discovery_and_authenticated_owner_crud_still_work')
  for(const table of ['profiles','creator_profiles','subscriptions','bookings']) {
    assert.equal((await legacy.from(table).select('id').limit(1)).status,503)
    assert.equal((await currentApp.from(table).select('id').limit(1)).error,null)
  }
  record('retired_builds_cannot_read_deletion_inputs_but_current_service_clients_can')

  const entitlement=load(source('src/lib/subscription-entitlement.ts'),{})
  const cancellation=load(source('src/lib/subscription-cancellation.ts'),{'@/lib/subscription-entitlement':entitlement})
  const {deleteAccountSafely}=load(source('src/lib/account-deletion.ts'),{'server-only':{},'@/lib/subscription-cancellation':cancellation})
  const clean=await user('modern-empty');let providerCalls=0
  const providerForbidden=async()=>{providerCalls++;throw new Error('Real provider forbidden')}
  await assert.rejects(deleteAccountSafely({service:modern,userId:clean.id,getProvider:providerForbidden}),e=>e.status===503)
  assert.equal(providerCalls,0);assert.equal(sql("SELECT to_regclass('private.account_deletion_barriers') IS NULL;"),'t')
  record('new_application_with_closed_gate_stops_before_barrier_and_provider')

  const activation=source('supabase/migrations/20261029014533_enable_account_deletion_protocol.sql')
  const earlyActivation=spawnSync('docker',sqlArgs(database),{input:'SET ROLE postgres;\n'+activation,encoding:'utf8',timeout:35000})
  assert.notEqual(earlyActivation.status,0)
  assert.equal(sql('SELECT NOT enabled AND notification_dispatch_paused FROM private.account_deletion_release;'),'t')
  record('activation_refuses_missing_repairs_without_resuming_deletion_or_notification_claims')

  stage='apply_exact_pending_repairs_under_closed_gate'
  for(const file of repairFiles)sql('SET ROLE postgres;\n'+source('supabase/migrations/'+file))
  sql("NOTIFY pgrst,'reload schema';")
  for(let n=0;n<80;n++){
    const pending=await modern.rpc('begin_account_deletion',{p_user_id:null})
    if(pending.error?.code==='PT503')break
    if(n===79)throw new Error('Pending repair schema cache not ready');await wait(100)
  }
  assert.equal(result(await modern.rpc('account_deletion_release_ready')),false)
  record('all_three_unchanged_repairs_apply_after_the_closed_gate_and_do_not_reopen_deletion')
  stage='enable_only_local_gate';sql('SET ROLE postgres;\n'+activation)
  assert.equal(sql('SELECT enabled AND NOT notification_dispatch_paused FROM private.account_deletion_release;'),'t')
  record('exact_separate_activation_migration_checks_prerequisites_and_resumes_the_new_protocol')
  await assert.rejects(deleteAccountSafely({service:legacy,userId:clean.id,getProvider:providerForbidden}),e=>e.status===503)
  assert.equal(providerCalls,0)
  record('unmarked_service_client_cannot_start_the_new_deletion_protocol')
  const concurrent=await Promise.allSettled(Array.from({length:4},()=>deleteAccountSafely({service:modern,userId:clean.id,getProvider:providerForbidden})))
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1)
  assert.equal((await legacy.auth.admin.getUserById(clean.id)).error?.code,'user_not_found')
  record('enabled_new_protocol_deletes_exactly_once_through_real_gotrue_with_four_parallel_calls')
  assert.equal((await oldRoute.POST()).status,500);assert.equal(cancels,1)
  record('legacy_rollback_remains_blocked_after_new_protocol_is_enabled')
  const history=run('git',['log','--reverse','--format=%H',legacyBaseline,'--','src/app/api/account/delete/route.ts']).trim().split('\n')
  const seenLegacy=new Set()
  for(const revision of history){
    const oldSource=run('git',['show',revision+':src/app/api/account/delete/route.ts'])
    const digest=createHash('sha256').update(oldSource).digest('hex');if(seenLegacy.has(digest))continue;seenLegacy.add(digest)
    let freshKeyEffects=0,oldClientUsed=0
    const old=load(oldSource,{
      'next/server':require('next/server'),'@/lib/supabase/server':{createClient:async()=>stale.client,createServiceClient:async()=>{oldClientUsed++;return legacy}},
      '@/lib/stripe/server':{stripe:{subscriptions:{cancel:async()=>{freshKeyEffects++;return {status:'canceled'}}}}},
      '@/lib/email/send':{sendBookingCancelledNotice:async()=>{freshKeyEffects++},sendSubscriptionCancelledNotice:async()=>{freshKeyEffects++}},
    })
    await old.POST();assert.ok(oldClientUsed>0);assert.equal(freshKeyEffects,0)
    assert.ok(result(await modern.auth.admin.getUserById(stale.id)).user)
  }
  record('all_'+seenLegacy.size+'_historical_handlers_with_simulated_fresh_provider_keys_cannot_cancel_or_email')
  const fenced=await user('fenced-auth'),foreign=await user('foreign-unarmed')
  const attempt=result(await modern.rpc('begin_account_deletion',{p_user_id:fenced.id}))
  assert.equal(result(await modern.rpc('mark_account_deletion_auth',{p_user_id:fenced.id,p_attempt_id:attempt})),true)
  assert.ok((await legacy.auth.admin.deleteUser(foreign.id)).error)
  assert.ok(result(await legacy.auth.admin.getUserById(foreign.id)).user)
  record('an_armed_account_cannot_authorize_auth_deletion_of_another_account')
  sql('UPDATE private.account_deletion_release SET enabled=false WHERE singleton;')
  assert.ok((await legacy.auth.admin.deleteUser(fenced.id)).error)
  assert.ok(result(await legacy.auth.admin.getUserById(fenced.id)).user)
  sql('UPDATE private.account_deletion_release SET enabled=true WHERE singleton;')
  record('database_pause_blocks_even_a_previously_armed_auth_request')
  sql('ALTER TABLE private.account_deletion_barriers RENAME TO local_hidden_deletion_barriers;')
  try { assert.ok((await legacy.auth.admin.deleteUser(fenced.id)).error);assert.ok(result(await legacy.auth.admin.getUserById(fenced.id)).user) }
  finally { sql('ALTER TABLE private.local_hidden_deletion_barriers RENAME TO account_deletion_barriers;') }
  record('missing_barrier_table_never_authorizes_auth_deletion')
  sql(`UPDATE private.account_deletion_barriers SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id='${fenced.id}';`)
  assert.ok((await legacy.auth.admin.deleteUser(fenced.id)).error)
  record('expired_auth_arm_never_authorizes_a_late_delete')
  assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='private.account_deletion_release'::regclass;"),'t')
  assert.equal(sql("SELECT NOT has_table_privilege('service_role','private.account_deletion_release','UPDATE') AND NOT has_table_privilege('authenticated','private.account_deletion_release','SELECT') AND NOT has_function_privilege('anon','public.begin_account_deletion(uuid)','EXECUTE');"),'t')
  assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname IN ('require_account_deletion_protocol','reject_legacy_account_row_deletes') AND tgenabled='O';"),'13')
  record('release_control_rls_service_only_lifecycle_and_all_thirteen_validation_triggers_are_enforced')

  stage='full_existing_integration_suite'
  const fixtureEnv=join(root,'.env.local');writeFileSync(fixtureEnv,`NEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}\nSUPABASE_SERVICE_ROLE_KEY=${serviceKey}\nNEXT_PUBLIC_APP_URL=http://127.0.0.1:3011\n`,{mode:0o600});envFiles.push(fixtureEnv)
  const child=spawn(process.execPath,[join(repo,'scripts/test-local-view-security.mjs'),'--local','--fixture-env',fixtureEnv,'--isolated-database',database,'--parallel','--report',join(root,'integration.json')],{cwd:repo,env:Object.fromEntries(['PATH','HOME','USER','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',c=>{for(const line of c.toString().split('\n'))if(line.startsWith('{"check"')||line.startsWith('{"checks"'))process.stdout.write(line+'\n')});child.stderr.on('data',()=>{})
  assert.equal(await new Promise(r=>child.on('close',r)),0,'Full isolated integration suite failed')
  const integration=JSON.parse(readFileSync(join(root,'integration.json'),'utf8'));assert.equal(integration.blockers.length,0)
  record('existing_full_group_stripe_fault_email_and_write_race_suite_passes_with_release_gate_active')
  assert.equal(sql('SELECT count(*) FROM auth.users;','postgres'),originalUsers)
  record('original_local_database_and_its_three_auth_fixtures_are_unchanged')
  writeFileSync(join(root,'report.json'),JSON.stringify({checks,fullIntegrationChecks:integration.results.length,productionAccess:false,realStripeCalls:false,realEmails:false,limitation:'Accepted historical Stripe/Resend effects require reconciliation and retirement of old provider credentials before production reopening.'},null,2)+'\n',{mode:0o600})
  console.log(JSON.stringify({releaseChecks:checks.length,integrationChecks:integration.results.length,report:join(root,'report.json'),productionAccess:false}))
}catch(error){failure=true;console.log(JSON.stringify({failed:true,stage,reason:error instanceof assert.AssertionError?'assertion_failed':'local_setup_or_test_failed',rawOutputSuppressed:true}));process.exitCode=1}
finally{
  releaseLegacy?.();releaseLegacyMail?.()
  await Promise.race([Promise.allSettled(pendingLegacyRequests),wait(5000)])
  if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r))}
  for(const name of owned.reverse()){
    const d=inspect(name);assert.equal(d.Config.Labels['ardore.delete-release-test'],id)
    run('docker',[...docker,'rm','-f',name])
  }
  if(created){assert.match(database,/^ardore_delete_release_test_[a-f0-9]{12}$/);sql('DROP DATABASE '+database+';','postgres')}
  for(const path of envFiles)if(existsSync(path))unlinkSync(path)
  console.log(JSON.stringify({ownContainersAndDatabaseRemoved:true,temporaryCredentialsRemoved:true,failed:failure}))
}
