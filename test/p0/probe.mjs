// P0 probe: start a command in a new tab of the test session and record a timeline of
// herdr agent status and report-hook lines until both settle or the timeout passes.
// usage: node probe.mjs <label> <timeoutSec> <command line>
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [label, timeoutSec, cmd] = process.argv.slice(2)
const hooks = join(here, 'out', 'hooks.jsonl')
const timeline = join(here, 'out', `timeline-${label}.jsonl`)
const h = (...args) => JSON.parse(execFileSync('herdr', args, { encoding: 'utf8' }))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const hookCount = () => (existsSync(hooks) ? readFileSync(hooks, 'utf8').trim().split('\n').filter(Boolean).length : 0)
const log = row => { const line = { t: ((Date.now() - t0) / 1000).toFixed(1), ...row }; appendFileSync(timeline, JSON.stringify(line) + '\n'); console.log(JSON.stringify(line)) }

const tab = h('tab', 'create', '--workspace', 'w2', '--cwd', 'D:\\Tool\\HerdrScheduler\\test\\p0', '--label', label, '--env', `HERDR_SCHEDULER_ID=${label}`, '--no-focus')
const pane = tab.result.root_pane.pane_id
await sleep(2500)
const t0 = Date.now()
execFileSync('herdr', ['pane', 'run', pane, cmd])
log({ pane, sent: cmd })
let lastStatus = null
let lastHooks = hookCount()
while (Date.now() - t0 < Number(timeoutSec) * 1000) {
  const p = h('pane', 'get', pane).result.pane
  const status = `${p.agent ?? '-'}:${p.agent_status}`
  if (status !== lastStatus) { log({ status, seq: p.state_change_seq ?? null }); lastStatus = status }
  const n = hookCount()
  if (n !== lastHooks) {
    const lines = readFileSync(hooks, 'utf8').trim().split('\n').slice(lastHooks)
    for (const l of lines) log({ hook: JSON.parse(l) })
    lastHooks = n
  }
  await sleep(1000)
}
log({ done: true, pane })
