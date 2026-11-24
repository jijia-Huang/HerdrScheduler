// State machine tests against a fake herdr world (no real herdr or Claude).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'hsched-machine-'))
process.env.HERDR_SCHEDULER_HOME = home
const ops = await import('../../lib/ops.mjs')
const { tick } = await import('../../lib/tick.mjs')
const { loadState, saveState, readRuns } = await import('../../lib/store.mjs')
const { writeResult } = await import('../../lib/deliver.mjs')
const { appendRun } = await import('../../lib/store.mjs')

const PROMPT = '(base) PS D:\\work>'
let world, io, clock, ids

function makeWorld() {
  let n = 0
  let term = 0
  const panes = new Map()
  const w = {
    panes, prompts: [], runs: [], closed: [], notes: [], workspace: null, start: null, turn: null, sessionSeq: 0,
    newPane(tab) {
      n += 1
      const p = { pane_id: `w1:p${n}`, terminal_id: `term${++term}`, tab_id: tab ?? `w1:t${n}`, agent_status: 'unknown', screen: PROMPT, claude: false }
      panes.set(p.pane_id, p)
      return p
    },
    restart() { for (const p of panes.values()) { p.terminal_id = `term${++term}`; p.claude = false; p.screen = PROMPT; p.agent_status = 'unknown' } },
  }
  return w
}

function makeIo() {
  const h = {
    workspaceGet: async id => (world.workspace === id ? { workspace_id: id } : null),
    workspaceCreate: async () => { world.workspace = 'w1'; const p = world.newPane(); return { workspace: { workspace_id: 'w1' }, tab: { tab_id: p.tab_id }, root_pane: { ...p } } },
    tabCreate: async () => { const p = world.newPane(); return { root_pane: { ...p } } },
    tabRename: async () => ({}),
    paneGet: async id => { const p = world.panes.get(id); return p ? { ...p, agent: p.claude ? 'claude' : undefined } : null },
    paneList: async () => [...world.panes.values()].map(p => ({ ...p })),
    paneRead: async id => world.panes.get(id)?.screen ?? '',
    paneRun: async (id, line) => { const p = world.panes.get(id); world.runs.push({ id, line }); p.claude = true; p.screen = 'Claude Code'; p.agent_status = 'idle' },
    paneClose: async id => { world.closed.push(id); world.panes.delete(id) },
    processInfo: async id => { const p = world.panes.get(id); return p ? { foreground_processes: [{ name: p.claude ? 'claude.exe' : 'powershell.exe' }] } : null },
    agentPrompt: async (id, text) => { world.prompts.push({ id, text }); world.panes.get(id).agent_status = 'working' },
  }
  return {
    herdr: h,
    home,
    sessionStart: () => world.start,
    lastTurn: () => world.turn,
    finish: async (s, run, status, opts) => { appendRun({ run_id: run.id, schedule_id: s.id, status, note: opts.note ?? null, result_path: opts.result_path ?? null }); world.notes.push(status) },
    writeResult,
    notify: async (title) => { world.notes.push(title) },
    log: () => {},
    newSession: () => `sess-${++world.sessionSeq}`,
  }
}

const at = ms => new Date(ms).toISOString()
const T0 = Date.parse('2026-11-23T10:00:30+08:00')
const run = async () => tick({ io, now: clock })
const st = id => loadState().schedules[id]
const advance = sec => { clock += sec * 1000 }

beforeEach(async () => {
  world = makeWorld()
  io = makeIo()
  clock = T0
  for (const s of (await ops.listSchedules()).schedules) await ops.removeSchedule({ id: s.id })
  saveState({ schedules: {} })
})

async function addAndStart(extra = {}) {
  await ops.addSchedule({ id: 'job', when: '0 9 * * 1', cwd: tmpdir(), task: '/do-it 中文 & | %', ...extra })
  const state = loadState()
  state.schedules.job.force_at = at(clock)
  saveState(state)
  await run() // fire -> queued -> open pane -> starting -> launch (prompt is there)
  assert.equal(st('job').run.state, 'starting')
  assert.equal(world.runs.length, 1)
  assert.match(world.runs[0].line, /^& 'claude' '--session-id' 'sess-1'$/)
  world.start = { at: at(clock + 5000), session_id: 'sess-1', source: 'startup' }
  advance(30)
  await run() // -> ready (safety wait starts at SessionStart time)
  assert.equal(st('job').run.state, 'ready')
  advance(60)
  await run() // -> sent
  assert.equal(st('job').run.state, 'sent')
  assert.equal(world.prompts.at(-1).text, '/do-it 中文 & | %')
}

test('new pane, ready, sent, background tasks wait, then completed', async () => {
  await addAndStart()
  world.turn = { at: at(clock + 10000), session_id: 'sess-1', last_assistant_message: 'still going', background_tasks: [{ id: 'x', status: 'running' }] }
  advance(60)
  await run()
  assert.equal(st('job').run.state, 'sent')
  world.turn = { at: at(clock + 10000), session_id: 'sess-1', last_assistant_message: '全部完成\n細節', background_tasks: [] }
  world.panes.get(st('job').binding.pane_id).agent_status = 'done'
  advance(60)
  await run()
  assert.equal(st('job').run, null)
  const last = readRuns().at(-1)
  assert.equal(last.status, 'completed')
  assert.ok(existsSync(last.result_path))
  assert.match(readFileSync(last.result_path, 'utf8'), /全部完成/)
})

test('next fire reuses the live idle pane at once', async () => {
  await addAndStart()
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'ok', background_tasks: [] }
  advance(60)
  await run()
  world.panes.get(st('job').binding.pane_id).agent_status = 'done'
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(60)
  await run()
  assert.equal(st('job').run.state, 'sent')
  assert.equal(st('job').run.path, 'reuse_pane')
  assert.equal(world.runs.length, 1) // no new launch
})

test('after a herdr restart: close the restored shell, resume the same session in a new tab', async () => {
  await addAndStart()
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'ok', background_tasks: [] }
  advance(60)
  await run()
  const oldPane = st('job').binding.pane_id
  world.restart()
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(60)
  await run()
  assert.deepEqual(world.closed, [oldPane])
  assert.equal(st('job').run.path, 'resume_new_pane')
  assert.match(world.runs.at(-1).line, /'--resume' 'sess-1'/)
})

test('resume that finds no conversation falls back to a new one in the same pane', async () => {
  await addAndStart()
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'ok', background_tasks: [] }
  advance(60)
  await run()
  const p = world.panes.get(st('job').binding.pane_id)
  p.claude = false
  p.screen = PROMPT
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(60)
  await run()
  assert.equal(st('job').run.path, 'resume_in_pane')
  p.claude = false
  p.screen = `No conversation found with session ID: sess-1\n${PROMPT}`
  advance(30)
  await run()
  assert.equal(st('job').run.path, 'new_after_resume_failed')
  assert.match(world.runs.at(-1).line, /'--session-id' 'sess-2'/)
})

test('pane closed while sent: lost', async () => {
  await addAndStart()
  world.panes.delete(st('job').binding.pane_id)
  advance(60)
  await run()
  assert.equal(st('job').run, null)
  assert.equal(readRuns().at(-1).status, 'lost')
})

test('fire while still sent: notify, queue, then abandon when idle with no Stop', async () => {
  await addAndStart()
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(30)
  await run()
  assert.ok(st('job').pending)
  assert.ok(world.notes.some(n => /上一次還沒結束/.test(n)))
  world.panes.get(st('job').binding.pane_id).agent_status = 'idle'
  advance(150)
  await run()
  const runs = readRuns()
  assert.equal(runs.at(-1).status, 'abandoned')
  assert.equal(st('job').pending, null)
  assert.equal(st('job').run.state, 'sent') // the new run went straight to the idle pane
})

test('Stop with background tasks still running is not abandoned', async () => {
  await addAndStart()
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'bg', background_tasks: [{ status: 'running' }] }
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  world.panes.get(st('job').binding.pane_id).agent_status = 'idle'
  advance(300)
  await run()
  assert.equal(st('job').run.state, 'sent')
  assert.ok(st('job').pending)
})

test('on_busy=skip while sent', async () => {
  await addAndStart({ on_busy: 'skip' })
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(30)
  await run()
  assert.equal(readRuns().at(-1).status, 'skipped')
  assert.ok(!st('job').pending)
})

test('permission dialog notifies once', async () => {
  await addAndStart()
  const p = world.panes.get(st('job').binding.pane_id)
  p.screen = ' Do you want to create x.txt?\n ❯ 1. Yes\n   3. No\n Esc to cancel · Tab to amend'
  advance(60); await run()
  advance(60); await run()
  assert.equal(world.notes.filter(n => /在等你回答/.test(n)).length, 1)
})

test('missed with on_missed=skip records missed and does not run', async () => {
  await ops.addSchedule({ id: 'job', when: '0 9 * * *', cwd: tmpdir(), task: 'x', on_missed: 'skip' })
  const s = loadState(); s.schedules.job.last_fire_at = '2026-11-20T00:00:00Z'; saveState(s)
  await run()
  assert.equal(st('job').run ?? null, null)
  assert.equal(readRuns().at(-1).status, 'missed')
})

test('missed with run_once runs once even after several missed days', async () => {
  await ops.addSchedule({ id: 'job', when: '0 9 * * *', cwd: tmpdir(), task: 'x' })
  const s = loadState(); s.schedules.job.last_fire_at = '2026-11-20T00:00:00Z'; saveState(s)
  await run()
  assert.equal(st('job').run.state, 'starting')
  advance(60)
  await run()
  assert.equal(world.runs.length, 1)
})

test('reuse=clear sends /clear and waits for the clear SessionStart', async () => {
  await addAndStart({ reuse: 'clear' })
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'ok', background_tasks: [] }
  advance(60); await run()
  world.panes.get(st('job').binding.pane_id).agent_status = 'done'
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(60); await run()
  assert.equal(st('job').run.state, 'clearing')
  assert.equal(world.prompts.at(-1).text, '/clear')
  world.start = { at: at(clock + 2000), session_id: 'sess-new', source: 'clear' }
  advance(60); await run()
  assert.equal(st('job').run.state, 'ready')
  assert.equal(st('job').binding.session_id, 'sess-new')
  world.panes.get(st('job').binding.pane_id).agent_status = 'idle'
  advance(60); await run()
  assert.equal(st('job').run.state, 'sent')
})

test('reuse=fresh closes the old pane and starts a new conversation', async () => {
  await addAndStart({ reuse: 'fresh' })
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'ok', background_tasks: [] }
  advance(60); await run()
  const oldPane = st('job').binding.pane_id
  world.panes.get(oldPane).agent_status = 'done'
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(60); await run()
  assert.deepEqual(world.closed, [oldPane])
  assert.equal(st('job').run.path, 'new')
  assert.notEqual(st('job').binding.pane_id, oldPane)
  assert.match(world.runs.at(-1).line, /'--session-id' 'sess-2'/)
})

test('a busy pane whose foreground process is a tool (not claude.exe) is still live', async () => {
  await addAndStart()
  const p = world.panes.get(st('job').binding.pane_id)
  const realInfo = io.herdr.processInfo
  io.herdr.processInfo = async () => ({ foreground_processes: [{ name: 'bash.exe' }] })
  p.screen = '● Running…\n  ⎿  $ ping -n 80 127.0.0.1'
  advance(60); await run()
  assert.equal(st('job').run.state, 'sent')
  io.herdr.processInfo = realInfo
})

test('a Stop from the previous turn landing after tick start does not complete the new run', async () => {
  await addAndStart()
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'old', background_tasks: [] }
  advance(60); await run()
  world.panes.get(st('job').binding.pane_id).agent_status = 'done'
  // The old turn's Stop is written 2 s after the next tick starts, before that tick sends.
  const s = loadState(); s.schedules.job.force_at = at(clock); saveState(s)
  advance(60)
  world.turn = { at: at(clock + 2000), session_id: 'sess-1', last_assistant_message: 'late old stop', background_tasks: [] }
  await run()
  assert.equal(st('job').run.state, 'sent')
  advance(60); await run()
  assert.equal(st('job').run.state, 'sent') // still waiting for its own Stop
  world.turn = { at: at(clock + 1000), session_id: 'sess-1', last_assistant_message: 'new', background_tasks: [] }
  advance(60); await run()
  assert.equal(st('job').run, null)
  assert.match(readFileSync(readRuns().at(-1).result_path, 'utf8'), /new/)
})

test('changing cwd drops the binding', async () => {
  await addAndStart()
  await ops.updateSchedule({ id: 'job', cwd: join(tmpdir(), '..') })
  advance(60)
  await run()
  assert.equal(st('job').binding, null)
})

test('idle tick without due schedules does not call herdr', async () => {
  await ops.addSchedule({ id: 'job', when: '0 9 * * 1', cwd: tmpdir(), task: 'x' })
  let calls = 0
  for (const k of Object.keys(io.herdr)) { const f = io.herdr[k]; io.herdr[k] = (...a) => { calls += 1; return f(...a) } }
  await run()
  assert.equal(calls, 0)
})
