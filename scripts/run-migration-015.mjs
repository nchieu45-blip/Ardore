/**
 * Applies migration 015: adds withdrawal_consent_at / withdrawal_consent_version
 * to the purchases table.
 *
 * Usage:
 *   node scripts/run-migration-015.mjs
 *
 * If the Supabase REST API cannot execute DDL (expected — PostgREST is read/write
 * only), the script will print the SQL and tell you to paste it into the
 * Supabase SQL Editor (Project → SQL Editor → New query).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envLines = readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')
const env = Object.fromEntries(
  envLines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').map((s, i) => (i === 0 ? s : s)))
    .filter(([k]) => k)
    .map(([k, ...rest]) => [k, rest.join('=')])
)

const SUPABASE_URL     = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function columnsExist() {
  // A SELECT that succeeds only if both columns are present
  const { error } = await supabase
    .from('purchases')
    .select('id, withdrawal_consent_at, withdrawal_consent_version')
    .limit(0)
  return !error
}

async function main() {
  console.log('=== Migration 015: withdrawal consent columns ===\n')

  if (await columnsExist()) {
    console.log('✓ Columns already exist — nothing to do.\n')
    return
  }

  console.log('✗ Columns are missing.\n')
  console.log('PostgREST cannot execute DDL. Run the following SQL in the')
  console.log('Supabase SQL Editor (Project → SQL Editor → New query):\n')
  console.log('─────────────────────────────────────────────────────────')
  const sql = readFileSync(resolve(root, 'supabase/migrations/015_add_withdrawal_consent.sql'), 'utf8')
  console.log(sql.trim())
  console.log('─────────────────────────────────────────────────────────')
  console.log('\nThen re-run this script to confirm.')
  process.exit(1)
}

main().catch(err => {
  console.error('\n✗ Script failed:', err.message)
  process.exit(1)
})
