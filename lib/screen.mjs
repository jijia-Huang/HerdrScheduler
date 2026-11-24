// Screen text rules, kept in one place so a Claude Code UI change is a one-file fix.
// Input is `herdr pane read` text (recent lines of the pane). Texts verified in M0 (Claude Code 2.1.330).

const lastLines = (text, n) => String(text ?? '').split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '').slice(-n)

// Folder trust prompt shown before Claude starts in an untrusted folder. Never answer it with keys:
// Enter picks the default "No, exit". (Not reproduced in M0; texts from cc-superagent's tests.)
export const isTrustPrompt = text => /Is this a project you created or one you trust|Do you trust the files in this folder|Yes, I trust this folder/i.test(text)

// Permission / question dialog waiting for the user. M0: "Do you want to create m0-perm-test.txt?",
// "❯ 1. Yes", "Esc to cancel · Tab to amend". herdr keeps reporting "working" meanwhile.
export function isDialog(text) {
  const tail = lastLines(text, 20).join('\n')
  if (/^\s*Do you want to .+\?\s*$/m.test(tail)) return true
  if (/Esc to cancel/i.test(tail) && /^\s*(❯\s*)?1\.\s/m.test(tail)) return true
  if (/Would you like to proceed\?/i.test(tail)) return true
  return false
}

// Turn interrupted with Esc: no Stop hook fires (M0). Only meaningful near the bottom of the screen.
export const isInterrupted = text => /Interrupted · What should Claude do instead\?/.test(lastLines(text, 12).join('\n'))

export const isNoConversation = text => /No conversation found with session ID/i.test(text)

// PowerShell prompt as the last non-empty line, e.g. "(base) PS D:\Tool>".
export const isShellPrompt = text => /PS .*>\s*$/.test(lastLines(text, 1)[0] ?? '')
