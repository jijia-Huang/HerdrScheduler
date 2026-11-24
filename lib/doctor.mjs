// `hsched doctor` / MCP scheduler_status: is everything in place and running?
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { files, TOOL_ROOT } from './paths.mjs'
import { loadState, loadSchedules, readJson } from './store.mjs'
import { herdr } from './herdr.mjs'
import { heartbeat, heartbeatFresh, schedulerAlive, ownerSocket, isOwnerServer } from './scheduler.mjs'

export async function doctor() {
  const f = files()
  const checks = []
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(ok ? {} : fix ? { fix } : {}) })

  add('data folder', existsSync(f.home), f.home, 'Run `hsched install` or add a schedule; the folder is created on first write.')
  let schedules = []
  try {
    schedules = loadSchedules().schedules
    add('schedules', true, `${schedules.length} schedule(s), ${schedules.filter(s => s.enabled !== false).length} enabled`)
  } catch (error) {
    add('schedules', false, error.message, 'Fix schedules.json by hand.')
  }

  const installInfo = (() => {
    try { return readJson(join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'herdr-scheduler', 'install.json'), null) } catch { return null }
  })()
  add('install.json', !!installInfo && existsSync(installInfo.tool_root ?? ''), installInfo ? `tool ${installInfo.tool_root}` : 'missing', 'Run `hsched install` in D:\\Tool\\HerdrScheduler.')
  if (installInfo?.node) add('node path', existsSync(installInfo.node), installInfo.node, 'Node moved (nvm switch?). Run `hsched install --link` again.')
  {
    const owner = ownerSocket()
    const here = process.env.HERDR_SOCKET_PATH
    add('owner herdr server', true, owner ? `${owner}${here ? (isOwnerServer(here) ? ' (this server)' : ` — this shell is on another server: ${here}`) : ''}` : 'any server (not recorded)')
  }

  let herdrOk = false
  try {
    await herdr.call(['workspace', 'list'], { timeout: 10000 })
    herdrOk = true
    add('herdr reachable', true, process.env.HERDR_SOCKET_PATH ?? 'default socket')
  } catch (error) {
    add('herdr reachable', false, error.message, 'Start herdr, or run this inside a herdr pane.')
  }
  if (herdrOk) {
    try {
      const list = await herdr.call(['plugin', 'list'])
      const text = typeof list === 'string' ? list : JSON.stringify(list)
      add('herdr plugin linked', /herdr-scheduler/.test(text), text.split('\n').filter(l => /herdr-scheduler/.test(l)).join(' | ') || 'not linked', 'Run `hsched install --link`, then the "HerdrScheduler: 打開排程器" action (or restart the herdr server).')
    } catch (error) {
      add('herdr plugin linked', false, error.message)
    }
  }

  const state = loadState()
  const hb = heartbeat()
  add('scheduler heartbeat', heartbeatFresh(hb), hb?.at ? `last ${hb.at} (pane ${hb.pane_id ?? '?'})` : 'never', 'Open the scheduler: herdr action "HerdrScheduler: 打開排程器", or restart the herdr server.')
  if (herdrOk) add('scheduler pane', await schedulerAlive(state).catch(() => false), state.scheduler_pane?.pane_id ?? 'none', 'Run the "HerdrScheduler: 打開排程器" action.')
  add('last tick', !!state.last_tick_at && Date.now() - Date.parse(state.last_tick_at) < 3 * 60 * 1000, state.last_tick_at ?? 'never')

  const installed = (() => {
    try {
      const data = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
      return Object.keys(data.plugins ?? {}).find(k => k.startsWith('herdr-scheduler@')) ?? null
    } catch { return null }
  })()
  add('Claude Code plugin', !!installed, installed ?? 'not installed', `claude plugin marketplace add "${join(TOOL_ROOT, 'claude-plugin')}" && claude plugin install herdr-scheduler@herdr-scheduler`)
  const reports = existsSync(f.reports) ? readdirSync(f.reports).filter(n => n.endsWith('.json') && !n.endsWith('.turn.json')) : []
  add('report hook seen', reports.length > 0 || schedules.length === 0, reports.length ? `${reports.length} schedule(s) reported` : 'no report yet', 'If runs fail with "沒有回報就緒", the Claude Code plugin is not loaded in the work pane (check the SkillPool profile plugins.off).')

  for (const s of schedules) {
    const err = state.schedules?.[s.id]?.last_error
    if (err) add(`schedule ${s.id}`, false, `${err.at}: ${err.message}`)
  }
  return { healthy: checks.every(c => c.ok), checks }
}
