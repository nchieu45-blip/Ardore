// Explicit local-only opt-in. No linked Supabase, auth.users, credentials, or mail.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
if(!process.argv.includes('--run-isolated')){console.log('Opt in with --run-isolated to create one disposable database in colima-ardore-test.');process.exit(0)}
const database='ardore_group_reminders_test'
function sql(statement,db=database,onOutput){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['--context','colima-ardore-test','exec','-i','-e','PGOPTIONS=-c ardore.isolated_sql_test=true','supabase_db_ardore-local-test','psql','-X','-U','supabase_admin','-v','ON_ERROR_STOP=1','-At','-d',db]);let out='',err=''
 child.stdout.on('data',d=>{out+=d;onOutput?.(out)});child.stderr.on('data',d=>{err+=d});child.on('error',reject);child.on('close',c=>c===0?resolve(out):reject(Error('Isolated SQL failed: '+err)));child.stdin.end(statement)
})}
let created=false
try{
 assert.equal((await sql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`,'postgres')).trim(),'0','Refuse to replace another run')
 await sql(`CREATE DATABASE ${database};`,'postgres');created=true
 await sql(readFileSync(new URL('../supabase/tests/group_reminders_setup.sql',import.meta.url),'utf8'))
 const migration=readFileSync(new URL('../supabase/migrations/20261027165313_group_session_reminders.sql',import.meta.url),'utf8')
 assert.equal(migration.split('REFERENCES auth.users(id)').length,2)
 // Substitute only the recipient FK in this synthetic SQL test. A separate
 // GoTrue integration validates real Auth FKs; never SQL-insert auth.users.
 await sql(migration.replace('REFERENCES auth.users(id)','REFERENCES public.fixture_users(id)'))
 await sql(readFileSync(new URL('../supabase/tests/group_reminders_assertions.sql',import.meta.url),'utf8'))
 console.log('PASS eligibility, one coach per occurrence, recurring identity, preferences, refunds/TEST/legacy exclusions, frozen retries, expiry, stale tokens, held state, payload clearing and service-only privileges.')
 const claim=`SELECT public.claim_group_reminder('20000000-0000-4000-8000-000000000001',(SELECT min(starts_at) FROM public.video_class_occurrences),'00000000-0000-4000-8000-000000000003','participant','{"from":"test","to":"test@example.test","subject":"concurrency","html":"html","text":"text"}',gen_random_uuid());`
 let locked,rejectLocked;const lock=new Promise((r,j)=>{locked=r;rejectLocked=j})
 const first=sql(`BEGIN; SET LOCAL ROLE service_role; ${claim} SELECT 'LOCKED'; SELECT pg_sleep(2); COMMIT;`,database,out=>{if(out.includes('LOCKED'))locked()});first.catch(rejectLocked);await lock
 const started=performance.now();const second=sql(`SET ROLE service_role; ${claim}`);const[a,b]=await Promise.all([first,second]);assert.ok(performance.now()-started>1000);assert.match(a,/"state": "claimed"/);assert.match(b,/"state": "busy"/)
 console.log('PASS two real SQL connections contend for the same delivery; only one worker claims it.')
}finally{if(created){await sql(`DROP DATABASE ${database};`,'postgres');console.log('Own disposable SQL test database removed.')}}
