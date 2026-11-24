// One tick: take the lock (or quit if another tick holds it), move every schedule one
// step forward, save. Not a daemon: the scheduler pane runs it once a minute.
import { randomUUID } from 'node:crypto'
import { home } from './paths.mjs'
import { withLock, loadSchedules, loadState, saveState } from './store.mjs'
import { validate } from './schema.mjs'
import { step } from './machine.mjs'
import { isOwnerServer } from './scheduler.mjs'
import { herdr } from './herdr.mjs'
import * as reports from './reports.mjs'
import { finish, writeResult, notify, tickLog } from './deliver.mjs'

export function defaultIo() {
  return {
    herdr,
    home: home(),
    sessionStart: reports.sessionStart,
    lastTurn: reports.lastTurn,
    finish,
    writeResult,
    notify,
    log: tickLog,
    newSession: () => randomUUID(),
  }
}

export async function tick({ io = defaultIo(), now = Date.now(), anyServer = false } = {}) {
  if (!anyServer && !isOwnerServer()) return { ticked: false, reason: 'not the owner herdr server; see install.json server_socket' }
  const outcome = await withLock(async () => {
    const data = loadSchedules()
    const state = loadState()
    const ctx = { io, now, state, save: () => saveState(state) }
    const summary = {}
    for (const raw of data.schedules) {
      let s
      try {
        s = validate(raw, { checkCwd: false })
      } catch (error) {
        summary[raw?.id ?? '?'] = `invalid: ${error.message}`
        continue
      }
      const st = (state.schedules[s.id] ??= {})
      try {
        await step(s, st, ctx)
        delete st.last_error
      } catch (error) {
        st.last_error = { at: new Date(now).toISOString(), message: String(error?.message ?? error) }
        io.log(`${s.id}: error ${st.last_error.message}`)
      }
      summary[s.id] = st.run ? st.run.state : 'idle'
      saveState(state)
    }
    state.last_tick_at = new Date(now).toISOString()
    saveState(state)
    return summary
  }, { waitMs: 0 })
  return outcome.locked ? { ticked: true, schedules: outcome.value } : { ticked: false, reason: 'another tick is running' }
}
