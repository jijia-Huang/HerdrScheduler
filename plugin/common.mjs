// Shared by the herdr plugin entry points. The manifest passes --home and --plugin-id
// (written by `hsched install`), so a test install never touches the real data folder.
export function setup() {
  const argv = process.argv.slice(2)
  const opts = { rest: [] }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--home') opts.home = argv[++i]
    else if (argv[i] === '--plugin-id') opts.pluginId = argv[++i]
    else opts.rest.push(argv[i])
  }
  if (opts.home) process.env.HERDR_SCHEDULER_HOME = opts.home
  opts.pluginId ??= 'herdr-scheduler'
  return opts
}
