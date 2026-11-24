// Only the herdr server recorded in install.json may run the scheduler (the plugin registry is global).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'hsched-owner-'))
process.env.HERDR_SCHEDULER_HOME = home
const { isOwnerServer } = await import('../../lib/scheduler.mjs')
const { tick } = await import('../../lib/tick.mjs')
const { ensureScheduler } = await import('../../lib/scheduler.mjs')

test('owner check', async () => {
  assert.equal(isOwnerServer('C:\\any\\herdr.sock'), true) // no install.json: allowed
  writeFileSync(join(home, 'install.json'), JSON.stringify({ server_socket: 'C:\\Users\\me\\AppData\\Roaming\\herdr\\herdr.sock' }))
  assert.equal(isOwnerServer('c:\\users\\me\\appdata\\roaming\\herdr\\herdr.sock'), true)
  assert.equal(isOwnerServer('\\\\?\\C:\\Users\\me\\AppData\\Roaming\\herdr\\herdr.sock'), true)
  assert.equal(isOwnerServer('C:\\Users\\me\\AppData\\Roaming\\herdr\\sessions\\work\\herdr.sock'), false)

  const saved = process.env.HERDR_SOCKET_PATH
  process.env.HERDR_SOCKET_PATH = 'C:\\Users\\me\\AppData\\Roaming\\herdr\\sessions\\work\\herdr.sock'
  try {
    assert.equal((await tick()).ticked, false)
    const r = await ensureScheduler({ pluginId: 'herdr-scheduler', reason: 'test' })
    assert.equal(r.opened, false)
    assert.match(r.skipped, /not the owner/)
  } finally {
    if (saved === undefined) delete process.env.HERDR_SOCKET_PATH
    else process.env.HERDR_SOCKET_PATH = saved
  }
})
