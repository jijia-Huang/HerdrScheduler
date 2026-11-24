// Schedule operations shared by the CLI and the MCP server. Every function takes one
// plain object and returns a plain object; failures throw OpError with a fixed code.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { files, TOOL_ROOT } from './paths.mjs'
import { loadSchedules, saveSchedules, loadState, saveState, withLock, readRuns } from './store.mjs'
import { validate, FIELDS, launchArgv } from './schema.mjs'
import { parseCron, nextFire } from './cron.mjs'
import { fail } from './errors.mjs'

const iso = d => (d ? new Date(d).toISOString() : null)
const localTime = d => (d ? new Date(d).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null)

function resolveId(args) {
  const id = args.id ?? process.env.HERDR_SCHEDULER_ID
  if (!id) fail('missing_id', 'id is required', 'Pass the schedule id. Inside a scheduled work pane it defaults to that pane\'s own schedule.')
  return id
}

function find(data, id) {
  const s = data.schedules.find(x => x.id === id)
  if (!s) fail('not_found', `no schedule with id "${id}"`, `Existing ids: ${data.schedules.map(x => x.id).join(', ') || '(none)'}`)
  return s
}

function pick(args) {
  const out = {}
  for (const key of FIELDS) if (args[key] !== undefined) out[key] = args[key]
  return out
}

function unknownKeys(args, extra) {
  for (const key of Object.keys(args)) {
    if (!FIELDS.includes(key) && !extra.includes(key)) {
      fail('unknown_field', `unknown field "${key}"`, `Allowed fields: ${[...FIELDS, ...extra].join(', ')}`)
    }
  }
}

function preview(s) {
  return {
    next_fire: iso(nextFire(parseCron(s.when))),
    next_fire_local: localTime(nextFire(parseCron(s.when))),
    launch_new: launchArgv(s, 'new', '<new uuid>').join(' '),
    launch_resume: launchArgv(s, 'resume', '<session id>').join(' '),
  }
}

function runtime(st) {
  if (!st) return { last_fire_at: null, binding: null, run: null, pending: null }
  return {
    last_fire_at: st.last_fire_at ?? null,
    binding: st.binding ? { pane_id: st.binding.pane_id, session_id: st.binding.session_id ?? null } : null,
    run: st.run ? { run_id: st.run.id, state: st.run.state, fired_at: st.run.fired_at, sent_at: st.run.sent_at ?? null } : null,
    pending: st.pending ?? null,
    run_now_requested: !!st.force_at,
  }
}

export async function listSchedules() {
  const data = loadSchedules()
  const state = loadState()
  return {
    schedules: data.schedules.map(s => ({
      id: s.id,
      when: s.when,
      enabled: s.enabled !== false,
      cwd: s.cwd,
      command: (s.command ?? ['claude']).join(' '),
      task_preview: s.task.length > 80 ? s.task.slice(0, 80) + '…' : s.task,
      next_fire: s.enabled === false ? null : iso(nextFire(parseCron(s.when))),
      next_fire_local: s.enabled === false ? null : localTime(nextFire(parseCron(s.when))),
      ...runtime(state.schedules[s.id]),
    })),
  }
}

export async function getSchedule(args = {}) {
  const id = resolveId(args)
  const data = loadSchedules()
  const s = find(data, id)
  const state = loadState()
  const runs = readRuns().filter(r => r.schedule_id === id).slice(-5).reverse()
  return { schedule: validate(s, { checkCwd: false }), ...preview(validate(s, { checkCwd: false })), ...runtime(state.schedules[id]), recent_runs: runs }
}

export async function addSchedule(args = {}) {
  unknownKeys(args, ['dry_run'])
  const s = validate(pick(args))
  if (args.dry_run) {
    const data = loadSchedules()
    if (data.schedules.some(x => x.id === s.id)) fail('duplicate_id', `schedule "${s.id}" already exists`, 'Pick another id, or use schedule_update to change it.')
    return { dry_run: true, schedule: s, ...preview(s) }
  }
  await withLock(async () => {
    const data = loadSchedules()
    if (data.schedules.some(x => x.id === s.id)) fail('duplicate_id', `schedule "${s.id}" already exists`, 'Pick another id, or use schedule_update to change it.')
    data.schedules.push(s)
    saveSchedules(data)
    const state = loadState()
    // Start counting from now so a new schedule does not fire at once as "missed".
    state.schedules[s.id] = { last_fire_at: new Date().toISOString() }
    saveState(state)
  })
  return { added: true, schedule: s, ...preview(s) }
}

export async function updateSchedule(args = {}) {
  unknownKeys(args, ['dry_run'])
  const id = resolveId(args)
  const changes = pick(args)
  delete changes.id
  if (Object.keys(changes).length === 0) fail('nothing_to_change', 'no fields to change', `Pass one or more of: ${FIELDS.filter(f => f !== 'id').join(', ')}`)
  const apply = () => {
    const data = loadSchedules()
    const old = find(data, id)
    const s = validate({ ...old, ...changes })
    return { data, old, s }
  }
  if (args.dry_run) {
    const { s } = apply()
    return { dry_run: true, schedule: s, ...preview(s) }
  }
  const { value } = await withLock(async () => {
    const { data, old, s } = apply()
    data.schedules[data.schedules.indexOf(old)] = s
    saveSchedules(data)
    const state = loadState()
    const st = (state.schedules[id] ??= {})
    // A new time or re-enabling starts counting from now: no surprise "missed" run.
    if (changes.when !== undefined && changes.when !== old.when) st.last_fire_at = new Date().toISOString()
    if (changes.enabled === true && old.enabled === false) st.last_fire_at = new Date().toISOString()
    saveState(state)
    return s
  })
  return { updated: true, schedule: value, ...preview(value) }
}

export async function removeSchedule(args = {}) {
  const id = resolveId(args)
  let binding = null
  await withLock(async () => {
    const data = loadSchedules()
    const s = find(data, id)
    data.schedules.splice(data.schedules.indexOf(s), 1)
    saveSchedules(data)
    const state = loadState()
    binding = state.schedules[id]?.binding ?? null
    delete state.schedules[id]
    saveState(state)
  })
  return {
    removed: id,
    note: binding?.pane_id ? `Its work pane ${binding.pane_id} was left open; close it in herdr if you no longer need it.` : undefined,
  }
}

export async function runNow(args = {}) {
  const id = resolveId(args)
  await withLock(async () => {
    const data = loadSchedules()
    const s = find(data, id)
    if (s.enabled === false) fail('disabled', `schedule "${id}" is paused`, 'Enable it first (enabled: true).')
    const state = loadState()
    const st = (state.schedules[id] ??= {})
    st.force_at = new Date().toISOString()
    saveState(state)
  })
  if (args.kick) {
    kickTick()
    return { requested: id, note: 'Started now: a scheduler tick was triggered. Claude needs about a minute to start up before the task is sent; you get a notification when it finishes.' }
  }
  return { requested: id, note: 'It fires on the next scheduler tick (within about a minute).' }
}

// Run one tick right away in a detached process, so run-now starts without waiting for the
// scheduler pane's next minute. If a tick is already running it just exits (lock), and the
// scheduler pane picks the request up instead.
export function kickTick() {
  try {
    const child = spawn(process.execPath, [join(TOOL_ROOT, 'bin', 'hsched.mjs'), 'tick', '--json'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    })
    child.on('error', () => {})
    child.unref()
  } catch {}
}

export async function listRuns(args = {}) {
  const id = args.id ?? (args.self ? process.env.HERDR_SCHEDULER_ID : undefined)
  const limit = Math.max(1, Math.min(Number(args.limit ?? 20), 200))
  let runs = readRuns()
  if (id) runs = runs.filter(r => r.schedule_id === id)
  return { runs: runs.slice(-limit).reverse() }
}

export async function getResult(args = {}) {
  let runId = args.run_id
  if (!runId) {
    const id = resolveId(args)
    const last = readRuns().filter(r => r.schedule_id === id && r.result_path).at(-1)
    if (!last) fail('not_found', `schedule "${id}" has no finished run with a result yet`)
    runId = last.run_id
  }
  const run = readRuns().find(r => r.run_id === runId)
  if (!run) fail('not_found', `no run with id "${runId}"`, 'List runs with run_list.')
  const path = run.result_path ?? join(files().results, run.schedule_id, `${runId}.md`)
  if (!existsSync(path)) fail('no_result', `run "${runId}" has no result file`, `Its status is ${run.status}${run.note ? `: ${run.note}` : ''}.`)
  return { run, result: readFileSync(path, 'utf8') }
}

export const newRunId = () => `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${randomUUID().slice(0, 6)}`
