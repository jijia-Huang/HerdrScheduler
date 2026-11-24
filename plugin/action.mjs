// [[actions]]: open (make sure the scheduler pane runs) and tick-now.
import { setup } from './common.mjs'

const opts = setup()
const what = opts.rest[0]
if (what === 'open') {
  const { ensureScheduler } = await import('../lib/scheduler.mjs')
  const r = await ensureScheduler({ pluginId: opts.pluginId, reason: 'action' })
  // The user pressed the key to look at the scheduler: switch the view to its tab.
  if (r?.pane_id) {
    const { herdr } = await import('../lib/herdr.mjs')
    const pane = await herdr.paneGet(r.pane_id).catch(() => null)
    if (pane?.workspace_id) await herdr.workspaceFocus(pane.workspace_id).catch(() => null)
    if (pane?.tab_id) await herdr.tabFocus(pane.tab_id).catch(() => null)
    r.focused = !!pane
  }
  console.log(JSON.stringify(r))
} else if (what === 'tick-now') {
  const { tick } = await import('../lib/tick.mjs')
  console.log(JSON.stringify(await tick()))
} else {
  console.error(`unknown action ${what}`)
  process.exitCode = 1
}
