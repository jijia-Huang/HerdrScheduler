// [[startup]]: runs once each time the herdr server starts. Make sure one scheduler pane runs.
import { setup } from './common.mjs'

const opts = setup()
const { ensureScheduler } = await import('../lib/scheduler.mjs')
const { tickLog } = await import('../lib/deliver.mjs')
try {
  const r = await ensureScheduler({ pluginId: opts.pluginId, reason: 'startup' })
  console.log(JSON.stringify(r))
} catch (error) {
  tickLog(`startup failed: ${error?.message ?? error}`)
  console.error(String(error?.message ?? error))
  process.exitCode = 1
}
