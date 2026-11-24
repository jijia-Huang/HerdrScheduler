// Reads what the report hook (claude-plugin/herdr-scheduler/hooks/report.mjs) wrote.
import { join } from 'node:path'
import { files } from './paths.mjs'
import { readJson } from './store.mjs'

const read = path => {
  try {
    return readJson(path, null)
  } catch {
    return null // half-written or broken: treat as not there yet
  }
}

export const sessionStart = id => read(join(files().reports, `${id}.json`))
export const lastTurn = id => read(join(files().reports, `${id}.turn.json`))
export const after = (report, iso) => !!report && !!iso && Date.parse(report.at) > Date.parse(iso)
