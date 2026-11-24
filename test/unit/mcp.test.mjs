import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const server = fileURLToPath(new URL('../../claude-plugin/herdr-scheduler/mcp/server.mjs', import.meta.url))
const TRICKY = '/inanna-irpc:slot-weekly 我是儒儒 & | % "q" \'s\'\n第二行'

function start(env) {
  const child = spawn(process.execPath, [server], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  createInterface({ input: child.stdout }).on('line', line => {
    const msg = JSON.parse(line)
    waiting.get(msg.id)?.(msg)
  })
  let id = 0
  const rpc = (method, params) => new Promise(resolve => {
    id += 1
    waiting.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const tool = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args })
    return { isError: !!r.result.isError, body: JSON.parse(r.result.content[0].text) }
  }
  return { child, rpc, tool }
}

test('MCP: list tools, add with tricky task, errors with hints', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hsched-mcp-'))
  const { child, rpc, tool } = start({ HERDR_SCHEDULER_HOME: home, HERDR_SCHEDULER_ID: '' })
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' })
    assert.match(init.result.instructions, /HerdrScheduler/)
    const list = await rpc('tools/list', {})
    const names = list.result.tools.map(t => t.name)
    assert.deepEqual(names, ['schedule_list', 'schedule_get', 'schedule_add', 'schedule_update', 'schedule_remove', 'schedule_run_now', 'run_list', 'run_result', 'scheduler_status'])

    const added = await tool('schedule_add', { id: 'weekly', when: '0 9 * * 1', cwd: tmpdir(), task: TRICKY, command: ['skillpool', 'inanna-slot'] })
    assert.equal(added.isError, false)
    assert.equal(added.body.ok, true)
    assert.ok(added.body.next_fire)
    const saved = JSON.parse(readFileSync(join(home, 'schedules.json'), 'utf8'))
    assert.equal(saved.schedules[0].task, TRICKY)

    const bad = await tool('schedule_add', { id: 'x', when: '9am mondays', cwd: tmpdir(), task: 't' })
    assert.equal(bad.isError, true)
    assert.equal(bad.body.error.code, 'invalid_cron')
    assert.ok(bad.body.error.hint)

    const upd = await tool('schedule_update', { id: 'weekly', enabled: false })
    assert.equal(upd.body.schedule.enabled, false)
    const got = await tool('schedule_get', { id: 'weekly' })
    assert.equal(got.body.schedule.task, TRICKY)
    const status = await tool('scheduler_status', {})
    assert.equal(status.body.ok, true)
    assert.ok(Array.isArray(status.body.checks))
    const rm = await tool('schedule_remove', { id: 'weekly' })
    assert.equal(rm.body.removed, 'weekly')
  } finally {
    child.kill()
  }
})
