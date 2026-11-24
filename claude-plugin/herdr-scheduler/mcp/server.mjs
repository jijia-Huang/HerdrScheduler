#!/usr/bin/env node
// HerdrScheduler MCP server over STDIO (newline-delimited JSON-RPC 2.0), no dependencies.
// The installed plugin is a cached copy, so the real code is loaded from the tool folder:
//   HERDR_SCHEDULER_ROOT, else this file's source checkout, else install.json written by `hsched install`.
import { createInterface } from 'node:readline'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

function toolRoot() {
  const candidates = []
  if (process.env.HERDR_SCHEDULER_ROOT) candidates.push(process.env.HERDR_SCHEDULER_ROOT)
  candidates.push(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))
  try {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const info = JSON.parse(readFileSync(join(local, 'herdr-scheduler', 'install.json'), 'utf8'))
    if (info.tool_root) candidates.push(info.tool_root)
  } catch {}
  return candidates.find(root => existsSync(join(root, 'lib', 'ops.mjs'))) ?? null
}

const root = toolRoot()
let ops = null
let doctor = null
let loadError = null
if (root) {
  try {
    ops = await import(pathToFileURL(join(root, 'lib', 'ops.mjs')).href)
    doctor = (await import(pathToFileURL(join(root, 'lib', 'doctor.mjs')).href)).doctor
  } catch (error) {
    loadError = String(error?.message ?? error)
  }
} else {
  loadError = 'HerdrScheduler tool folder not found'
}

const ID = { type: 'string', description: 'Schedule id. Omit inside a scheduled work pane to mean that pane\'s own schedule.' }
const SCHEDULE_FIELDS = {
  when: { type: 'string', description: '5-field cron in local time: "minute hour day-of-month month day-of-week". Examples: "0 9 * * 1" every Monday 09:00; "30 8 * * 1-5" weekdays 08:30; "*/30 * * * *" every 30 minutes; "0 18 1 * *" 18:00 on the 1st of each month.' },
  cwd: { type: 'string', description: 'Absolute folder the agent starts in, e.g. "D:\\\\TMD\\\\Inanna". Must exist.' },
  task: { type: 'string', description: 'Exact text sent to the agent each time it fires, as if typed into Claude. May be multi-line and may be a slash command with arguments (e.g. "/inanna-irpc:slot-weekly 我是儒儒，照上週那樣跑"). Passed verbatim; no escaping needed.' },
  command: { type: 'array', items: { type: 'string' }, description: 'Launch command, one element per word. Default ["claude"]. For a SkillPool profile: ["skillpool", "<profile>"].' },
  args: { type: 'array', items: { type: 'string' }, description: 'Extra arguments added on every launch, e.g. ["--model", "opus"]. Default [].' },
  reuse: { type: 'string', enum: ['continue', 'clear', 'fresh'], description: 'continue (default): same pane and conversation each time, so the agent remembers earlier runs. clear: same pane, but /clear before each run. fresh: new pane and conversation every run.' },
  on_busy: { type: 'string', enum: ['queue', 'skip'], description: 'If the agent is still busy when it fires: queue (default) sends when it becomes idle; skip drops this run.' },
  on_missed: { type: 'string', enum: ['run_once', 'skip'], description: 'If herdr was not running at the fire time: run_once (default) runs once when it can; skip does not catch up.' },
  enabled: { type: 'boolean', description: 'false pauses the schedule. Default true.' },
  note: { type: 'string', description: 'Free text for people, e.g. what the schedule is for.' },
  new_args: { type: 'array', items: { type: 'string' }, description: 'Advanced. Arguments for a new conversation; {session} becomes a new UUID. Default ["--session-id", "{session}"].' },
  resume_args: { type: 'array', items: { type: 'string' }, description: 'Advanced. Arguments to resume; {session} becomes the recorded session id. Default ["--resume", "{session}"].' },
  dry_run: { type: 'boolean', description: 'true: only validate and show the result (next fire time, launch command); nothing is saved.' },
}

const TOOLS = [
  {
    name: 'schedule_list',
    description: 'List all HerdrScheduler schedules with next fire time, current pane/session binding and any run in progress.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => ops.listSchedules(),
  },
  {
    name: 'schedule_get',
    description: 'Show one schedule in full: definition, launch commands, binding, run in progress and the last 5 runs.',
    inputSchema: { type: 'object', properties: { id: ID }, additionalProperties: false },
    run: a => ops.getSchedule(a),
  },
  {
    name: 'schedule_add',
    description: 'Create a schedule: at each cron time HerdrScheduler sends `task` to a Claude Code pane in the herdr "排程" workspace (starting or resuming the agent when needed). Returns the next fire time and the launch command; tell the user both so they can confirm. Use dry_run first when unsure.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'New schedule id: 1-48 lowercase letters, digits and "-", e.g. "weekly-slot-test". Also used as the herdr tab name.' }, ...SCHEDULE_FIELDS },
      required: ['id', 'when', 'cwd', 'task'],
      additionalProperties: false,
    },
    run: a => ops.addSchedule(a),
  },
  {
    name: 'schedule_update',
    description: 'Change some fields of a schedule; fields not given stay as they are. enabled:false pauses, enabled:true resumes. Changing cwd or command makes the next run start a new conversation.',
    inputSchema: { type: 'object', properties: { id: ID, ...SCHEDULE_FIELDS }, additionalProperties: false },
    run: a => ops.updateSchedule(a),
  },
  {
    name: 'schedule_remove',
    description: 'Delete a schedule. Its work pane, if any, is left open.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    run: a => ops.removeSchedule(a),
  },
  {
    name: 'schedule_run_now',
    description: 'Fire a schedule once right now, without changing its regular times. The work pane opens immediately; Claude takes about a minute to start before the task is sent.',
    inputSchema: { type: 'object', properties: { id: ID }, additionalProperties: false },
    run: a => ops.runNow({ ...a, kick: true }),
  },
  {
    name: 'run_list',
    description: 'Finished runs, newest first: status (completed, skipped, missed, blocked, failed, lost, abandoned), times, pane, session and note.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Only runs of this schedule. Omit for all schedules.' }, limit: { type: 'number', description: 'Default 20, max 200.' } },
      additionalProperties: false,
    },
    run: a => ops.listRuns(a),
  },
  {
    name: 'run_result',
    description: 'The agent\'s final reply for one run. Give run_id, or a schedule id to get its latest result.',
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' }, id: ID }, additionalProperties: false },
    run: a => ops.getResult(a),
  },
  {
    name: 'scheduler_status',
    description: 'Check that HerdrScheduler is installed and running: herdr plugin, scheduler heartbeat, report hook, data folder. Use when runs do not happen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => doctor(),
  },
]

const INSTRUCTIONS = [
  'HerdrScheduler: scheduled work orders for Claude Code inside herdr.',
  'When the user asks to schedule, repeat, or periodically run something with an agent ("每週一早上跑…", "每天幫我…", "排程"), or asks about scheduled runs and their results, use these tools directly instead of editing files or giving the user commands to run.',
  'After schedule_add or schedule_update, tell the user the next fire time and launch command from the result.',
  'Errors come back as {code, message, hint}; fix the input as the hint says and call again.',
  process.env.HERDR_SCHEDULER_ID ? `This session is the work pane of schedule "${process.env.HERDR_SCHEDULER_ID}"; tools default to it when id is omitted.` : '',
].filter(Boolean).join(' ')

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

async function handle({ id, method, params }) {
  if (method === 'initialize') {
    return {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'herdr-scheduler', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name)
    if (!tool) return { ...text({ ok: false, error: { code: 'unknown_tool', message: `unknown tool ${params?.name}` } }), isError: true }
    if (!ops) {
      return { ...text({ ok: false, error: { code: 'not_installed', message: loadError, hint: 'Run `hsched install` in the HerdrScheduler folder (D:\\Tool\\HerdrScheduler), or set HERDR_SCHEDULER_ROOT.' } }), isError: true }
    }
    try {
      const result = await tool.run(params?.arguments ?? {})
      return text({ ok: true, ...result })
    } catch (error) {
      const e = error?.code && typeof error.code === 'string' && !error.code.startsWith('E')
        ? { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}) }
        : { code: 'internal', message: String(error?.message ?? error) }
      return { ...text({ ok: false, error: e }), isError: true }
    }
  }
  if (id === undefined) return undefined
  throw Object.assign(new Error(`method not found: ${method}`), { rpc: -32601 })
}

const lines = createInterface({ input: process.stdin })
lines.on('line', async line => {
  if (line.trim() === '') return
  let request
  try {
    request = JSON.parse(line)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    return
  }
  try {
    const result = await handle(request)
    if (request.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: request.id, result })
  } catch (error) {
    if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, error: { code: error.rpc ?? -32603, message: String(error.message ?? error) } })
  }
})
