/**
 * Sets is_admin=true in the profiles table for a given user email.
 * Uses the service role — run only once for your own account.
 *
 * Usage:
 *   node scripts/set-admin.mjs your@email.com
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
    .map(l => { const [k, ...rest] = l.split('='); return [k, rest.join('=')] })
    .filter(([k]) => k)
)

const SUPABASE_URL     = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/set-admin.mjs <email>')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // Look up the user via GoTrue Admin API (never raw SQL on auth.users)
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) { console.error('✗ Failed to list users:', listErr.message); process.exit(1) }

  const user = users.find(u => u.email === email)
  if (!user) { console.error(`✗ No user found with email: ${email}`); process.exit(1) }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ is_admin: true })
    .eq('id', user.id)

  if (updateErr) { console.error('✗ Failed to update profile:', updateErr.message); process.exit(1) }

  console.log(`✓ is_admin=true set for ${email} (user id: ${user.id})`)
}

main().catch(err => { console.error('\n✗ Script failed:', err.message); process.exit(1) })
