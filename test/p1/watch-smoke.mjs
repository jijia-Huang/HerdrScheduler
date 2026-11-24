// Sample the real install's state for the smoke schedule every 15 s; also record what
// `pane process-info` shows while Claude is mid-turn. usage: node watch-smoke.mjs <minutes>
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const home = join(process.env.LOCALAPPDATA, 'herdr-scheduler')
const out = join(dirname(fileURLToPath(import.meta.url)), 'smoke-watch.jsonl')
const end = Date.now() + Number(process.argv[2] ?? 11) * 60000
let last = ''
while (Date.now() < end) {
  const st = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).schedules['hsched-smoke'] ?? {}
  let procs = null
  let status = null
  if (st.binding?.pane_id) {
    try {
      const info = JSON.parse(execFileSync('herdr', ['pane', 'process-info', '--pane', st.binding.pane_id], { encoding: 'utf8' })).result.process_info
      procs = info.foreground_processes.map(p => p.name)
      status = JSON.parse(execFileSync('herdr', ['pane', 'get', st.binding.pane_id], { encoding: 'utf8' })).result.pane.agent_status
    } catch {}
  }
  const row = { run: st.run ? `${st.run.id}:${st.run.state}:${st.run.path ?? ''}${st.run.background ? `:bg${st.run.background}` : ''}` : null, pending: !!st.pending, procs, status }
  const key = JSON.stringify(row)
  if (key !== last) {
    appendFileSync(out, JSON.stringify({ at: new Date().toLocaleTimeString('zh-TW', { hour12: false }), ...row }) + '\n')
    last = key
  }
  await new Promise(r => setTimeout(r, 15000))
}
const runs = join(home, 'runs.jsonl')
console.log(readFileSync(out, 'utf8'))
console.log(existsSync(runs) ? readFileSync(runs, 'utf8') : 'no runs')
