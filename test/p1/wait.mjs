// usage: node wait.mjs <n-runs-total> <timeoutSec> — wait until runs.jsonl has n lines, then print runs and the tick log tail
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const home = join(dirname(fileURLToPath(import.meta.url)), 'home')
const [n, t] = process.argv.slice(2).map(Number)
const runs = join(home, 'runs.jsonl')
const end = Date.now() + t * 1000
const count = () => (existsSync(runs) ? readFileSync(runs, 'utf8').split('\n').filter(Boolean).length : 0)
while (Date.now() < end && count() < n) await new Promise(r => setTimeout(r, 5000))
console.log(existsSync(runs) ? readFileSync(runs, 'utf8') : 'no runs')
const log = join(home, 'logs', 'tick.log')
if (existsSync(log)) console.log(readFileSync(log, 'utf8').split('\n').slice(-25).join('\n'))
