// Local source-contract checks only: no environment loading, network, SQL
// execution or production fixtures. Real PostgreSQL behavior is tested by the
// guarded supabase/tests/group_marketplace_rls_{setup,assertions}.sql files.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const migrations = new URL('../supabase/migrations/', import.meta.url)
const files = readdirSync(migrations).filter(name => name.endsWith('_fix_group_marketplace_rls_recursion.sql'))
assert.equal(files.length, 1, 'Exactly one additive group marketplace RLS repair must exist')
const source = readFileSync(new URL(files[0], migrations), 'utf8')
const sql = source.replace(/--[^\n]*/g, '')
const helper = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+private\.has_own_video_class_booking\s*\(([^)]*)\)([\s\S]*?)AS\s*\$\$([\s\S]*?)\$\$/i)

test('helper creation, grants and policy replacement are atomic with a bounded lock wait', () => {
  assert.match(sql, /^\s*BEGIN;/i)
  assert.match(sql, /SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'\s*;/i)
  assert.match(sql, /COMMIT;\s*$/i)
  assert.equal((sql.match(/\bCOMMIT\s*;/gi) ?? []).length, 1)
})

test('group enrollment helper exposes only a boolean for the current actor', () => {
  assert.ok(helper, 'Private lookup helper must exist')
  assert.match(helper[1], /^\s*p_video_class_id\s+uuid\s*$/i)
  assert.match(helper[2], /RETURNS\s+boolean\b/i)
  assert.match(helper[3], /\(SELECT\s+auth\.uid\(\)\)\s+IS\s+NOT\s+NULL/i)
  assert.match(helper[3], /FROM\s+public\.video_class_bookings\s+(?:AS\s+)?booking\b/i)
  assert.match(helper[3], /booking\.video_class_id\s*=\s*p_video_class_id/i)
  assert.match(helper[3], /booking\.user_id\s*=\s*\(SELECT\s+auth\.uid\(\)\)/i)
  assert.doesNotMatch(helper[3], /\b(?:status|INSERT|UPDATE|DELETE|SET|EXECUTE)\b/i,
    'Lookup preserves all existing own enrollments without status filtering or writes')
})

test('RLS helper bypass is constrained to a stable function with an empty search path', () => {
  assert.ok(helper)
  assert.match(helper[2], /LANGUAGE\s+sql\b/i)
  assert.match(helper[2], /\bSTABLE\b/i)
  assert.match(helper[2], /\bSECURITY\s+DEFINER\b/i)
  assert.match(helper[2], /SET\s+search_path\s*=\s*''/i)
  assert.doesNotMatch(helper[2], /\bSECURITY\s+INVOKER\b/i)
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+private\.has_own_video_class_booking\(uuid\)\s+FROM\s+PUBLIC\b/i)
  assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+private\.has_own_video_class_booking\(uuid\)\s+TO\s+anon\s*,\s*authenticated\s*,\s*service_role\s*;/i)
  assert.doesNotMatch(sql, /GRANT\b[^;]*\bTO\s+PUBLIC\b/i)
})

test('only the recursive public class SELECT policy is replaced', () => {
  const policies = [...sql.matchAll(/ALTER\s+POLICY\s+"([^"]+)"\s+ON\s+([\w.]+)\s+USING\s*\(([\s\S]*?)\);/gi)]
  assert.equal(policies.length, 1)
  assert.equal(policies[0][1], 'Public can view active video classes')
  assert.equal(policies[0][2], 'public.video_classes')
  assert.match(policies[0][3], /\(active\s+AND\s+private\.coach_is_public\(creator_id\)\)\s+OR\s+private\.has_own_video_class_booking\(id\)/i)
  assert.doesNotMatch(policies[0][3], /\b(?:FROM|EXISTS|video_class_bookings)\b/i,
    'Class policy must not recurse through the booking table as the caller')
  assert.equal((sql.match(/\bALTER\s+POLICY\b/gi) ?? []).length, 1)
  assert.doesNotMatch(sql, /\b(?:DROP|CREATE)\s+POLICY\b|\bALTER\s+TABLE\b|\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i)
})

test('repair does not mutate rows, enrollment grants or expose a public RPC', () => {
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i)
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)\b[^;]*\bON\s+(?:TABLE\s+)?public\./i)
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\./i)
  assert.equal((sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).length, 1)
})

test('real SQL regression fixtures require an explicitly isolated database', () => {
  for (const file of ['group_marketplace_rls_setup.sql', 'group_marketplace_rls_assertions.sql']) {
    const fixture = readFileSync(new URL(`../supabase/tests/${file}`, import.meta.url), 'utf8')
    assert.match(fixture, /current_database\(\)\s*<>\s*'ardore_group_rls_test'/)
    assert.match(fixture, /current_setting\('ardore\.isolated_sql_test',\s*true\)\s+IS\s+DISTINCT\s+FROM\s+'true'/i)
    assert.doesNotMatch(fixture, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+auth\.users\b/i)
    assert.doesNotMatch(fixture, /\b(?:ALTER|DROP)\s+ROLE\b|\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i)
  }
  const setup = readFileSync(new URL('../supabase/tests/group_marketplace_rls_setup.sql', import.meta.url), 'utf8')
  assert.match(setup, /EXCEPTION\s+WHEN\s+SQLSTATE\s+'42P17'/i)
  const assertions = readFileSync(new URL('../supabase/tests/group_marketplace_rls_assertions.sql', import.meta.url), 'utf8')
  assert.match(assertions, /SET\s+LOCAL\s+ROLE\s+anon/i)
  assert.match(assertions, /SET\s+LOCAL\s+ROLE\s+authenticated/i)
  assert.match(assertions, /ROLLBACK;\s*$/)
})
