// Where HerdrScheduler keeps its data. HERDR_SCHEDULER_HOME overrides the default
// (tests use it; work tabs get it through `tab create --env` so the report hook
// writes to the same place the tick reads from).
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function home() {
  if (process.env.HERDR_SCHEDULER_HOME) return process.env.HERDR_SCHEDULER_HOME
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  return join(local, 'herdr-scheduler')
}

export function files(h = home()) {
  return {
    home: h,
    schedules: join(h, 'schedules.json'),
    state: join(h, 'state.json'),
    heartbeat: join(h, 'heartbeat.json'),
    lock: join(h, 'tick.lock'),
    runs: join(h, 'runs.jsonl'),
    reports: join(h, 'reports'),
    results: join(h, 'results'),
    logs: join(h, 'logs'),
  }
}
