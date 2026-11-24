// P0: append one JSON line per invocation (startup, event, action, pane) to out/events.jsonl
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'out', 'events.jsonl')
const pick = k => process.env[k] ?? null
const ej = pick('HERDR_PLUGIN_EVENT_JSON')
appendFileSync(out, JSON.stringify({
  at: new Date().toISOString(),
  kind: process.argv[2] ?? '?',
  event: pick('HERDR_PLUGIN_EVENT'),
  action: pick('HERDR_PLUGIN_ACTION_ID'),
  entry: pick('HERDR_PLUGIN_ENTRYPOINT_ID'),
  socket: pick('HERDR_SOCKET_PATH'),
  bin: pick('HERDR_BIN_PATH'),
  state_dir: pick('HERDR_PLUGIN_STATE_DIR'),
  pane: pick('HERDR_PANE_ID'),
  workspace: pick('HERDR_WORKSPACE_ID'),
  cwd: process.cwd(),
  event_json: ej ? ej.slice(0, 600) : null,
}) + '\n')
