// The scheduler pane: once a minute write the heartbeat, run `hsched tick` in a child
// process (a crash there never takes this pane down), and redraw the overview.
import { setup } from './common.mjs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

setup()
const { files, TOOL_ROOT } = await import('../lib/paths.mjs')
const { writeJson, loadState } = await import('../lib/store.mjs')
const ops = await import('../lib/ops.mjs')

const CLI = join(TOOL_ROOT, 'bin', 'hsched.mjs')
let lastTick = null
let lastTickStart = 0
let ticking = false
let selected = 0
let ids = []
let message = null // { text, at }

function beat() {
  try {
    writeJson(files().heartbeat, { at: new Date().toISOString(), pane_id: process.env.HERDR_PANE_ID ?? null, pid: process.pid })
  } catch {}
}

function runTick() {
  if (ticking) return
  ticking = true
  const started = Date.now()
  lastTickStart = started
  execFile(process.execPath, [CLI, 'tick', '--json'], { encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true, env: process.env }, (error, stdout, stderr) => {
    ticking = false
    let out = null
    try { out = JSON.parse(stdout) } catch {}
    lastTick = { at: new Date(started), ms: Date.now() - started, ok: !error && out?.ok !== false, detail: out ?? (stderr || error?.message || '').trim().slice(0, 300) }
    draw()
  })
}

const pad = (s, n) => {
  s = String(s)
  let w = 0
  for (const ch of s) w += /[ᄀ-￿]/.test(ch) ? 2 : 1
  return s + ' '.repeat(Math.max(0, n - w))
}
const hm = iso => (iso ? new Date(iso).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-')
const STATE = { queued: '排隊中', starting: '啟動 Claude 中', ready: '等待送出', clearing: '清除對話中', sent: '執行中' }

async function draw() {
  const lines = []
  lines.push(`HerdrScheduler 排程器　${new Date().toLocaleString('zh-TW', { hour12: false })}`)
  lines.push(`每分鐘檢查一次。資料：${files().home}`)
  lines.push('')
  try {
    const { schedules } = await ops.listSchedules()
    const state = loadState()
    if (!schedules.length) lines.push('（還沒有排程。請 Claude 幫你加，或用 hsched add）')
    for (const s of schedules) {
      const st = state.schedules[s.id] ?? {}
      const status = s.run ? STATE[s.run.state] ?? s.run.state : (s.enabled ? '待命' : '已暫停')
      const cursor = schedules.indexOf(s) === selected ? '▶' : ' '
      lines.push(`${cursor}${s.enabled ? '●' : '○'} ${pad(s.id, 24)} ${pad(s.when, 16)} 下次 ${pad(hm(s.next_fire), 12)} ${status}${s.pending ? '（後面還有一筆）' : ''}`)
      if (st.last_error) lines.push(`    ⚠ ${st.last_error.message.slice(0, 120)}`)
    }
    const { runs } = await ops.listRuns({ limit: 8 })
    ids = schedules.map(s => s.id)
    if (selected >= ids.length) selected = Math.max(0, ids.length - 1)
    lines.push('')
    lines.push('最近的執行：')
    if (!runs.length) lines.push('  （還沒有）')
    for (const r of runs) lines.push(`  ${hm(r.ended_at)}  ${pad(r.schedule_id, 22)} ${pad(r.status, 10)} ${r.note ?? ''}`.slice(0, 160))
  } catch (error) {
    lines.push(`讀取失敗：${error?.message ?? error}`)
  }
  lines.push('')
  if (lastTick) lines.push(`上次檢查：${lastTick.at.toLocaleTimeString('zh-TW', { hour12: false })}（${lastTick.ms} ms）${lastTick.ok ? '' : ` 失敗：${JSON.stringify(lastTick.detail).slice(0, 200)}`}`)
  if (message && Date.now() - message.at < 60000) lines.push(message.text)
  lines.push('↑↓ 選排程　r 立刻執行選到的排程　t 立刻檢查一次')
  lines.push('關掉這個 pane 的話，排程會停到它被重新打開為止（看門狗會自動重開）。')
  process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n') + '\n')
}

beat()
draw()
setInterval(beat, 30 * 1000)
setInterval(draw, 15 * 1000)

// While a run is starting up (Claude launching, waiting to send, /clear), tick every 10 s
// instead of once a minute, so a run-now gets its task sent soon after Claude is ready.
const FAST = new Set(['starting', 'ready', 'clearing'])
setInterval(() => {
  if (ticking || Date.now() - lastTickStart < 10000) return
  try {
    const state = loadState()
    if (Object.values(state.schedules ?? {}).some(st => FAST.has(st.run?.state) || st.force_at)) runTick()
  } catch {}
}, 5000)

async function runSelected() {
  const id = ids[selected]
  if (!id) return
  try {
    await ops.runNow({ id })
    message = { text: `▶ ${id} 已開始，Claude 啟動約需一分鐘後送出任務。`, at: Date.now() }
    runTick()
  } catch (error) {
    message = { text: `✗ ${id} 無法執行：${error?.message ?? error}`, at: Date.now() }
  }
  draw()
}
// Align ticks to a few seconds past each minute.
const msToNext = 60000 - (Date.now() % 60000) + 2000
setTimeout(() => {
  beat()
  runTick()
  setInterval(() => { beat(); runTick() }, 60 * 1000)
}, msToNext)
runTick()

try {
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.on('data', d => {
    const k = d.toString()
    if (k === 't' || k === 'T') runTick()
    if (k === 'r' || k === 'R') runSelected()
    if (k === '\x1b[A' || k === 'k') { selected = Math.max(0, selected - 1); draw() }
    if (k === '\x1b[B' || k === 'j') { selected = Math.min(Math.max(0, ids.length - 1), selected + 1); draw() }
    if (k === '\u0003') process.exit(0)
  })
} catch {}
