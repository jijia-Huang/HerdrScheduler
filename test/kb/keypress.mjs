// Live check of the prefix+alt+s keybinding: run a herdr client inside a pane of the isolated
// session, send it real keystrokes, and look for the action in the plugin log.
import { herdr } from '../../lib/herdr.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const socket = process.env.HERDR_SOCKET_PATH
const ws = await herdr.workspaceCreate({ label: 'kbtest', cwd: 'D:\\Tool\\HerdrScheduler' })
const pane = ws.root_pane.pane_id
await herdr.paneWaitOutput(pane, { regex: 'PS .*>\\s*$', timeout: 30000 })
// Hide the "inside herdr" markers so the client does not refuse to nest, then attach to this session.
await herdr.paneRun(pane, "Remove-Item Env:HERDR_ENV,Env:HERDR_PANE_ID,Env:HERDR_TAB_ID,Env:HERDR_WORKSPACE_ID,Env:HERDR_SOCKET_PATH -ErrorAction SilentlyContinue; herdr --session schedk")
await sleep(8000)
console.log('--- client screen\n' + (await herdr.paneRead(pane, { source: 'visible', lines: 15 })))
const before = await herdr.call(['plugin', 'log', 'list', '--plugin', 'herdr-scheduler'])
await herdr.paneSendKeys(pane, 'ctrl+b')
await sleep(400)
await herdr.paneSendKeys(pane, 'alt+s')
await sleep(6000)
const after = await herdr.call(['plugin', 'log', 'list', '--plugin', 'herdr-scheduler'])
const fresh = (after.logs ?? []).filter(l => !(before.logs ?? []).some(b => b.log_id === l.log_id))
console.log('--- new plugin log entries')
for (const l of fresh) console.log(JSON.stringify({ action: l.action_id ?? null, event: l.event ?? null, status: l.status, stdout: (l.stdout ?? '').slice(0, 160), source: l.invocation_source ?? l.context?.invocation_source ?? null }))
console.log(`PANE ${pane} socket ${socket}`)
