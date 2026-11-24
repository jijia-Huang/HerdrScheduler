// Thin wrapper over the herdr CLI. Arguments go as an array (no shell), so task text
// reaches herdr byte for byte. Every call returns the parsed `result` or throws HerdrError.
import { execFile } from 'node:child_process'

export class HerdrError extends Error {
  constructor(code, message, args) {
    super(message)
    this.code = code
    this.args = args
  }
}

const bin = () => process.env.HERDR_BIN_PATH || 'herdr'

export function call(args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin(), args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = (stdout || '').trim()
      let parsed = null
      try { parsed = text ? JSON.parse(text) : null } catch {}
      if (!parsed && error && stderr) {
        try { parsed = JSON.parse(stderr.trim()) } catch {}
      }
      if (parsed?.error) return reject(new HerdrError(parsed.error.code ?? 'herdr_error', parsed.error.message ?? text, args))
      if (error) return reject(new HerdrError(error.killed ? 'herdr_timeout' : 'herdr_failed', `${args.slice(0, 3).join(' ')}: ${(stderr || text || error.message).trim()}`, args))
      resolve(parsed ? parsed.result ?? parsed : text)
    })
  })
}

const orNull = async promise => {
  try {
    return await promise
  } catch (error) {
    if (error instanceof HerdrError && /not_found/.test(error.code)) return null
    throw error
  }
}

export const herdr = {
  call,
  workspaceGet: id => orNull(call(['workspace', 'get', id]).then(r => r.workspace)),
  workspaceCreate: ({ label, cwd, env = {} }) => call([
    'workspace', 'create', '--label', label, ...(cwd ? ['--cwd', cwd] : []),
    ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--no-focus',
  ]),
  tabGet: id => orNull(call(['tab', 'get', id]).then(r => r.tab)),
  tabList: workspace => call(['tab', 'list', '--workspace', workspace]).then(r => r.tabs ?? []),
  tabCreate: ({ workspace, cwd, label, env = {} }) => call([
    'tab', 'create', '--workspace', workspace, '--cwd', cwd, '--label', label,
    ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--no-focus',
  ]),
  tabRename: (id, label) => call(['tab', 'rename', id, label]),
  workspaceFocus: id => call(['workspace', 'focus', id]),
  tabFocus: id => call(['tab', 'focus', id]),
  paneGet: id => orNull(call(['pane', 'get', id]).then(r => r.pane)),
  paneList: () => call(['pane', 'list']).then(r => r.panes ?? []),
  // recent-unwrapped: logical lines, so a long prompt path wrapped by a narrow pane still matches.
  paneRead: (id, { source = 'recent-unwrapped', lines = 60 } = {}) => call(['pane', 'read', id, '--source', source, '--lines', String(lines)]).then(r => (typeof r === 'string' ? r : r.text ?? r.content ?? JSON.stringify(r))),
  paneRun: (id, line) => call(['pane', 'run', id, line]),
  paneClose: id => orNull(call(['pane', 'close', id])),
  paneSendKeys: (id, ...keys) => call(['pane', 'send-keys', id, ...keys]),
  paneWaitOutput: (id, { regex, timeout = 10000, lines = 20 }) => call(['pane', 'wait-output', id, '--regex', regex, '--source', 'recent-unwrapped', '--lines', String(lines), '--timeout', String(timeout)], { timeout: timeout + 5000 }),
  processInfo: id => orNull(call(['pane', 'process-info', '--pane', id]).then(r => r.process_info)),
  agentPrompt: (id, text) => call(['agent', 'prompt', id, text]),
  notify: (title, body, sound = 'done') => call(['notification', 'show', title, ...(body ? ['--body', body] : []), '--sound', sound]).catch(() => null),
  pluginPaneOpen: ({ plugin, entrypoint, workspace }) => call(['plugin', 'pane', 'open', '--plugin', plugin, '--entrypoint', entrypoint, '--placement', 'tab', '--workspace', workspace, '--no-focus']),
}
