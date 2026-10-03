// Read-only grant/RLS inspection and opt-in client-denial probes. Raw auth SQL
// is never used: the optional authenticated actor is created/deleted by GoTrue.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const directory = new URL('../supabase/migrations/', import.meta.url)
const pathArgument = process.argv.find(value => value.startsWith('--migration='))?.slice('--migration='.length)
const migrationFiles = pathArgument ? [pathArgument] : readdirSync(directory).filter(name => /settlement.*\.sql$/.test(name)).sort()
assert.ok(migrationFiles.length, 'Settlement migration must exist before permission checks')
const migration = migrationFiles.map(name => readFileSync(pathArgument ? name : new URL(name, directory), 'utf8')).join('\n')
const tables = [...new Set([...migration.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z_][a-z0-9_]*)/gi)].map(match => match[1]))]
// Later additive migrations can replace an authority function. Probe the final
// signature once while retaining every private table from the original ledger.
const functions = [...new Map([...migration.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(([^)]*)\)\s*returns\s+([a-z_]+)/gi)]
  .map(match => [match[1], { name: match[1], arguments: match[2].split(',').map(value => value.trim()).filter(Boolean), result: match[3].toLowerCase() }])).values()]
assert.ok(tables.length, 'No private settlement tables found')
assert.ok(functions.length, 'No settlement authority functions found')
assert.equal(new Set(tables).size, tables.length)
const quoted = value => `'${value.replaceAll("'", "''")}'`
const names = values => values.map(value => `(${quoted(value)})`).join(',')

// Run this result through Supabase execute_sql. It performs only system-catalog
// reads and returns field names/booleans, never users, payments or credentials.
const sql = `with ledger_tables(name) as (values ${names(tables)}),
ledger_functions(name) as (values ${names(functions.map(value => value.name))}),
roles(name) as (values ('anon'),('authenticated')),
privileges(name) as (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')),
checks as (
  select 'table_exists:'||t.name label, to_regclass('public.'||t.name) is not null ok from ledger_tables t
  union all
  select 'rls_enabled:'||t.name, coalesce(c.relrowsecurity,false) from ledger_tables t
    left join pg_class c on c.oid=to_regclass('public.'||t.name)
  union all
  select 'denied:'||r.name||':'||t.name||':'||p.name,
    not coalesce(has_table_privilege(r.name,to_regclass('public.'||t.name),p.name),true)
    from ledger_tables t cross join roles r cross join privileges p
  union all
  select 'column_denied:'||r.name||':'||t.name||':'||p.name,
    not coalesce(has_any_column_privilege(r.name,to_regclass('public.'||t.name),p.name),true)
    from ledger_tables t cross join roles r cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(name)
  union all
  select 'service_allowed:'||t.name||':'||p.name,
    coalesce(has_table_privilege('service_role',to_regclass('public.'||t.name),p.name),false)
    from ledger_tables t cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(name)
  union all
  select 'function_exists:'||f.name, exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=f.name) from ledger_functions f
  union all
  select 'function_invoker:'||p.proname, not p.prosecdef
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join ledger_functions f on f.name=p.proname where n.nspname='public'
  union all
  select 'function_denied:'||r.name||':'||p.proname, not has_function_privilege(r.name,p.oid,'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join ledger_functions f on f.name=p.proname
    cross join roles r where n.nspname='public'
  union all
  select 'function_service_allowed:'||p.proname, has_function_privilege('service_role',p.oid,'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join ledger_functions f on f.name=p.proname where n.nspname='public'
)
select count(*) checks, count(*) filter(where not ok) failed,
  coalesce(jsonb_agg(label order by label) filter(where not ok),'[]'::jsonb) failures from checks;`

if (process.argv.includes('--sql')) {
  console.log(sql)
  process.exit(0)
}

if (!process.argv.includes('--run-production-synthetic')) {
  console.log(JSON.stringify({ tables: tables.length, functions: functions.length,
    next: '--sql for read-only live grant checks; --run-production-synthetic for owned client-denial probes' }))
  process.exit(0)
}

process.loadEnvFile('.env.local')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'yboeyxqeileicecqpwke.supabase.co')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const authenticated = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const run = randomUUID()
let userId, verified = 0

function denied(result, context) {
  assert.ok(result.error, `${context} must be denied`)
  assert.ok(['42501', '401', '403'].includes(result.error.code), `${context} must fail for authority, not data validity`)
  verified++
}
function argumentValue(declaration) {
  const fields = declaration.replace(/^\s*(in\s+)?/i, '').split(/\s+/)
  const name = fields[0]
  const type = fields[1]?.toLowerCase()
  assert.match(name, /^[a-z_][a-z0-9_]*$/i)
  let value
  if (type === 'uuid') value = run
  else if (type === 'boolean' || type === 'bool') value = false
  else if (['integer','int','int4','bigint','int8','numeric','smallint'].includes(type)) value = 0
  else if (['json','jsonb'].includes(type)) value = {}
  else if (type?.startsWith('timestamp')) value = new Date(Date.now() + 86_400_000).toISOString()
  else if (type?.endsWith('[]')) value = []
  else value = `synthetic-permission-${run}`
  return [name, value]
}

try {
  const password = randomBytes(32).toString('base64url')
  const created = await service.auth.admin.createUser({ email: `delivered+ardore-settlement-permissions-${run}@resend.dev`,
    password, email_confirm: true, user_metadata: { role: 'buyer', full_name: 'Synthetic permission verification' } })
  if (created.error) throw Object.assign(new Error('GoTrue fixture creation failed'), { code: created.error.code })
  userId = created.data.user.id
  const login = await authenticated.auth.signInWithPassword({ email: created.data.user.email, password })
  if (login.error) throw Object.assign(new Error('Synthetic login failed'), { code: login.error.code })
  for (const [role, client] of [['anon', anon], ['authenticated', authenticated]]) {
    for (const table of tables) {
      // Mutations target a UUID created by this run and proven absent. An
      // authorization regression cannot update/delete an existing ledger row.
      const preflight = await service.from(table).select('id').eq('id', run)
      if (preflight.error || preflight.data.length) throw new Error('Owned mutation target cannot be proven absent')
      denied(await client.from(table).select('*').limit(1), `${role} select ${table}`)
      denied(await client.from(table).insert({ id: run }), `${role} insert ${table}`)
      denied(await client.from(table).update({ id: run }).eq('id', run), `${role} update ${table}`)
      denied(await client.from(table).delete().eq('id', run), `${role} delete ${table}`)
    }
    for (const fn of functions.filter(value => value.result !== 'trigger')) {
      denied(await client.rpc(fn.name, Object.fromEntries(fn.arguments.map(argumentValue))), `${role} execute ${fn.name}`)
    }
  }
  console.log(JSON.stringify({ clientPermissionChecks: verified, passed: true }))
} catch (error) {
  console.error(JSON.stringify({ permissionChecksPassed: verified, code: error.code ?? error.name }))
  process.exitCode = 1
} finally {
  await authenticated.auth.signOut()
  if (userId) {
    const deletion = await service.auth.admin.deleteUser(userId)
    if (deletion.error) { console.error(JSON.stringify({ cleanupFailed: true, code: deletion.error.code })); process.exitCode = 1 }
    else console.log(JSON.stringify({ syntheticAuthAccountCleaned: true }))
  }
}
