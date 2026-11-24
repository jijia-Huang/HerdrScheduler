// P0: long-lived plugin pane; writes a heartbeat every 5s and logs start
import { appendFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'out')
appendFileSync(join(outDir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: 'pane-start', pane: process.env.HERDR_PANE_ID ?? null, socket: process.env.HERDR_SOCKET_PATH ?? null, cwd: process.cwd() }) + '\n')
const beat = () => {
  writeFileSync(join(outDir, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, pane: process.env.HERDR_PANE_ID ?? null }))
  process.stdout.write(`\rP0 scheduler pane alive ${new Date().toLocaleTimeString()}   `)
}
beat()
setInterval(beat, 5000)
