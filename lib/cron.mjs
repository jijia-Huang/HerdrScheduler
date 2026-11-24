// 5-field cron in local time: minute hour day-of-month month day-of-week.
// Supports *, n, a-b, */s, a-b/s, n/s, lists, month/day names, and @hourly/@daily/@weekly/@monthly/@yearly.
// Day-of-month and day-of-week follow classic cron: when both are restricted, either one matches.
import { fail } from './errors.mjs'

const MACROS = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, base: 1 },
  { name: 'day-of-week', min: 0, max: 7, names: DAYS, base: 0 },
]
const HINT = 'Use 5 fields "minute hour day-of-month month day-of-week", e.g. "0 9 * * 1" = every Monday 09:00, "*/30 * * * *" = every 30 minutes.'

function value(text, field, expr) {
  const lower = text.toLowerCase()
  if (field.names) {
    const index = field.names.indexOf(lower)
    if (index >= 0) return index + field.base
  }
  if (!/^\d+$/.test(text)) fail('invalid_cron', `"${expr}": "${text}" is not a valid ${field.name}`, HINT)
  const n = Number(text)
  if (n < field.min || n > field.max) fail('invalid_cron', `"${expr}": ${field.name} ${n} is outside ${field.min}-${field.max}`, HINT)
  return n
}

function parseField(text, field, expr) {
  const set = new Set()
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/')
    let step = 1
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) fail('invalid_cron', `"${expr}": bad step "${stepText}"`, HINT)
      step = Number(stepText)
    }
    let lo, hi
    if (range === '*') {
      lo = field.min
      hi = field.name === 'day-of-week' ? 6 : field.max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      lo = value(a, field, expr)
      hi = value(b, field, expr)
      if (lo > hi) fail('invalid_cron', `"${expr}": range ${range} goes backwards`, HINT)
    } else {
      lo = value(range, field, expr)
      hi = stepText !== undefined ? (field.name === 'day-of-week' ? 6 : field.max) : lo
    }
    for (let v = lo; v <= hi; v += step) set.add(field.name === 'day-of-week' && v === 7 ? 0 : v)
  }
  return set
}

export function parseCron(expr) {
  if (typeof expr !== 'string' || expr.trim() === '') fail('invalid_cron', 'when is empty', HINT)
  const source = MACROS[expr.trim().toLowerCase()] ?? expr.trim()
  const parts = source.split(/\s+/)
  if (parts.length !== 5) fail('invalid_cron', `"${expr}" has ${parts.length} fields, expected 5`, HINT)
  const sets = parts.map((p, i) => parseField(p, FIELDS[i], expr))
  return {
    expr,
    minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4],
    domStar: parts[2] === '*', dowStar: parts[4] === '*',
  }
}

function dayMatches(c, d) {
  const dom = c.dom.has(d.getDate())
  const dow = c.dow.has(d.getDay())
  if (c.domStar && c.dowStar) return true
  if (c.domStar) return dow
  if (c.dowStar) return dom
  return dom || dow
}

export function matches(c, d) {
  return c.minute.has(d.getMinutes()) && c.hour.has(d.getHours()) && c.month.has(d.getMonth() + 1) && dayMatches(c, d)
}

const LIMIT = 6 * 366 * 24 // enough steps to cover several years of hour/day skips

// First fire time strictly after `after`.
export function nextFire(c, after = new Date()) {
  const d = new Date(after)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  for (let i = 0; i < LIMIT * 60; i += 1) {
    if (!c.month.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue }
    if (!dayMatches(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue }
    if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue }
    if (!c.minute.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue }
    return d
  }
  return null
}

// Latest fire time at or before `at`.
export function prevFire(c, at = new Date()) {
  const d = new Date(at)
  d.setSeconds(0, 0)
  for (let i = 0; i < LIMIT * 60; i += 1) {
    if (!c.month.has(d.getMonth() + 1)) { d.setDate(1); d.setHours(0, 0, 0, 0); d.setMinutes(-1); continue }
    if (!dayMatches(c, d)) { d.setHours(0, 0, 0, 0); d.setMinutes(-1); continue }
    if (!c.hour.has(d.getHours())) { d.setMinutes(0, 0, 0); d.setMinutes(-1); continue }
    if (!c.minute.has(d.getMinutes())) { d.setMinutes(d.getMinutes() - 1, 0, 0); continue }
    return d
  }
  return null
}
