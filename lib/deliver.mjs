// End of a run: result file, run log line, herdr notification, and the tick log.
import { mkdirSync, writeFileSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { files } from './paths.mjs'
import { appendRun } from './store.mjs'
import { herdr } from './herdr.mjs'

export function tickLog(message, extra) {
  const f = files()
  try {
    mkdirSync(f.logs, { recursive: true })
    const path = join(f.logs, 'tick.log')
    try {
      if (statSync(path).size > 1024 * 1024) renameSync(path, path + '.1')
    } catch {}
    appendFileSync(path, `${new Date().toISOString()} ${message}${extra ? ' ' + JSON.stringify(extra) : ''}\n`, 'utf8')
  } catch {}
}

export function writeResult(schedule, run, text, meta = {}) {
  const dir = join(files().results, schedule.id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${run.id}.md`)
  const header = [
    `<!-- schedule: ${schedule.id} | run: ${run.id} | fired: ${run.fired_at} | sent: ${run.sent_at ?? '-'} | ended: ${meta.ended_at ?? '-'} | session: ${meta.session_id ?? '-'} -->`,
    '',
  ].join('\n')
  writeFileSync(path, header + (text ?? '') + '\n', 'utf8')
  return path
}

const firstLine = text => (String(text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '').slice(0, 140)

const TITLES = {
  completed: id => `排程 ${id} 完成`,
  blocked: id => `排程 ${id} 卡住了`,
  failed: id => `排程 ${id} 失敗`,
  lost: id => `排程 ${id} 的 pane 不見了`,
  abandoned: id => `排程 ${id} 上一次沒有結束`,
  skipped: id => `排程 ${id} 這次跳過`,
  missed: id => `排程 ${id} 錯過了`,
}

// Windows balloon notification via PowerShell. Title/body go through env vars, never the command line.
const BALLOON = [
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  '$n = New-Object System.Windows.Forms.NotifyIcon',
  '$n.Icon = [System.Drawing.SystemIcons]::Information',
  '$n.Visible = $true',
  '$n.ShowBalloonTip(10000, $env:HSCHED_TITLE, $(if ($env:HSCHED_BODY) { $env:HSCHED_BODY } else { " " }), [System.Windows.Forms.ToolTipIcon]::Info)',
  'Start-Sleep -Seconds 10',
  '$n.Dispose()',
].join('; ')

export function windowsNotify(title, body, { wait = false } = {}) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', BALLOON], {
    env: { ...process.env, HSCHED_TITLE: title, HSCHED_BODY: body ?? '' },
    detached: !wait,
    stdio: 'ignore',
    windowsHide: true,
  })
  if (!wait) {
    child.unref()
    return Promise.resolve(null)
  }
  return new Promise(resolve => child.on('exit', code => resolve(code)))
}

// herdr toasts are off by default ([ui.toast] delivery = "off" -> shown:false, reason:"disabled").
// Then fall back to a Windows notification, so results reach the user without changing herdr settings.
export async function notify(title, body, sound) {
  const r = await herdr.notify(title, body, sound)
  if (r?.shown === false || r === null) {
    tickLog(`herdr notification not shown (${r?.reason ?? 'error'}); using Windows notification`)
    await windowsNotify(title, body)
  }
}

// Write the run log line and notify. status: completed | skipped | missed | blocked | failed | lost | abandoned
export async function finish(schedule, run, status, { note, result_path, session_id, pane_id, message, quiet } = {}) {
  const row = {
    run_id: run.id,
    schedule_id: schedule.id,
    status,
    fired_at: run.fired_at,
    sent_at: run.sent_at ?? null,
    ended_at: new Date().toISOString(),
    path: run.path ?? null,
    pane_id: pane_id ?? run.pane_id ?? null,
    session_id: session_id ?? null,
    result_path: result_path ?? null,
    note: note ?? null,
  }
  appendRun(row)
  tickLog(`run ${status}`, row)
  if (quiet) return row
  const body = status === 'completed' ? firstLine(message) : (note ?? '')
  await notify((TITLES[status] ?? (id => `排程 ${id}: ${status}`))(schedule.id), body, status === 'completed' ? 'done' : 'request')
  return row
}
