import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let writes = []
const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic-creator' } } }) },
  from(table) {
    if (table === 'creator_profiles') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'synthetic-profile' } }) }) }) }
    }
    assert.equal(table, 'coaching_offers')
    return {
      upsert(offer) {
        writes.push(offer)
        return { select: () => ({ single: async () => ({ data: offer, error: null }) }) }
      },
    }
  },
}

// Execute the real route against an in-memory Supabase substitute; no API calls.
const source = readFileSync(new URL('../src/app/api/coaching/offer/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
const route = { exports: {} }
const requireRoute = name => {
  if (name === '@/lib/supabase/server') return { createClient: async () => supabase }
  if (name === '@/lib/coaching-booking') return { isValidCoachingDuration: value => [30, 45, 60, 90].includes(value) }
  return require(name)
}
new Function('require', 'exports', 'module', compiled.outputText)(requireRoute, route.exports, route)

async function save(input) {
  writes = []
  const response = await route.exports.POST(new Request('http://localhost/api/coaching/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration_minutes: 60, ...input }),
  }))
  return { status: response.status, body: await response.json() }
}

let result = await save({ price_cents: 0, min_notice_hours: 0 })
assert.equal(result.status, 200)
assert.equal(result.body.offer.price_cents, 0)
assert.equal(result.body.offer.min_notice_hours, 0)
assert.equal(writes.length, 1)

result = await save({ price_cents: 12500, min_notice_hours: 12 })
assert.equal(result.status, 200)
assert.equal(result.body.offer.price_cents, 12500)
assert.equal(result.body.offer.min_notice_hours, 12)

result = await save({})
assert.equal(result.status, 200)
assert.equal(result.body.offer.price_cents, 8000)
assert.equal(result.body.offer.min_notice_hours, 24)

for (const field of ['price_cents', 'min_notice_hours']) {
  for (const invalid of [-1, 0.5, 2_147_483_648, 'invalid', '', '0', null, true, {}, NaN, Infinity]) {
    result = await save({ price_cents: 0, min_notice_hours: 0, [field]: invalid })
    assert.equal(result.status, 400, `${field} must reject ${String(invalid)}`)
    assert.equal(writes.length, 0, 'Invalid input must never reach the database')
  }
}

console.log('Coaching offer route verification passed: zero values, defaults, valid values, and invalid input without database writes.')
