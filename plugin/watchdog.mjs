// [[events]] watchdog. Runs on pane.closed and on the very frequent pane.agent_status_changed,
// so the common path only reads two small files and exits.
import { setup } from './common.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const opts = setup()
const { files } = await import('../lib/paths.mjs')
const f = files()
const readJson = path => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

let event = {}
try { event = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON ?? '{}') } catch {}
const state = readJson(f.state) ?? {}
const hb = readJson(f.heartbeat)
const closedScheduler = event.event === 'pane_closed' && event.data?.pane_id && event.data.pane_id === state.scheduler_pane?.pane_id
const stale = !hb?.at || Date.now() - Date.parse(hb.at) > 2 * 60 * 1000

if (closedScheduler || stale) {
  // Back off: at most one repair attempt a minute, however many events arrive.
  const mark = join(f.home, 'watchdog.json')
  const last = readJson(mark)
  if (!last?.at || Date.now() - Date.parse(last.at) > 60 * 1000) {
    try { writeFileSync(mark, JSON.stringify({ at: new Date().toISOString(), why: closedScheduler ? 'scheduler pane closed' : 'heartbeat stale' })) } catch {}
    const { ensureScheduler } = await import('../lib/scheduler.mjs')
    const { tickLog } = await import('../lib/deliver.mjs')
    try {
      const r = await ensureScheduler({ pluginId: opts.pluginId, reason: closedScheduler ? 'watchdog: pane closed' : 'watchdog: heartbeat stale' })
      if (r?.opened) tickLog(`watchdog reopened the scheduler pane (${closedScheduler ? 'closed' : 'stale heartbeat'})`)
    } catch (error) {
      tickLog(`watchdog failed: ${error?.message ?? error}`)
    }
  }
}
