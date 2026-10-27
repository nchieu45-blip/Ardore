// Explicit opt-in only. Creates/drops ONE new disposable database in the named
// local Docker test VM, never the linked Supabase project or auth.users.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

if (!process.argv.includes('--run-isolated')) {
  console.log('Not run. Opt in with --run-isolated against the existing colima-ardore-test Docker context.')
  process.exit(0)
}
const database = 'ardore_group_payments_test'
const base = ['--context','colima-ardore-test','exec','-i','-e','PGOPTIONS=-c ardore.isolated_sql_test=true',
  'supabase_db_ardore-local-test','psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At','-d']
function sql(statement, db=database, onOutput) {
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',[...base,db],{stdio:['pipe','pipe','pipe']})
    let output='',error=''
    child.stdout.on('data',data=>{output+=data.toString();onOutput?.(output)})
    child.stderr.on('data',data=>{error+=data.toString()})
    child.on('error',reject)
    child.on('close',code=>code===0?resolve(output):reject(new Error(`Isolated SQL failed (${code}): ${error}`)))
    child.stdin.end(statement)
  })
}
let created=false
try {
  assert.equal((await sql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`,'postgres')).trim(),'0',
    'Test database already exists. Refuse to replace or delete another run.')
  await sql(`CREATE DATABASE ${database};`,'postgres');created=true
  for(const path of ['../supabase/tests/group_session_payments_setup.sql',
    '../supabase/migrations/20261018181232_group_session_payments.sql',
    '../supabase/migrations/20261025130000_group_video_capacity.sql',
    '../supabase/tests/group_session_payments_assertions.sql']) {
    await sql(readFileSync(new URL(path,import.meta.url),'utf8'))
  }
  console.log('PostgreSQL migration, permissions, subscription and lifecycle assertions passed.')
  // Two independent sessions contend while the winner still holds its class
  // lock. The second cannot see an uncommitted reservation or oversell the seat.
  const course='20000000-0000-4000-8000-000000000001'
  const reserve=(buyer,request)=>`SELECT public.reserve_group_class_booking('${course}','${buyer}','${request}',(SELECT starts_at FROM public.video_classes WHERE id='${course}'),false,'acct_fixture',500);`
  let release, rejectLocked
  const locked=new Promise((resolve,reject)=>{release=resolve;rejectLocked=reject})
  const first=sql(`BEGIN; SET LOCAL ROLE service_role; ${reserve('00000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000021')} SELECT 'FIRST_RESERVED'; SELECT pg_sleep(2); COMMIT;`,database,
    output=>{if(output.includes('FIRST_RESERVED'))release()})
  first.catch(rejectLocked)
  await locked
  const contentionStarted=performance.now()
  const second=sql(`SET ROLE service_role; ${reserve('00000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000022')}`)
  const [a,b]=await Promise.all([first,second])
  assert.ok(performance.now()-contentionStarted>1000, 'Second connection must actually wait for the first class-row lock')
  assert.match(a,/"status": "creating"/);assert.match(b,/"error": "full"/)
  assert.equal((await sql(`SELECT count(*) FROM public.group_booking_reservations;`)).trim(),'1')
  assert.equal((await sql(`SELECT count(*) FROM public.video_class_bookings;`)).trim(),'0')
  console.log('Concurrent capacity: one durable hold, one full response, zero premature entitlements.')
} finally {
  if(created){await sql(`DROP DATABASE ${database};`,'postgres');console.log('Disposable group-payment test database removed.')}
}
