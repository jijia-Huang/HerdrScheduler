// Helpers for M0 experiments on the isolated herdr session (HERDR_SOCKET_PATH must point at it).
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { herdr } from '../../lib/herdr.mjs'
import { pwshLine } from '../../lib/schema.mjs'

export const here = dirname(fileURLToPath(import.meta.url))
export const home = join(here, 'home')
export const pluginDir = join(here, '..', '..', 'claude-plugin', 'herdr-scheduler')
export const sleep = ms => new Promise(r => setTimeout(r, ms))
mkdirSync(join(here, 'out'), { recursive: true })

export function logger(label) {
  const t0 = Date.now()
  const file = join(here, 'out', `${label}.jsonl`)
  return row => {
    const line = { t: ((Date.now() - t0) / 1000).toFixed(1), ...row }
    appendFileSync(file, JSON.stringify(line) + '\n')
    console.log(JSON.stringify(line).slice(0, 400))
  }
}

export const report = (id, kind) => {
  const p = join(home, 'reports', kind === 'turn' ? `${id}.turn.json` : `${id}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

export async function startClaude({ workspace, id, cwd, extra = [] }) {
  const tab = await herdr.tabCreate({ workspace, cwd, label: id, env: { HERDR_SCHEDULER_ID: id, HERDR_SCHEDULER_HOME: home, HERDR_SCHEDULER_RUN: 'm0' } })
  const pane = tab.root_pane.pane_id
  await herdr.paneWaitOutput(pane, { regex: 'PS .*>\\s*$', timeout: 30000 })
  const session = randomUUID()
  const line = pwshLine(['claude', '--plugin-dir', pluginDir, '--session-id', session, ...extra])
  await herdr.paneRun(pane, line)
  return { pane, session, startedAt: new Date().toISOString() }
}

export async function waitFor(fn, { timeout = 180000, every = 1000 } = {}) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(every)
  }
  return null
}
