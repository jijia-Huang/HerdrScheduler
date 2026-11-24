// P0 report hook: only acts in panes started with HERDR_SCHEDULER_ID; logs the hook input
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const id = process.env.HERDR_SCHEDULER_ID
if (!id) process.exit(0)
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'hooks.jsonl')
let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input = {}
try { input = JSON.parse(raw) } catch { input = { parse_error: raw.slice(0, 200) } }
const row = {
  at: new Date().toISOString(),
  hook: process.argv[2],
  schedule: id,
  pane: process.env.HERDR_PANE_ID ?? null,
  keys: Object.keys(input),
  session_id: input.session_id ?? null,
  source: input.source ?? null,
  last_assistant_message: typeof input.last_assistant_message === 'string' ? input.last_assistant_message.slice(0, 300) : null,
  transcript_path: input.transcript_path ?? null,
}
appendFileSync(out, JSON.stringify(row) + '\n')
