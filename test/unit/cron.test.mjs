import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, nextFire, prevFire, matches } from '../../lib/cron.mjs'

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
const fmt = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

test('every Monday 09:00', () => {
  const c = parseCron('0 9 * * 1')
  // 2026-11-23 is a Monday
  assert.equal(fmt(nextFire(c, at(2026, 11, 23, 8, 59))), '2026-11-23 9:00')
  assert.equal(fmt(nextFire(c, at(2026, 11, 23, 9, 0))), '2026-11-30 9:00')
  assert.equal(fmt(prevFire(c, at(2026, 11, 23, 9, 0))), '2026-11-23 9:00')
  assert.equal(fmt(prevFire(c, at(2026, 11, 23, 8, 59))), '2026-11-16 9:00')
})

test('steps, ranges, lists, names', () => {
  assert.equal(fmt(nextFire(parseCron('*/15 * * * *'), at(2026, 1, 1, 10, 7))), '2026-1-1 10:15')
  assert.equal(fmt(nextFire(parseCron('0 9-17/4 * * *'), at(2026, 1, 1, 10, 0))), '2026-1-1 13:00')
  assert.equal(fmt(nextFire(parseCron('30 8 * * mon,fri'), at(2026, 11, 24))), '2026-11-27 8:30')
  assert.equal(fmt(nextFire(parseCron('0 0 1 jan *'), at(2026, 3, 1))), '2027-1-1 0:00')
  assert.equal(fmt(nextFire(parseCron('@daily'), at(2026, 3, 1, 5))), '2026-3-2 0:00')
})

test('day-of-week 7 is Sunday', () => {
  const c = parseCron('0 0 * * 7')
  assert.equal(nextFire(c, at(2026, 11, 23)).getDay(), 0)
})

test('dom and dow both restricted means either', () => {
  const c = parseCron('0 0 13 * 5') // the 13th or any Friday
  assert.ok(matches(c, at(2026, 11, 13)))
  assert.ok(matches(c, at(2026, 11, 27))) // Friday
  assert.ok(!matches(c, at(2026, 11, 26)))
})

test('month boundaries and Feb 29', () => {
  assert.equal(fmt(nextFire(parseCron('0 12 31 * *'), at(2026, 11, 1))), '2026-12-31 12:00')
  assert.equal(fmt(nextFire(parseCron('0 0 29 2 *'), at(2026, 1, 1))), '2028-2-29 0:00')
  assert.equal(fmt(prevFire(parseCron('0 0 29 2 *'), at(2027, 1, 1))), '2024-2-29 0:00')
  assert.equal(fmt(prevFire(parseCron('59 23 * * *'), at(2026, 3, 1, 0, 0))), '2026-2-28 23:59')
})

test('invalid expressions', () => {
  for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '*/0 * * * *', '5-1 * * * *', 'x * * * *']) {
    assert.throws(() => parseCron(bad), e => e.code === 'invalid_cron', bad)
  }
})
