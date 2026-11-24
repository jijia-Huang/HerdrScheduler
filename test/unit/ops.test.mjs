import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'hsched-test-'))
process.env.HERDR_SCHEDULER_HOME = home
delete process.env.HERDR_SCHEDULER_ID
const ops = await import('../../lib/ops.mjs')
const { withLock } = await import('../../lib/store.mjs')
const { pwshLine, launchArgv, validate } = await import('../../lib/schema.mjs')

const cwd = tmpdir()
const TRICKY = '/hs-p0:p0-echo 中文 & | % "q" \'s\'\n第二行 $env:X `tick`'

test('add, list, show, update, remove', async () => {
  const r = await ops.addSchedule({ id: 'a1', when: '0 9 * * 1', cwd, task: TRICKY, command: 'skillpool inanna-slot' })
  assert.equal(r.added, true)
  assert.deepEqual(r.schedule.command, ['skillpool', 'inanna-slot'])
  assert.ok(r.next_fire)
  assert.match(r.launch_new, /^skillpool inanna-slot --session-id/)
  const saved = JSON.parse(readFileSync(join(home, 'schedules.json'), 'utf8'))
  assert.equal(saved.schedules[0].task, TRICKY)
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.ok(state.schedules.a1.last_fire_at)

  const list = await ops.listSchedules()
  assert.equal(list.schedules.length, 1)

  await assert.rejects(ops.addSchedule({ id: 'a1', when: '* * * * *', cwd, task: 'x' }), e => e.code === 'duplicate_id')
  await assert.rejects(ops.addSchedule({ id: 'Bad Id', when: '* * * * *', cwd, task: 'x' }), e => e.code === 'invalid_id')
  await assert.rejects(ops.addSchedule({ id: 'b', when: '* * *', cwd, task: 'x' }), e => e.code === 'invalid_cron' && !!e.hint)
  await assert.rejects(ops.addSchedule({ id: 'b', when: '* * * * *', cwd: join(cwd, 'nope-xyz'), task: 'x' }), e => e.code === 'cwd_not_found')
  await assert.rejects(ops.addSchedule({ id: 'b', when: '* * * * *', cwd, task: 'x', reuse: 'again' }), e => e.code === 'invalid_field')
  await assert.rejects(ops.addSchedule({ id: 'b', when: '* * * * *', cwd, task: 'x', timeout_minutes: 5 }), e => e.code === 'unknown_field')

  const dry = await ops.addSchedule({ id: 'b', when: '*/5 * * * *', cwd, task: 'x', dry_run: true })
  assert.equal(dry.dry_run, true)
  assert.equal((await ops.listSchedules()).schedules.length, 1)

  const u = await ops.updateSchedule({ id: 'a1', when: '*/10 * * * *', enabled: false })
  assert.equal(u.schedule.enabled, false)
  assert.equal(u.schedule.task, TRICKY)
  await assert.rejects(ops.runNow({ id: 'a1' }), e => e.code === 'disabled')
  await ops.updateSchedule({ id: 'a1', enabled: true })
  await ops.runNow({ id: 'a1' })
  assert.ok((await ops.getSchedule({ id: 'a1' })).run_now_requested)

  await assert.rejects(ops.getSchedule({ id: 'zzz' }), e => e.code === 'not_found')
  await ops.removeSchedule({ id: 'a1' })
  assert.equal((await ops.listSchedules()).schedules.length, 0)
})

test('self id from HERDR_SCHEDULER_ID', async () => {
  await ops.addSchedule({ id: 'me', when: '0 0 * * *', cwd, task: 'x' })
  process.env.HERDR_SCHEDULER_ID = 'me'
  try {
    assert.equal((await ops.getSchedule({})).schedule.id, 'me')
  } finally {
    delete process.env.HERDR_SCHEDULER_ID
  }
  await ops.removeSchedule({ id: 'me' })
})

test('lock: second holder waits or gives up', async () => {
  let inner
  await withLock(async () => {
    inner = await withLock(async () => 1, { waitMs: 0 })
  })
  assert.equal(inner.locked, false)
  const again = await withLock(async () => 2, { waitMs: 0 })
  assert.deepEqual(again, { locked: true, value: 2 })
})

test('launch command line for PowerShell', () => {
  const s = validate({ id: 'x', when: '* * * * *', cwd, task: 't', command: ['skillpool', 'inanna-slot'], args: ["it's"] })
  const argv = launchArgv(s, 'resume', 'abc')
  assert.deepEqual(argv, ['skillpool', 'inanna-slot', "it's", '--resume', 'abc'])
  assert.equal(pwshLine(argv), "& 'skillpool' 'inanna-slot' 'it''s' '--resume' 'abc'")
})

test('CLI keeps task text intact through --task-file and stdin', () => {
  const cli = fileURLToPath(new URL('../../bin/hsched.mjs', import.meta.url))
  const file = join(home, 'task.txt')
  writeFileSync(file, TRICKY, 'utf8')
  const env = { ...process.env, HERDR_SCHEDULER_HOME: home }
  execFileSync(process.execPath, [cli, 'add', 'c1', '--when', '0 9 * * *', '--cwd', cwd, '--task-file', file, '--json'], { env })
  execFileSync(process.execPath, [cli, 'add', 'c2', '--when', '0 9 * * *', '--cwd', cwd, '--task-file', '-', '--json'], { env, input: TRICKY })
  const shown = JSON.parse(execFileSync(process.execPath, [cli, 'show', 'c2', '--json'], { env, encoding: 'utf8' }))
  assert.equal(shown.ok, true)
  assert.equal(shown.schedule.task, TRICKY)
  const saved = JSON.parse(readFileSync(join(home, 'schedules.json'), 'utf8'))
  assert.equal(saved.schedules.find(s => s.id === 'c1').task, TRICKY)
  let err
  try { execFileSync(process.execPath, [cli, 'show', 'nope', '--json'], { env, encoding: 'utf8' }) } catch (e) { err = JSON.parse(e.stdout) }
  assert.equal(err.ok, false)
  assert.equal(err.error.code, 'not_found')
})
