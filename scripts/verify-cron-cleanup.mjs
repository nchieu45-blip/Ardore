import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { timingSafeEqual } from 'node:crypto'
import ts from 'typescript'

// Execute the real route/authorization with in-memory database and storage mocks.
// No .env, service SDK, real credential, external network, or production mutation.
const NOW = new Date('2026-10-15T09:00:00.000Z')
const DAY = 86_400_000
const SECRET = 'synthetic-cleanup-only'
const iso = days => new Date(NOW.getTime() + days * DAY).toISOString()
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW.getTime()])) }
  static now() { return NOW.getTime() }
}

function load(relative, modules, env) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const fixtureModule = { exports: {} }
  const resolver = name => {
    if (name in modules) return modules[name]
    if (name === '@/lib/cron') return load('src/lib/cron.ts', modules, env)
    throw new Error(`Unexpected cleanup test dependency: ${name}`)
  }
  new Function('require', 'exports', 'module', 'process', 'Date', 'fetch', code)(
    resolver, fixtureModule.exports, fixtureModule, { env }, FixtureDate,
    () => { throw new Error('Network access forbidden in cleanup fixtures') },
  )
  return fixtureModule.exports
}

const requestRow = (changes = {}) => ({
  id: 'synthetic-request-001', status: 'approved', document_path: 'synthetic-private/document-001.pdf',
  delete_after: iso(-1), reviewed_at: iso(-31), ...changes,
})

function fixture(options = {}) {
  const rows = structuredClone(options.rows ?? [requestRow()])
  const calls = { serviceClients: 0, reads: [], updates: [], removals: [] }
  const storage = new Set(rows.map(row => row.document_path).filter(Boolean))

  class Query {
    constructor() { this.filters = []; this.maximum = Infinity; this.changes = null }
    select(columns) { this.columns = columns; return this }
    update(changes) { this.changes = changes; return this }
    eq(key, value) { this.filters.push(['eq', key, value]); return this }
    not(key, comparison, value) { this.filters.push(['not', key, comparison, value]); return this }
    lte(key, value) { this.filters.push(['lte', key, value]); return this }
    gt(key, value) { this.filters.push(['gt', key, value]); return this }
    order(key) { this.orderBy = key; return this }
    limit(maximum) { this.maximum = maximum; return this }
    matches(row) {
      return this.filters.every(([operator, key, value, fourth]) => {
        if (operator === 'eq') return row[key] === value
        if (operator === 'not') { assert.equal(value, 'is'); assert.equal(fourth, null); return row[key] !== null }
        if (operator === 'lte') return row[key] !== null && row[key] <= value
        if (operator === 'gt') return row[key] !== null && row[key] > value
        throw new Error(`Unexpected cleanup filter: ${operator}`)
      })
    }
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        const record = { filters: structuredClone(this.filters), columns: this.columns, orderBy: this.orderBy, maximum: this.maximum }
        if (this.changes) {
          calls.updates.push({ ...record, changes: structuredClone(this.changes) })
          const id = this.filters.find(([, key]) => key === 'id')?.[2]
          if (options.updateFailure === true || options.updateFailure === id) return { data: null, error: { message: 'PRIVATE metadata error: customer@example.test' } }
          if (options.emptyUpdate) return { data: [], error: null }
          if (options.nullUpdate) return { data: null, error: null }
          const matched = rows.filter(row => this.matches(row))
          for (const row of matched) Object.assign(row, this.changes)
          return { data: matched.map(row => ({ id: row.id })), error: null }
        }
        calls.reads.push(record)
        if (options.readFailure) return { data: null, error: { message: 'PRIVATE database error: customer@example.test' } }
        if (options.nullRead) return { data: null, error: null }
        const matched = rows.filter(row => this.matches(row))
          .sort((a, b) => a[this.orderBy].localeCompare(b[this.orderBy]))
          .slice(0, this.maximum)
        // Real query data is detached from the backing table, not live references.
        return { data: matched.map(row => ({ id: row.id, document_path: row.document_path })), error: null }
      }).then(resolve, reject)
    }
  }
  const service = {
    from(table) { assert.equal(table, 'verification_requests'); return new Query() },
    storage: { from(bucket) {
      assert.equal(bucket, 'verification-docs')
      return { async remove(paths) {
        calls.removals.push([...paths])
        const row = rows.find(item => item.document_path === paths[0])
        if (options.storageFailure === true || options.storageFailure === row?.id) return { data: null, error: { message: 'PRIVATE storage error: customer@example.test' } }
        for (const path of paths) storage.delete(path)
        options.afterRemoval?.(row, rows)
        return { data: paths.map(name => ({ name })), error: null }
      } }
    } },
  }
  const modules = {
    'node:crypto': { timingSafeEqual },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/server': { createServiceClient: async () => {
      calls.serviceClients++
      if (options.serviceFailure) throw new Error('PRIVATE service error: customer@example.test')
      return service
    } },
  }
  const route = load('src/app/api/cron/cleanup-verification-docs/route.ts', modules, options.env ?? { CRON_SECRET: SECRET })
  return {
    rows, calls, storage,
    async run(authorization = `Bearer ${SECRET}`) {
      const headers = authorization === null ? {} : { Authorization: authorization }
      const response = await route.GET(new Request('https://fixture.invalid/api/cron/cleanup-verification-docs', { headers }))
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const body = await response.json()
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE|customer@example|synthetic-private|synthetic-request|synthetic-cleanup-only/)
      return { status: response.status, body }
    },
  }
}

test('cleanup rejects missing, empty, wrong and undefined credentials before service creation', async () => {
  for (const [env, authorization] of [
    [{ CRON_SECRET: SECRET }, null], [{ CRON_SECRET: SECRET }, ''], [{ CRON_SECRET: SECRET }, 'Bearer wrong'],
    [{}, 'Bearer undefined'], [{ CRON_SECRET: '' }, 'Bearer '], [{ CRON_SECRET: '   ' }, 'Bearer    '],
    [{ CRON_SECRET: SECRET }, 'Bearer undefined'],
  ]) {
    const f = fixture({ env })
    assert.equal((await f.run(authorization)).status, 401)
    assert.equal(f.calls.serviceClients, 0)
    assert.deepEqual(f.calls.removals, [])
  }
})

test('cleanup preserves approved delete_after and rejected 30-day retention including boundaries', async () => {
  const f = fixture({ rows: [
    requestRow({ id: 'approved-before', document_path: 'synthetic-private/a-before.pdf' }),
    requestRow({ id: 'approved-boundary', document_path: 'synthetic-private/a-boundary.pdf', delete_after: iso(0) }),
    requestRow({ id: 'approved-future', document_path: 'synthetic-private/a-future.pdf', delete_after: iso(1) }),
    requestRow({ id: 'approved-null', document_path: 'synthetic-private/a-null.pdf', delete_after: null }),
    requestRow({ id: 'approved-no-document', document_path: null }),
    requestRow({ id: 'rejected-before', status: 'rejected', document_path: 'synthetic-private/r-before.pdf' }),
    requestRow({ id: 'rejected-boundary', status: 'rejected', document_path: 'synthetic-private/r-boundary.pdf', reviewed_at: iso(-30) }),
    requestRow({ id: 'rejected-recent', status: 'rejected', document_path: 'synthetic-private/r-recent.pdf', reviewed_at: iso(-29) }),
    requestRow({ id: 'rejected-null', status: 'rejected', document_path: 'synthetic-private/r-null.pdf', reviewed_at: null }),
    requestRow({ id: 'pending-old', status: 'pending', document_path: 'synthetic-private/pending.pdf' }),
  ] })
  assert.deepEqual(await f.run(), { status: 200, body: { deleted: 4, failed: 0 } })
  assert.deepEqual(new Set(f.calls.removals.flat()), new Set([
    'synthetic-private/a-before.pdf', 'synthetic-private/a-boundary.pdf',
    'synthetic-private/r-before.pdf', 'synthetic-private/r-boundary.pdf',
  ]))
  const approved = f.calls.reads.find(query => query.filters.some(([, key, value]) => key === 'status' && value === 'approved'))
  const rejected = f.calls.reads.find(query => query.filters.some(([, key, value]) => key === 'status' && value === 'rejected'))
  assert.ok(approved.filters.some(([operator, key, value]) => operator === 'lte' && key === 'delete_after' && value === iso(0)))
  assert.ok(rejected.filters.some(([operator, key, value]) => operator === 'lte' && key === 'reviewed_at' && value === iso(-30)))
  for (const query of f.calls.reads) {
    assert.ok(query.filters.some(([operator, key, comparison, value]) => operator === 'not' && key === 'document_path' && comparison === 'is' && value === null))
  }
})

test('empty cleanup is successful but database/read-service errors cannot report zero-success', async () => {
  assert.deepEqual(await fixture({ rows: [] }).run(), { status: 200, body: { deleted: 0, failed: 0 } })
  for (const failure of ['readFailure', 'nullRead', 'serviceFailure']) {
    const f = fixture({ [failure]: true })
    const response = await f.run()
    assert.equal(response.status, 503)
    assert.equal(response.body.deleted, 0)
    assert.ok(response.body.failed > 0)
    assert.deepEqual(f.calls.removals, [])
  }
})

test('storage error returns 503 and does not clear metadata or count a deletion', async () => {
  const f = fixture({ storageFailure: true })
  assert.deepEqual(await f.run(), { status: 503, body: { deleted: 0, failed: 1 } })
  assert.equal(f.rows[0].document_path, 'synthetic-private/document-001.pdf')
  assert.equal(f.calls.updates.length, 0)
  assert.equal(f.storage.has(f.rows[0].document_path), true)
})

test('metadata error or missing affected row returns 503 without falsely counting deleted', async () => {
  for (const failure of ['updateFailure', 'emptyUpdate', 'nullUpdate']) {
    const f = fixture({ [failure]: true })
    assert.deepEqual(await f.run(), { status: 503, body: { deleted: 0, failed: 1 } })
    assert.equal(f.rows[0].document_path, 'synthetic-private/document-001.pdf')
    assert.equal(f.calls.updates.length, 1)
    assert.equal(f.calls.updates[0].columns, 'id')
  }
})

test('metadata clearing is compare-and-set scoped to the original id, status and document path', async () => {
  const success = fixture()
  assert.equal((await success.run()).status, 200)
  assert.deepEqual(success.calls.updates[0].filters, [
    ['eq', 'id', 'synthetic-request-001'], ['eq', 'status', 'approved'],
    ['eq', 'document_path', 'synthetic-private/document-001.pdf'],
  ])
  assert.deepEqual(success.calls.updates[0].changes, { document_path: null })
  assert.equal(success.calls.updates[0].columns, 'id')
  for (const changes of [{ status: 'pending' }, { document_path: 'synthetic-private/replaced.pdf' }, { id: 'synthetic-request-changed' }]) {
    const f = fixture({ afterRemoval: row => Object.assign(row, changes) })
    assert.deepEqual(await f.run(), { status: 503, body: { deleted: 0, failed: 1 } })
    assert.notEqual(f.rows[0].document_path, null)
  }
})

test('one failed row does not suppress remaining approved rows or rejected cleanup', async () => {
  for (const failure of ['storageFailure', 'updateFailure']) {
    const f = fixture({ [failure]: 'synthetic-request-001', rows: [
      requestRow(), requestRow({ id: 'synthetic-request-002', document_path: 'synthetic-private/second.pdf' }),
      requestRow({ id: 'synthetic-request-003', status: 'rejected', document_path: 'synthetic-private/rejected.pdf' }),
    ] })
    assert.deepEqual(await f.run(), { status: 503, body: { deleted: 2, failed: 1 } })
    assert.equal(f.rows[0].document_path, 'synthetic-private/document-001.pdf')
    assert.equal(f.rows[1].document_path, null)
    assert.equal(f.rows[2].document_path, null)
    assert.equal(f.calls.removals.length, 3)
  }
})

test('keyset cleanup visits more than 100 rows without skips as document paths are cleared', async () => {
  const rows = Array.from({ length: 305 }, (_, index) => requestRow({
    id: `synthetic-request-${String(index).padStart(4, '0')}`,
    document_path: `synthetic-private/document-${index}.pdf`, status: index < 205 ? 'approved' : 'rejected',
  }))
  const f = fixture({ rows })
  assert.deepEqual(await f.run(), { status: 200, body: { deleted: 305, failed: 0 } })
  assert.equal(f.calls.removals.length, 305)
  assert.equal(new Set(f.calls.removals.flat()).size, 305)
  assert.equal(f.rows.every(row => row.document_path === null), true)
  assert.equal(f.storage.size, 0)
  assert.equal(f.calls.reads.length, 5)
  const cursors = f.calls.reads.flatMap(query => query.filters.filter(([operator]) => operator === 'gt'))
  assert.deepEqual(cursors, [
    ['gt', 'id', 'synthetic-request-0099'], ['gt', 'id', 'synthetic-request-0199'],
    ['gt', 'id', 'synthetic-request-0304'],
  ])
  assert.ok(f.calls.reads.every(query => query.orderBy === 'id' && query.maximum === 100))
})

test('a failure in a full page does not strand its successors or loop on uncleared rows', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => requestRow({
    id: `synthetic-request-${String(index).padStart(4, '0')}`, document_path: `synthetic-private/document-${index}.pdf`,
  }))
  const f = fixture({ rows, storageFailure: 'synthetic-request-0050' })
  assert.deepEqual(await f.run(), { status: 503, body: { deleted: 204, failed: 1 } })
  assert.equal(f.calls.removals.length, 205)
  assert.equal(f.rows.filter(row => row.document_path !== null).length, 1)
})
