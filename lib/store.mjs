// File storage: JSON read/write (atomic: temp file then rename), the single lock
// that serializes every writer of schedules.json / state.json, and the run log.
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync,
  writeSync, unlinkSync, statSync, appendFileSync, rmSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { files } from './paths.mjs'
import { fail } from './errors.mjs'

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const sleep = ms => new Promise(r => setTimeout(r, ms))

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  if (text.trim() === '') return fallback
  try {
    return JSON.parse(text)
  } catch (error) {
    fail('bad_json', `${path} is not valid JSON: ${error.message}`, 'Fix the file by hand or restore it; HerdrScheduler will not overwrite a file it cannot read.')
  }
}

export function writeJson(path, value) {
  ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  // Windows can refuse the rename for a moment while another process has the target open.
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tmp, path)
      return
    } catch (error) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
        try { unlinkSync(tmp) } catch {}
        throw error
      }
      sleepSync(50)
    }
  }
}

export function loadSchedules(f = files()) {
  const data = readJson(f.schedules, { schedules: [] })
  if (!Array.isArray(data.schedules)) fail('bad_json', `${f.schedules} has no "schedules" array`)
  return data
}

export function saveSchedules(data, f = files()) {
  writeJson(f.schedules, data)
}

export function loadState(f = files()) {
  const state = readJson(f.state, {})
  state.schedules ??= {}
  return state
}

export function saveState(state, f = files()) {
  writeJson(f.state, state)
}

// ---- lock ----
const STALE_MS = 5 * 60 * 1000

function tryLock(path) {
  ensureDir(dirname(path))
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    closeSync(fd)
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_MS) {
        rmSync(path, { force: true })
        return tryLock(path)
      }
    } catch {}
    return false
  }
}

// Run fn while holding the lock. waitMs = 0 means "give up at once if someone else has it".
export async function withLock(fn, { waitMs = 30000, f = files() } = {}) {
  const deadline = Date.now() + waitMs
  while (!tryLock(f.lock)) {
    if (Date.now() >= deadline) {
      if (waitMs === 0) return { locked: false }
      fail('busy', 'another HerdrScheduler process is holding the lock', 'Try again in a few seconds.')
    }
    await sleep(200)
  }
  try {
    return { locked: true, value: await fn() }
  } finally {
    try { unlinkSync(f.lock) } catch {}
  }
}

// ---- run log ----
export function appendRun(row, f = files()) {
  ensureDir(dirname(f.runs))
  appendFileSync(f.runs, JSON.stringify(row) + '\n', 'utf8')
}

export function readRuns(f = files()) {
  if (!existsSync(f.runs)) return []
  return readFileSync(f.runs, 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}
