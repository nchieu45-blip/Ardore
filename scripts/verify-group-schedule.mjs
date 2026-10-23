// Pure local schedule tests. No credentials, provider calls or database fixtures.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, mocks = {}) {
  const loaded = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'exports', 'module', source)(
    name => name in mocks ? mocks[name] : require(name), loaded.exports, loaded,
  )
  return loaded.exports
}
const slots = load('../src/lib/coaching-slots.ts')
const schedule = load('../src/lib/group-schedule.ts', { '@/lib/coaching-slots': slots })
const { nextGroupOccurrences, formatGroupOccurrence, MAX_GROUP_PARTICIPANTS } = schedule
const weekly = overrides => ({
  schedule_type: 'recurring', starts_at: null, recurring_weekday: 0,
  recurring_time: '09:00:00', duration_minutes: 60, active: true, ...overrides,
})
const once = overrides => ({
  ...weekly(), schedule_type: 'once', starts_at: '2026-11-01T09:00:00Z', ...overrides,
})
const starts = values => values.map(value => value.startsAt)

test('weekly sessions retain Berlin wall time across both daylight saving transitions', () => {
  const spring = nextGroupOccurrences(weekly(), Date.parse('2027-03-20T12:00:00Z'), 3)
  assert.deepEqual(starts(spring), [
    '2027-03-21T08:00:00.000Z', '2027-03-28T07:00:00.000Z', '2027-04-04T07:00:00.000Z',
  ])
  const autumn = nextGroupOccurrences(weekly(), Date.parse('2026-10-17T12:00:00Z'), 3)
  assert.deepEqual(starts(autumn), [
    '2026-10-18T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-11-01T08:00:00.000Z',
  ])
  for (const value of [...spring, ...autumn]) {
    assert.equal(Date.parse(value.endsAt) - Date.parse(value.startsAt), 3_600_000)
    assert.match(formatGroupOccurrence(value.startsAt), /09:00 Uhr \(Berlin\)$/)
  }
})

test('nonexistent and ambiguous Berlin wall times are omitted rather than shifted or doubled', () => {
  assert.deepEqual(starts(nextGroupOccurrences(weekly({ recurring_time: '02:30' }), Date.parse('2027-03-26T12:00:00Z'), 2)), [
    '2027-04-04T00:30:00.000Z', '2027-04-11T00:30:00.000Z',
  ])
  assert.deepEqual(starts(nextGroupOccurrences(weekly({ recurring_time: '02:30' }), Date.parse('2026-10-23T12:00:00Z'), 2)), [
    '2026-11-01T01:30:00.000Z', '2026-11-08T01:30:00.000Z',
  ])
})

test('Berlin weekday calculation handles UTC on the previous day and midnight correctly', () => {
  const values = nextGroupOccurrences(weekly({ recurring_weekday: 1, recurring_time: '00:00' }), Date.parse('2026-10-18T21:00:00Z'), 2)
  assert.deepEqual(starts(values), ['2026-10-18T22:00:00.000Z', '2026-10-25T23:00:00.000Z'])
  assert.match(formatGroupOccurrence(values[0].startsAt), /^Montag, 19\. Oktober 2026 um 00:00 Uhr \(Berlin\)$/)
})

test('one-time sessions preserve absolute instants and duration without a runtime timezone assumption', () => {
  const values = nextGroupOccurrences(once({ starts_at: '2026-11-01T10:00:00.125+01:00', duration_minutes: 45 }), Date.parse('2026-11-01T08:00:00Z'))
  assert.deepEqual(values, [{ startsAt: '2026-11-01T09:00:00.125Z', endsAt: '2026-11-01T09:45:00.125Z' }])
  assert.deepEqual(nextGroupOccurrences(once({ starts_at: '2026-11-01T10:00:00.125999+01:00', duration_minutes: 45 }), Date.parse('2026-11-01T08:00:00Z')), [
    { startsAt: '2026-11-01T09:00:00.125999Z', endsAt: '2026-11-01T09:45:00.125999Z' },
  ])
  assert.deepEqual(nextGroupOccurrences(once({ starts_at: '2026-11-01T09:00:00Z' }), Date.parse('2026-11-01T09:00:00Z')), [])
  assert.deepEqual(nextGroupOccurrences(once({ starts_at: '2026-11-01T08:59:59Z' }), Date.parse('2026-11-01T09:00:00Z')), [])
  assert.deepEqual(nextGroupOccurrences(weekly(), Date.parse('2026-10-18T07:00:00Z'), 1).map(value => value.startsAt), ['2026-10-25T08:00:00.000Z'])
})

test('selectable sessions exclude inactive, invalid or already-started classes', () => {
  const now = Date.parse('2026-10-18T08:00:00Z')
  for (const value of [
    null, undefined, weekly({ active: false }), weekly({ schedule_type: 'other' }),
    weekly({ recurring_weekday: -1 }), weekly({ recurring_weekday: 7 }), weekly({ recurring_weekday: 1.5 }),
    weekly({ recurring_weekday: null }), weekly({ recurring_time: null }), weekly({ recurring_time: '25:00' }),
    weekly({ recurring_time: '09:60' }), weekly({ recurring_time: '09:00:01' }), weekly({ recurring_time: '09:00:00.01' }),
    weekly({ recurring_time: '09:00Z' }), once({ starts_at: '2026-11-01T09:00:00' }),
    once({ starts_at: '2026-02-30T09:00:00Z' }), once({ starts_at: '2026-11-01T24:00:00Z' }),
    once({ starts_at: 'not-a-date' }), once({ starts_at: null }),
  ]) assert.deepEqual(nextGroupOccurrences(value, now), [], JSON.stringify(value))
  for (const duration of [0, 4, 481, 60.5, NaN, Infinity]) {
    assert.deepEqual(nextGroupOccurrences(weekly({ duration_minutes: duration }), now), [])
  }
  assert.equal(nextGroupOccurrences(weekly({ duration_minutes: 5 }), now, 1).length, 1)
  assert.equal(nextGroupOccurrences(weekly({ duration_minutes: 480 }), now, 1).length, 1)
  assert.equal(nextGroupOccurrences(weekly({ recurring_time: '09:00:00.000000' }), now, 1).length, 1)
})

test('occurrence options and booking horizon are bounded without inventing an unlimited capacity', () => {
  const now = Date.parse('2026-10-18T08:00:00Z')
  assert.equal(MAX_GROUP_PARTICIPANTS, 199)
  assert.equal(nextGroupOccurrences(weekly(), now).length, 8)
  assert.equal(nextGroupOccurrences(weekly(), now, 100_000).length, 12)
  assert.equal(nextGroupOccurrences(weekly(), now, 2.9).length, 2)
  for (const limit of [-1, 0, NaN, Infinity]) assert.deepEqual(nextGroupOccurrences(weekly(), now, limit), [])
  for (const invalidNow of [NaN, Infinity, -Infinity, 9e15]) assert.deepEqual(nextGroupOccurrences(weekly(), invalidNow), [])
  const boundary = now + 90 * 86_400_000
  assert.equal(nextGroupOccurrences(once({ starts_at: new Date(boundary).toISOString() }), now).length, 1)
  assert.deepEqual(nextGroupOccurrences(once({ starts_at: new Date(boundary + 1).toISOString() }), now), [])
  assert.ok(nextGroupOccurrences(weekly({ recurring_time: '02:30' }), now, 12).every(value => Date.parse(value.startsAt) <= boundary))
})

test('date labels consistently name Berlin time and fail safely on invalid input', () => {
  assert.match(formatGroupOccurrence('2026-07-01T10:00:00Z'), /12:00 Uhr \(Berlin\)$/)
  assert.match(formatGroupOccurrence('2026-12-01T10:00:00Z'), /11:00 Uhr \(Berlin\)$/)
  for (const value of ['bad', '2026-02-30T10:00:00Z', '2026-12-01T10:00:00']) {
    assert.equal(formatGroupOccurrence(value), 'Termin nicht verfügbar')
  }
})
