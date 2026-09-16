import assert from 'node:assert/strict'
import {
  berlinDateTimeToIso,
  generateSlots,
  getWindowsForDate,
  isWithinBookingHorizon,
} from '../src/lib/coaching-slots.ts'

assert.equal(berlinDateTimeToIso('2026-01-15', '10:00'), '2026-01-15T09:00:00.000Z')
assert.equal(berlinDateTimeToIso('2026-07-15', '10:00'), '2026-07-15T08:00:00.000Z')
assert.equal(berlinDateTimeToIso('2026-03-29', '02:30'), null)
assert.equal(berlinDateTimeToIso('2026-10-25', '02:30'), null)

const recurring = [{ day_of_week: 1, start_time: '09:00', end_time: '12:00' }]
assert.deepEqual(getWindowsForDate('2026-09-07', recurring, []), [{ start: '09:00', end: '12:00' }])
assert.deepEqual(getWindowsForDate('2026-09-07', recurring, [{
  date: '2026-09-07', type: 'unavailable', start_time: null, end_time: null,
}]), [])

const futureNotice = Date.parse('2026-09-07T06:00:00Z')
assert.deepEqual(generateSlots('2026-09-07', [{ start: '09:00', end: '12:00' }], 60, 0, [], futureNotice), ['09:00', '10:00', '11:00'])
assert.equal(generateSlots('2026-09-07', [{ start: '09:00', end: '12:00' }], 60, 0, [], futureNotice).includes('08:00'), false)
assert.deepEqual(generateSlots('2026-09-07', [{ start: '09:00', end: '12:00' }], 60, 0, [], Date.parse('2026-09-07T09:30:00Z')), ['12:00'].filter(() => false))
assert.deepEqual(generateSlots('2026-09-07', [{ start: '09:00', end: '13:00' }], 60, 15, [{
  scheduled_at: '2026-09-07T08:00:00.000Z', duration_minutes: 60,
}], futureNotice), ['11:30'])
assert.equal(isWithinBookingHorizon('2026-09-17', '2026-09-07', 10), true)
assert.equal(isWithinBookingHorizon('2026-09-18', '2026-09-07', 10), false)
assert.equal(isWithinBookingHorizon('2026-09-06', '2026-09-07', 10), false)

console.log('Booking slot verification passed (13 assertions).')
