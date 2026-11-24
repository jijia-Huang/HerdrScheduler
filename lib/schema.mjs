// Schedule definition: validation, defaults, and how the launch command is built.
import { existsSync, statSync } from 'node:fs'
import { parseCron } from './cron.mjs'
import { fail } from './errors.mjs'

export const DEFAULTS = {
  command: ['claude'],
  args: [],
  new_args: ['--session-id', '{session}'],
  resume_args: ['--resume', '{session}'],
  reuse: 'continue',
  on_busy: 'queue',
  on_missed: 'run_once',
  enabled: true,
}

const ENUMS = {
  reuse: ['continue', 'clear', 'fresh'],
  on_busy: ['queue', 'skip'],
  on_missed: ['run_once', 'skip'],
}

export const FIELDS = ['id', 'when', 'cwd', 'command', 'args', 'new_args', 'resume_args', 'task', 'reuse', 'on_busy', 'on_missed', 'enabled', 'note']

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/

function stringArray(name, v) {
  if (typeof v === 'string') {
    // Convenience for people and AIs: "skillpool inanna-slot" -> ["skillpool", "inanna-slot"].
    v = v.trim() === '' ? [] : v.trim().split(/\s+/)
  }
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || x === '')) {
    fail('invalid_field', `${name} must be an array of non-empty strings`, `Example: "${name}": ["skillpool", "inanna-slot"]`)
  }
  return v
}

// Validate a full schedule (defaults filled in). Returns a clean copy.
export function validate(input, { checkCwd = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_field', 'schedule must be an object')
  for (const key of Object.keys(input)) {
    if (!FIELDS.includes(key)) fail('unknown_field', `unknown field "${key}"`, `Allowed fields: ${FIELDS.join(', ')}`)
  }
  const s = { ...DEFAULTS, ...input }
  if (typeof s.id !== 'string' || !ID_RE.test(s.id)) {
    fail('invalid_id', `id "${s.id}" is not valid`, 'Use 1-48 lowercase letters, digits and "-", starting with a letter or digit, e.g. "weekly-slot-test".')
  }
  parseCron(s.when)
  if (typeof s.cwd !== 'string' || s.cwd.trim() === '') fail('invalid_field', 'cwd is required', 'Give an absolute folder path, e.g. "D:\\\\TMD\\\\Inanna".')
  if (checkCwd && !(existsSync(s.cwd) && statSync(s.cwd).isDirectory())) {
    fail('cwd_not_found', `cwd "${s.cwd}" is not an existing folder`, 'Create the folder first or fix the path.')
  }
  s.command = stringArray('command', s.command)
  if (s.command.length === 0) fail('invalid_field', 'command must not be empty', 'Default is ["claude"]; a SkillPool profile is ["skillpool", "<profile>"].')
  s.args = stringArray('args', s.args)
  s.new_args = stringArray('new_args', s.new_args)
  s.resume_args = stringArray('resume_args', s.resume_args)
  if (!s.new_args.some(a => a.includes('{session}'))) fail('invalid_field', 'new_args must contain {session}', 'Default is ["--session-id", "{session}"].')
  if (!s.resume_args.some(a => a.includes('{session}'))) fail('invalid_field', 'resume_args must contain {session}', 'Default is ["--resume", "{session}"].')
  if (typeof s.task !== 'string' || s.task.trim() === '') fail('invalid_field', 'task is required', 'The text sent to the agent each time, e.g. "/inanna-irpc:slot-weekly 照上週那樣跑". It may be multi-line.')
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(s[key])) fail('invalid_field', `${key} must be one of ${allowed.join(', ')}`, `Got "${s[key]}".`)
  }
  if (typeof s.enabled !== 'boolean') fail('invalid_field', 'enabled must be true or false')
  if (s.note !== undefined && typeof s.note !== 'string') fail('invalid_field', 'note must be a string')
  return s
}

// Fields that make an old pane/session binding unusable when they change.
export const bindingKey = s => ({ cwd: s.cwd, command: s.command })
export const sameBinding = (a, b) => !!a && !!b && a.cwd.toLowerCase() === b.cwd.toLowerCase() && JSON.stringify(a.command) === JSON.stringify(b.command)

export function launchArgv(s, kind, sessionId) {
  const extra = (kind === 'resume' ? s.resume_args : s.new_args).map(a => a.replaceAll('{session}', sessionId))
  return [...s.command, ...s.args, ...extra]
}

// PowerShell command line: & 'cmd' 'arg' ... with single quotes doubled.
export function pwshLine(argv) {
  const q = a => `'${a.replaceAll("'", "''")}'`
  return `& ${argv.map(q).join(' ')}`
}
