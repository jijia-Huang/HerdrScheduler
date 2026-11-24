#!/usr/bin/env node
// hsched: HerdrScheduler command line. Same operations as the MCP tools, for people
// (and for the scheduler pane, which runs `hsched tick` every minute).
import { readFileSync } from 'node:fs'
import * as ops from '../lib/ops.mjs'
import { errorJson } from '../lib/errors.mjs'

const USAGE = `hsched <command> [options]

  list                          列出排程
  show <id>                     看一個排程（定義、綁定、最近的執行）
  add <id> --when <cron> --cwd <dir> (--task <text> | --task-file <file>)
           [--command "skillpool inanna-slot"] [--arg <x>]... [--reuse continue|clear|fresh]
           [--on-busy queue|skip] [--on-missed run_once|skip] [--disabled] [--dry-run]
  add --from-json <file>        用 JSON 檔新增（欄位同 schedules.json）
  edit <id> [同 add 的選項]      修改
  remove <id>                   刪除
  pause <id> / resume <id>      暫停、恢復
  run-now <id>                  立刻觸發一次（不影響固定時間）
  log [<id>] [--limit N]        執行紀錄
  result <run_id> | --last <id> 某次執行的結果
  tick                          推進一次（排程器 pane 每分鐘呼叫）
  doctor                        檢查安裝狀態
  install                       產生 herdr 插件設定、寫入啟動器（見 README）

  共通選項：--json 輸出 JSON`

function parse(argv) {
  const pos = []
  const opt = { arg: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) { pos.push(a); continue }
    const key = a.slice(2)
    if (['json', 'dry-run', 'disabled', 'enabled', 'help', 'last', 'self', 'link', 'shim', 'force'].includes(key)) { opt[key] = true; continue }
    const val = argv[++i]
    if (val === undefined) throw Object.assign(new Error(`--${key} needs a value`), { code: 'usage' })
    if (key === 'arg') opt.arg.push(val)
    else opt[key] = val
  }
  return { pos, opt }
}

function readTask(opt) {
  if (opt['task-file'] !== undefined) {
    if (opt['task-file'] === '-') return readFileSync(0, 'utf8')
    return readFileSync(opt['task-file'], 'utf8').replace(/^﻿/, '')
  }
  return opt.task
}

function fields(opt) {
  const f = {}
  if (opt.when !== undefined) f.when = opt.when
  if (opt.cwd !== undefined) f.cwd = opt.cwd
  if (opt.command !== undefined) f.command = opt.command
  if (opt.arg.length) f.args = opt.arg
  const task = readTask(opt)
  if (task !== undefined) f.task = task
  if (opt.reuse !== undefined) f.reuse = opt.reuse
  if (opt['on-busy'] !== undefined) f.on_busy = opt['on-busy']
  if (opt['on-missed'] !== undefined) f.on_missed = opt['on-missed']
  if (opt.disabled) f.enabled = false
  if (opt.enabled) f.enabled = true
  if (opt.note !== undefined) f.note = opt.note
  return f
}

function human(cmd, r) {
  if (cmd === 'list') {
    if (!r.schedules.length) return '（沒有排程）'
    return r.schedules.map(s => [
      `${s.enabled ? '●' : '○'} ${s.id}  ${s.when}  下次 ${s.next_fire ? new Date(s.next_fire).toLocaleString() : '-'}`,
      `   ${s.cwd} | ${s.command}`,
      `   ${s.task_preview.replace(/\n/g, ' ⏎ ')}`,
      s.run ? `   進行中：${s.run.state}（${s.run.run_id}）` : null,
      s.binding ? `   綁定：${s.binding.pane_id ?? '-'} session ${s.binding.session_id ?? '-'}` : null,
    ].filter(Boolean).join('\n')).join('\n')
  }
  if (cmd === 'log') {
    if (!r.runs.length) return '（沒有執行紀錄）'
    return r.runs.map(x => `${x.ended_at ?? x.fired_at}  ${x.schedule_id}  ${x.status}  ${x.run_id}${x.note ? `  ${x.note}` : ''}`).join('\n')
  }
  if (cmd === 'result') return r.result
  return JSON.stringify(r, null, 2)
}

async function main() {
  const { pos, opt } = parse(process.argv.slice(2))
  const [cmd, ...rest] = pos
  if (!cmd || opt.help) { console.log(USAGE); return 0 }
  let result
  switch (cmd) {
    case 'list': result = await ops.listSchedules(); break
    case 'show': result = await ops.getSchedule({ id: rest[0] }); break
    case 'add': {
      const base = opt['from-json'] ? JSON.parse(readFileSync(opt['from-json'], 'utf8').replace(/^﻿/, '')) : {}
      result = await ops.addSchedule({ ...base, ...(rest[0] ? { id: rest[0] } : {}), ...fields(opt), ...(opt['dry-run'] ? { dry_run: true } : {}) })
      break
    }
    case 'edit': result = await ops.updateSchedule({ id: rest[0], ...fields(opt), ...(opt['dry-run'] ? { dry_run: true } : {}) }); break
    case 'remove': result = await ops.removeSchedule({ id: rest[0] }); break
    case 'pause': result = await ops.updateSchedule({ id: rest[0], enabled: false }); break
    case 'resume': result = await ops.updateSchedule({ id: rest[0], enabled: true }); break
    case 'run-now': result = await ops.runNow({ id: rest[0], kick: true }); break
    case 'log': result = await ops.listRuns({ id: rest[0], limit: opt.limit, self: opt.self }); break
    case 'result': result = await ops.getResult(opt.last ? { id: rest[0] } : { run_id: rest[0] }); break
    case 'tick': {
      const { tick } = await import('../lib/tick.mjs')
      result = await tick()
      break
    }
    case 'doctor': {
      const { doctor } = await import('../lib/doctor.mjs')
      result = await doctor()
      break
    }
    case 'install': {
      const { install } = await import('../lib/install.mjs')
      result = await install(opt)
      break
    }
    default:
      throw Object.assign(new Error(`unknown command "${cmd}"`), { code: 'usage' })
  }
  if (opt.json) console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  else console.log(human(cmd, result))
  return 0
}

main().then(code => { process.exitCode = code }, error => {
  const json = process.argv.includes('--json')
  const e = error.code === 'usage' ? { code: 'usage', message: error.message, hint: 'Run hsched --help.' } : errorJson(error)
  if (json) console.log(JSON.stringify({ ok: false, error: e }, null, 2))
  else console.error(`錯誤 [${e.code}] ${e.message}${e.hint ? `\n提示：${e.hint}` : ''}`)
  process.exitCode = 1
})
