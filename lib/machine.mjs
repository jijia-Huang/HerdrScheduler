// Per-schedule state machine (設計文件 §4.1, §6, §6.5). step() is called once per tick,
// moves the schedule forward as far as it can without waiting, and returns.
// All herdr / report / delivery access goes through ctx.io so tests can fake it.
import { existsSync } from 'node:fs'
import { parseCron, prevFire } from './cron.mjs'
import { bindingKey, sameBinding, launchArgv, pwshLine } from './schema.mjs'
import { isTrustPrompt, isDialog, isNoConversation, isShellPrompt, isInterrupted } from './screen.mjs'
import { after } from './reports.mjs'
import { newRunId } from './ops.mjs'

export const READY_LIMIT_MS = 3 * 60 * 1000 // wait for Claude to come up (fixed, not configurable)
export const SAFETY_MS = 55 * 1000 // after SessionStart, wait this long before sending (P0: always ≥55 s)
export const GRACE_MS = 5 * 60 * 1000 // later than this after the fire time counts as missed
export const SHELL_LIMIT_MS = 90 * 1000 // a new tab must show its shell prompt by then
export const ABANDON_AFTER_MS = 2 * 60 * 1000 // don't call a sent run abandoned right after sending

const iso = ms => new Date(ms).toISOString()
const local = isoText => (isoText ? new Date(isoText).toLocaleString() : '-')

function newRun(fire) {
  return { id: newRunId(), state: 'queued', fired_at: fire.at, late: !!fire.late, forced: !!fire.forced, attempts: 0, notified: {} }
}

export function fireCheck(s, st, now) {
  if (s.enabled === false) {
    delete st.force_at
    return null
  }
  if (st.force_at) {
    const at = st.force_at
    delete st.force_at
    return { at, forced: true }
  }
  if (!st.last_fire_at) {
    // No history (new or state lost): start counting now instead of firing a surprise catch-up.
    st.last_fire_at = iso(now)
    return null
  }
  const due = prevFire(parseCron(s.when), new Date(now))
  if (!due || due.getTime() <= Date.parse(st.last_fire_at)) return null
  st.last_fire_at = due.toISOString()
  return { at: due.toISOString(), late: now - due.getTime() > GRACE_MS }
}

const busyStatus = pane => ['working', 'blocked'].includes(pane?.agent_status)
const liveBusy = pane => busyStatus(pane) || pane?.agent_status === 'unknown'

async function notifyOnce(ctx, run, key, title, body) {
  run.notified ??= {}
  if (run.notified[key]) return
  run.notified[key] = iso(ctx.now)
  await ctx.io.notify(title, body, 'request')
}

// 設計文件 §6.4: find the bound pane.
export async function locate(st, io) {
  const b = st.binding
  if (!b?.pane_id) return { kind: 'gone' }
  let pane = await io.herdr.paneGet(b.pane_id)
  if (!pane || pane.terminal_id !== b.terminal_id) {
    const moved = (await io.herdr.paneList()).find(p => p.terminal_id === b.terminal_id)
    if (moved) {
      b.pane_id = moved.pane_id
      b.tab_id = moved.tab_id
      pane = moved
    } else if (pane) {
      return { kind: 'restored', pane }
    } else {
      return { kind: 'gone' }
    }
  }
  const info = await io.herdr.processInfo(pane.pane_id)
  const procs = info?.foreground_processes
  if (Array.isArray(procs) && procs.some(p => /claude/i.test(`${p.name ?? ''} ${p.argv0 ?? ''}`))) return { kind: 'live', pane }
  // The foreground list may show a tool Claude is running instead of claude.exe. Only call it
  // "just a shell" when the PowerShell prompt is really the last thing on screen.
  const text = await io.herdr.paneRead(pane.pane_id, { lines: 10 })
  if (isShellPrompt(text)) return { kind: 'shell', pane }
  return { kind: pane.agent === 'claude' || busyStatus(pane) ? 'live' : 'shell', pane }
}

async function openPane(s, st, ctx) {
  const { io, state } = ctx
  const env = { HERDR_SCHEDULER_ID: s.id, HERDR_SCHEDULER_HOME: io.home, HERDR_SCHEDULER_RUN: st.run.id }
  const ws = state.workspace_id ? await io.herdr.workspaceGet(state.workspace_id) : null
  if (ws) {
    const r = await io.herdr.tabCreate({ workspace: ws.workspace_id, cwd: s.cwd, label: s.id, env })
    return r.root_pane
  }
  const r = await io.herdr.workspaceCreate({ label: '排程', cwd: s.cwd, env })
  state.workspace_id = r.workspace.workspace_id
  await io.herdr.tabRename(r.tab.tab_id, s.id).catch(() => {})
  return r.root_pane
}

function beginLaunch(s, st, ctx, pane, kind) {
  const session = kind === 'resume' ? st.binding.session_id : ctx.io.newSession()
  st.binding = { pane_id: pane.pane_id, terminal_id: pane.terminal_id, tab_id: pane.tab_id, session_id: session, of: bindingKey(s) }
  st.run.state = 'starting'
  st.run.pane_id = pane.pane_id
  st.run.launch = { kind, session, launched: false, opened_at: iso(ctx.now) }
  ctx.io.log(`${s.id}: starting (${kind}) in ${pane.pane_id}`)
}

async function end(s, st, ctx, status, opts = {}) {
  await ctx.io.finish(s, st.run, status, { pane_id: st.binding?.pane_id, session_id: st.binding?.session_id, ...opts })
  st.run = null
}

async function send(s, st, ctx, pane) {
  const run = st.run
  const previous = { state: run.state }
  run.state = 'sent'
  run.sent_at = iso(ctx.now)
  // sent_at is the tick's start time. A Stop from the previous turn can land after that but
  // before this prompt goes in; remember the newest Stop on disk so it never counts as ours.
  run.prev_turn_at = ctx.io.lastTurn(s.id)?.at ?? null
  run.pane_id = pane.pane_id
  run.session_id = st.binding?.session_id ?? null
  // Record "sent" before acting, so a crash after the prompt can never send it twice.
  ctx.save()
  try {
    await ctx.io.herdr.agentPrompt(pane.pane_id, s.task)
    ctx.io.log(`${s.id}: sent ${run.id} to ${pane.pane_id}`)
  } catch (error) {
    Object.assign(run, previous, { sent_at: undefined })
    ctx.save()
    throw error
  }
}

async function queued(s, st, ctx) {
  const { io } = ctx
  const run = st.run
  run.attempts = (run.attempts ?? 0) + 1
  if (!existsSync(s.cwd)) return end(s, st, ctx, 'failed', { note: `啟動路徑不存在：${s.cwd}` })

  let loc = await locate(st, io)
  if (loc.kind === 'live') {
    const text = await io.herdr.paneRead(loc.pane.pane_id, { lines: 40 })
    const dialog = isDialog(text) || isTrustPrompt(text)
    if (dialog) await notifyOnce(ctx, run, 'dialog', `排程 ${s.id} 在等你回答`, '工單 pane 上有確認框或問題，處理完才會送出這次的任務')
    if (dialog || liveBusy(loc.pane)) {
      if (s.on_busy === 'skip') return end(s, st, ctx, 'skipped', { note: dialog ? '工單 pane 停在確認框（on_busy=skip）' : 'agent 正在忙（on_busy=skip）', quiet: true })
      return // queue: try again next tick
    }
    if (s.reuse === 'fresh') {
      await io.herdr.paneClose(loc.pane.pane_id)
      st.binding = null
      loc = { kind: 'gone' }
    } else {
      run.path ??= 'reuse_pane'
      if (s.reuse === 'clear') {
        run.state = 'clearing'
        run.clear_sent_at = iso(ctx.now)
        ctx.save()
        await io.herdr.agentPrompt(loc.pane.pane_id, '/clear')
        return
      }
      return send(s, st, ctx, loc.pane)
    }
  }
  const canResume = s.reuse === 'continue' && !!st.binding?.session_id
  if (loc.kind === 'shell') {
    if (s.reuse === 'fresh') {
      await io.herdr.paneClose(loc.pane.pane_id)
      st.binding = null
    } else {
      run.path = canResume ? 'resume_in_pane' : 'new_in_pane'
      return beginLaunch(s, st, ctx, loc.pane, canResume ? 'resume' : 'new')
    }
  }
  if (loc.kind === 'restored') {
    // herdr restarted: the pane came back as an empty shell without our env. Close it and reopen (§6.4).
    await io.herdr.paneClose(loc.pane.pane_id)
  }
  const kind = s.reuse === 'continue' && !!st.binding?.session_id ? 'resume' : 'new'
  run.path = kind === 'resume' ? 'resume_new_pane' : 'new'
  const pane = await openPane(s, st, ctx)
  if (kind === 'new') st.binding = null
  return beginLaunch(s, st, ctx, pane, kind)
}

async function starting(s, st, ctx) {
  const { io } = ctx
  const run = st.run
  const L = run.launch
  const now = ctx.now
  const pane = await io.herdr.paneGet(st.binding.pane_id)
  if (!pane || pane.terminal_id !== st.binding.terminal_id) {
    if (run.attempts >= 3) return end(s, st, ctx, 'failed', { note: '工單 pane 在啟動過程中不見了' })
    st.binding.pane_id = null
    run.state = 'queued'
    return
  }
  if (!L.launched) {
    let text = await io.herdr.paneRead(pane.pane_id, { lines: 10 })
    if (!isShellPrompt(text) && io.herdr.paneWaitOutput) {
      // A fresh tab usually shows its prompt within seconds; wait a little instead of a whole tick.
      try {
        await io.herdr.paneWaitOutput(pane.pane_id, { regex: 'PS .*>\\s*$', timeout: 15000, lines: 10 })
        text = await io.herdr.paneRead(pane.pane_id, { lines: 10 })
      } catch {}
    }
    if (isShellPrompt(text)) {
      L.launched = true
      L.started_at = iso(now)
      L.line = pwshLine(launchArgv(s, L.kind, L.session))
      ctx.save()
      await io.herdr.paneRun(pane.pane_id, L.line)
      return
    }
    if (now - Date.parse(L.opened_at) > SHELL_LIMIT_MS) {
      if (L.kind === 'new' && st.binding) st.binding.session_id = null
      return end(s, st, ctx, 'failed', { note: '新開的 pane 一直沒出現 PowerShell 提示字元' })
    }
    return
  }
  const r = io.sessionStart(s.id)
  if (after(r, L.started_at)) {
    st.binding.session_id = r.session_id ?? st.binding.session_id
    run.session_id = st.binding.session_id
    run.state = 'ready'
    run.ready_at = r.at
    io.log(`${s.id}: ready (${r.source}) session ${r.session_id}`)
    return
  }
  const text = await io.herdr.paneRead(pane.pane_id, { lines: 40 })
  // A new conversation that never reported SessionStart was never created: don't try to resume it later.
  const forgetIfNew = () => { if (L.kind === 'new' && st.binding) st.binding.session_id = null }
  if (isTrustPrompt(text)) {
    forgetIfNew()
    return end(s, st, ctx, 'blocked', { note: `Claude 停在「信任這個資料夾」的畫面。請到「排程」workspace 的 ${s.id} tab 自己選，之後再用 run-now 觸發` })
  }
  const waited = now - Date.parse(L.started_at)
  if (L.kind === 'resume' && (isNoConversation(text) || waited > READY_LIMIT_MS)) {
    io.log(`${s.id}: resume of ${L.session} failed, starting a new conversation`)
    run.resume_failed = L.session
    if (isShellPrompt(text)) {
      run.path = 'new_after_resume_failed'
      beginLaunch(s, st, ctx, pane, 'new')
      return
    }
    await io.herdr.paneClose(pane.pane_id)
    st.binding = null
    run.state = 'queued'
    return
  }
  if (waited > READY_LIMIT_MS) {
    forgetIfNew()
    return end(s, st, ctx, 'failed', { note: 'Claude 3 分鐘內沒有回報就緒。可能是啟動失敗，或沒裝 herdr-scheduler 的 Claude Code 插件（hsched doctor 可以檢查）' })
  }
}

async function ready(s, st, ctx) {
  const { io } = ctx
  const run = st.run
  if (ctx.now - Date.parse(run.ready_at) < SAFETY_MS) return
  const pane = await io.herdr.paneGet(st.binding.pane_id)
  if (!pane || pane.terminal_id !== st.binding.terminal_id) {
    run.state = 'queued'
    return
  }
  const text = await io.herdr.paneRead(pane.pane_id, { lines: 40 })
  if (isTrustPrompt(text) || isDialog(text)) {
    await notifyOnce(ctx, run, 'dialog', `排程 ${s.id} 在等你回答`, '工單 pane 上有確認框或問題，處理完才會送出這次的任務')
    return
  }
  if (busyStatus(pane)) return
  return send(s, st, ctx, pane)
}

async function clearing(s, st, ctx) {
  const run = st.run
  const r = ctx.io.sessionStart(s.id)
  if (after(r, run.clear_sent_at) && r.source === 'clear') {
    st.binding.session_id = r.session_id
    run.state = 'ready'
    run.ready_at = r.at
    return
  }
  if (ctx.now - Date.parse(run.clear_sent_at) > READY_LIMIT_MS) {
    ctx.io.log(`${s.id}: no SessionStart after /clear; sending anyway`)
    run.state = 'ready'
    run.ready_at = iso(ctx.now - SAFETY_MS)
  }
}

const runningTasks = list => (Array.isArray(list) ? list.filter(t => !t?.status || ['running', 'pending', 'queued'].includes(t.status)) : [])

async function sentState(s, st, ctx) {
  const { io } = ctx
  const run = st.run
  const loc = await locate(st, io)
  if (loc.kind !== 'live') {
    const why = { gone: '工單 pane 被關掉了', shell: 'Claude 已經結束，pane 裡只剩 shell', restored: 'herdr 重啟過，原本的 Claude 已經結束' }[loc.kind]
    return end(s, st, ctx, 'lost', { note: why })
  }
  const t = io.lastTurn(s.id)
  const stopped = after(t, run.sent_at) && (!run.prev_turn_at || after(t, run.prev_turn_at))
  if (stopped) {
    const bg = runningTasks(t.background_tasks)
    if (bg.length === 0) {
      if (t.session_id) st.binding.session_id = t.session_id
      const result_path = io.writeResult(s, run, t.last_assistant_message, { ended_at: t.at, session_id: t.session_id })
      return end(s, st, ctx, 'completed', { result_path, message: t.last_assistant_message })
    }
    run.background = bg.length
  }
  const text = await io.herdr.paneRead(loc.pane.pane_id, { lines: 40 })
  const dialog = isDialog(text)
  if (dialog) await notifyOnce(ctx, run, 'dialog', `排程 ${s.id} 在等你回答`, '工單 pane 上有確認框或問題')
  // Esc interrupts end a turn without a Stop hook (M0). Someone is at the pane; just close the run.
  if (!stopped && !dialog && !liveBusy(loc.pane) && isInterrupted(text) && ctx.now - Date.parse(run.sent_at) > 60 * 1000) {
    return end(s, st, ctx, 'abandoned', { note: '這一輪在 pane 裡被中斷（Esc），沒有結果', quiet: true })
  }
  // §6.5: a newer fire is waiting. No Stop at all since sending, agent idle, no dialog:
  // the turn ended without a Stop (e.g. Esc). Close it and let the new one go.
  if (st.pending && !stopped && !dialog && !liveBusy(loc.pane) && ctx.now - Date.parse(run.sent_at) > ABANDON_AFTER_MS) {
    return end(s, st, ctx, 'abandoned', { note: '下一次觸發時，上一次送出後一直沒收到結束回報，但 agent 已經閒著' })
  }
}

async function onFire(s, st, fire, ctx) {
  const { io } = ctx
  const run = newRun(fire)
  if (fire.late && s.on_missed === 'skip') {
    await io.finish(s, run, 'missed', { note: `錯過 ${local(fire.at)} 的觸發（on_missed=skip）`, quiet: true })
    return
  }
  if (!st.run) {
    st.run = run
    io.log(`${s.id}: fired ${run.id}${fire.forced ? ' (run-now)' : ''}${fire.late ? ' (late)' : ''}`)
    return
  }
  if (st.run.state !== 'sent') {
    io.log(`${s.id}: fired while ${st.run.id} is still ${st.run.state}; merged`)
    return
  }
  await io.notify(`排程 ${s.id}：上一次還沒結束`, `上一次（${local(st.run.sent_at)} 送出）還沒結束`, 'request')
  if (s.on_busy === 'skip') {
    await io.finish(s, run, 'skipped', { note: '上一次執行還沒結束（on_busy=skip）', quiet: true })
    return
  }
  st.pending ??= { fired_at: run.fired_at, late: run.late, forced: run.forced }
}

const HANDLERS = { queued, starting, ready, clearing, sent: sentState }

export async function step(s, st, ctx) {
  if (st.binding && !sameBinding(st.binding.of, bindingKey(s))) {
    ctx.io.log(`${s.id}: cwd or command changed; old binding dropped`)
    st.binding = null
  }
  const fire = fireCheck(s, st, ctx.now)
  if (fire) await onFire(s, st, fire, ctx)
  for (let i = 0; i < 5; i += 1) {
    if (!st.run && st.pending) {
      st.run = newRun({ at: st.pending.fired_at, late: st.pending.late, forced: st.pending.forced })
      st.pending = null
    }
    if (!st.run) return
    const before = `${st.run.id}:${st.run.state}:${st.run.launch?.session}:${st.run.launch?.launched}`
    await HANDLERS[st.run.state](s, st, ctx)
    ctx.save()
    if (st.run && `${st.run.id}:${st.run.state}:${st.run.launch?.session}:${st.run.launch?.launched}` === before) return
  }
}
