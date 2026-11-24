// HerdrScheduler report hook. Does nothing unless this Claude runs in a scheduled work
// pane (HERDR_SCHEDULER_ID set by `herdr tab create --env`). Writes:
//   SessionStart -> reports/<id>.json       (Claude is ready; current session id)
//   Stop         -> reports/<id>.turn.json  (a turn ended; last reply; background tasks)
// Self-contained on purpose: the installed plugin is a cached copy without the tool's lib.
import { mkdirSync, writeFileSync, renameSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const id = process.env.HERDR_SCHEDULER_ID
if (!id || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) process.exit(0)

const home = process.env.HERDR_SCHEDULER_HOME
  || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'herdr-scheduler')
const dir = join(home, 'reports')
const hook = process.argv[2]

let raw = ''
try {
  for await (const chunk of process.stdin) raw += chunk
} catch {}
let input = {}
try { input = JSON.parse(raw) } catch {}

const row = {
  hook,
  at: new Date().toISOString(),
  schedule_id: id,
  run_id: process.env.HERDR_SCHEDULER_RUN ?? null,
  pane_id: process.env.HERDR_PANE_ID ?? null,
  session_id: input.session_id ?? null,
  transcript_path: input.transcript_path ?? null,
}
if (hook === 'SessionStart') {
  row.source = input.source ?? null
} else if (hook === 'Stop') {
  row.last_assistant_message = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : null
  row.background_tasks = input.background_tasks ?? null
  row.stop_hook_active = input.stop_hook_active ?? null
}

try {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, hook === 'Stop' ? `${id}.turn.json` : `${id}.json`)
  const tmp = `${target}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(row, null, 2), 'utf8')
  renameSync(tmp, target)
  const brief = { ...row }
  if (brief.last_assistant_message) brief.last_assistant_message = brief.last_assistant_message.slice(0, 200)
  appendFileSync(join(dir, `${id}.log.jsonl`), JSON.stringify(brief) + '\n', 'utf8')
} catch {
  // Never block Claude because of a report problem.
}
process.exit(0)
