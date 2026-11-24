// Live check: a Claude in herdr-commander's commander role (Write/Edit blocked) operates
// schedules through the MCP tools. Runs on the isolated session (HERDR_SOCKET_PATH set by caller).
import { herdr } from '../../lib/herdr.mjs'
import { pwshLine } from '../../lib/schema.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const ws = await herdr.workspaceCreate({ label: 'cmdtest', cwd: 'D:\\Tool\\HerdrScheduler\\test\\p1' })
const pane = ws.root_pane.pane_id
await herdr.paneWaitOutput(pane, { regex: 'PS .*>\\s*$', timeout: 30000 })
await herdr.paneRun(pane, pwshLine(['claude']))
const screen = async () => herdr.paneRead(pane, { source: 'recent', lines: 60 })
const waitIdle = async (label, ms = 240000) => {
  const end = Date.now() + ms
  await sleep(8000)
  while (Date.now() < end) {
    const p = await herdr.paneGet(pane)
    if (['idle', 'done'].includes(p?.agent_status)) return
    await sleep(3000)
  }
  console.log(`timeout waiting: ${label}`)
}
await sleep(40000)
await waitIdle('startup')
await herdr.agentPrompt(pane, '/commander')
await waitIdle('commander')
console.log('--- after /commander\n' + (await screen()).split('\n').filter(l => l.trim()).slice(-12).join('\n'))
await herdr.agentPrompt(pane, '用排程工具做三件事：1) 新增一個排程 id 叫 cmd-check，每年 1 月 1 日 03:00 跑，路徑 D:\\Tool\\HerdrScheduler\\test\\p1，任務是「只回一行 CMD-OK」；2) 列出所有排程確認它在；3) 把 cmd-check 刪掉。做完用一句話回報。')
await waitIdle('task')
await sleep(5000)
console.log('--- after task\n' + (await screen()).split('\n').filter(l => l.trim()).slice(-30).join('\n'))
console.log(`PANE ${pane}`)
