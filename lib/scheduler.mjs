// Keeping exactly one scheduler pane alive (設計文件 §10): used by [[startup]], the watchdog
// events, the "open" action and doctor.
import { join } from 'node:path'
import { TOOL_ROOT, files } from './paths.mjs'
import { withLock, loadState, saveState, readJson } from './store.mjs'
import { herdr } from './herdr.mjs'
import { tickLog } from './deliver.mjs'

export const HEARTBEAT_STALE_MS = 2 * 60 * 1000
export const SCHEDULER_TAB = '排程器'

// herdr's plugin registry is global: every herdr server (named sessions too) loads this plugin.
// Only the server recorded at install time (install.json server_socket) may run the scheduler;
// anywhere else startup, watchdog, actions and the pane do nothing.
const norm = p => String(p ?? '').replace(/^\\\\\?\\/, '').toLowerCase()
export function ownerSocket() {
  try {
    return readJson(join(files().home, 'install.json'), null)?.server_socket ?? null
  } catch {
    return null
  }
}
export function isOwnerServer(socket = process.env.HERDR_SOCKET_PATH) {
  const owner = ownerSocket()
  return !owner || !socket || norm(owner) === norm(socket)
}

export function heartbeat() {
  try {
    return readJson(files().heartbeat, null)
  } catch {
    return null
  }
}

export const heartbeatFresh = (hb, now = Date.now()) => !!hb?.at && now - Date.parse(hb.at) < HEARTBEAT_STALE_MS

// Is the recorded scheduler pane alive (same pane id and terminal id, and still a plugin pane process)?
export async function schedulerAlive(state) {
  const sp = state.scheduler_pane
  if (!sp?.pane_id) return false
  const pane = await herdr.paneGet(sp.pane_id)
  return !!pane && pane.terminal_id === sp.terminal_id
}

async function ensureWorkspace(state) {
  if (state.workspace_id && (await herdr.workspaceGet(state.workspace_id))) return { id: state.workspace_id, created: null }
  const r = await herdr.workspaceCreate({ label: '排程', cwd: TOOL_ROOT })
  state.workspace_id = r.workspace.workspace_id
  return { id: state.workspace_id, created: r.root_pane?.pane_id ?? null }
}

function paneFrom(result) {
  return result?.pane ?? result?.root_pane ?? (result?.pane_id ? result : null)
}

// Open the scheduler pane unless a live one exists. force: replace even a live one.
export async function ensureScheduler({ pluginId, reason = 'check', force = false } = {}) {
  if (!isOwnerServer()) return { opened: false, skipped: `not the owner herdr server (owner: ${ownerSocket()})` }
  const { value } = await withLock(async () => {
    const state = loadState()
    const hb = heartbeat()
    const alive = await schedulerAlive(state)
    if (alive && !force && heartbeatFresh(hb)) return { opened: false, pane_id: state.scheduler_pane.pane_id }
    // A restored or stuck scheduler pane: close it before opening the new one (P0 #6).
    // Only if it is still in our workspace, so a reused pane id can never close someone else's pane.
    if (state.scheduler_pane?.pane_id) {
      const old = await herdr.paneGet(state.scheduler_pane.pane_id).catch(() => null)
      if (old && old.workspace_id === state.workspace_id) await herdr.paneClose(old.pane_id).catch(() => null)
    }
    const ws = await ensureWorkspace(state)
    const before = new Set((await herdr.paneList()).map(p => p.pane_id))
    const r = await herdr.pluginPaneOpen({ plugin: pluginId, entrypoint: 'scheduler', workspace: ws.id })
    let pane = paneFrom(r)
    if (!pane?.pane_id) pane = (await herdr.paneList()).find(p => p.workspace_id === ws.id && !before.has(p.pane_id))
    if (!pane?.pane_id) throw new Error(`plugin pane open returned no pane: ${JSON.stringify(r).slice(0, 300)}`)
    const full = (await herdr.paneGet(pane.pane_id)) ?? pane
    await herdr.tabRename(full.tab_id, SCHEDULER_TAB).catch(() => null)
    // A brand-new workspace comes with an empty shell tab; drop it now that the scheduler tab exists.
    if (ws.created) await herdr.paneClose(ws.created).catch(() => null)
    state.scheduler_pane = { pane_id: full.pane_id, terminal_id: full.terminal_id, tab_id: full.tab_id, opened_at: new Date().toISOString() }
    saveState(state)
    tickLog(`scheduler pane opened (${reason}) ${full.pane_id}`)
    return { opened: true, pane_id: full.pane_id }
  }, { waitMs: 20000 })
  return value
}
