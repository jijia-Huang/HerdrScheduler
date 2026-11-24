// M0 scenarios. usage: node scenario.mjs <bg|esc|trust|perm> <workspace>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { herdr } from '../../lib/herdr.mjs'
import { here, logger, report, startClaude, waitFor, sleep } from './m0lib.mjs'

const [name, workspace] = process.argv.slice(2)
const id = `m0-${name}`
const log = logger(name)

async function watch(pane, seconds, { screenEvery = 0 } = {}) {
  let last = ''
  let lastTurn = ''
  let lastStart = ''
  for (let i = 0; i < seconds; i += 1) {
    const p = await herdr.paneGet(pane)
    const status = p ? `${p.agent ?? '-'}:${p.agent_status}` : 'gone'
    if (status !== last) { log({ status }); last = status }
    const s = report(id, 'start')
    if (s && JSON.stringify(s) !== lastStart) { lastStart = JSON.stringify(s); log({ sessionStart: s }) }
    const t = report(id, 'turn')
    if (t && JSON.stringify(t) !== lastTurn) { lastTurn = JSON.stringify(t); log({ stop: { at: t.at, background_tasks: t.background_tasks, msg: t.last_assistant_message?.slice(0, 160) } }) }
    if (screenEvery && i % screenEvery === 0) log({ screen: (await herdr.paneRead(pane, { source: 'visible', lines: 40 })) })
    await sleep(1000)
  }
}

const ready = () => waitFor(() => report(id, 'start'), { timeout: 180000 })

if (name === 'bg') {
  const { pane } = await startClaude({ workspace, id, cwd: here, extra: ['--permission-mode', 'bypassPermissions'] })
  log({ pane, started: true })
  log({ ready: await ready() })
  await sleep(60000)
  await herdr.agentPrompt(pane, 'Start this Bash command in the background (run_in_background: true): `sleep 50 && echo BG-DONE`. Do not wait for it; end your turn right away with one line "STARTED". When it finishes, reply with one line "FINISHED".')
  log({ sent: true })
  await watch(pane, 150)
} else if (name === 'agent') {
  const { pane } = await startClaude({ workspace, id, cwd: here, extra: ['--permission-mode', 'bypassPermissions'] })
  log({ pane, started: true })
  log({ ready: await ready() })
  await sleep(60000)
  await herdr.agentPrompt(pane, 'Launch one subagent with the Agent tool in the background (run_in_background: true) whose task is: "Run the Bash command `sleep 40` then reply SUB-DONE". Do not wait for it; end your turn right away with one line "LAUNCHED". When it reports back, reply with one line "ALL-DONE".')
  log({ sent: true })
  await watch(pane, 180)
} else if (name === 'esc') {
  const { pane } = await startClaude({ workspace, id, cwd: here, extra: ['--permission-mode', 'bypassPermissions'] })
  log({ pane, started: true })
  log({ ready: await ready() })
  await sleep(60000)
  await herdr.agentPrompt(pane, 'Run the Bash command `ping -n 80 127.0.0.1` in the foreground (not in the background) and then reply "PINGED".')
  log({ sent: true })
  await watch(pane, 15)
  await herdr.paneSendKeys(pane, 'esc')
  log({ esc: true })
  await watch(pane, 30, { screenEvery: 10 })
} else if (name === 'trust') {
  const dir = `D:\\hsched-m0-trust-${Date.now()}`
  mkdirSync(dir)
  writeFileSync(join(dir, 'README.txt'), 'm0 trust test\n')
  const { pane } = await startClaude({ workspace, id, cwd: dir })
  log({ pane, dir })
  await watch(pane, 75, { screenEvery: 15 })
} else if (name === 'perm') {
  const { pane } = await startClaude({ workspace, id, cwd: here, extra: ['--permission-mode', 'default'] })
  log({ pane, started: true })
  log({ ready: await ready() })
  await sleep(60000)
  await herdr.agentPrompt(pane, 'Use the Write tool to create the file m0-perm-test.txt containing the single word hi. Then reply "WROTE".')
  log({ sent: true })
  await watch(pane, 40, { screenEvery: 10 })
}
log({ done: true })
