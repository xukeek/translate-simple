/** Dev debug logger: console + optional localhost file sink via background. */

const DEBUG_ENDPOINT = 'http://127.0.0.1:8787/log'
const FLUSH_MS = 80
const MAX_QUEUE = 200

let queue: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let fileSinkEnabled: boolean | null = null

function pageDebugOn(): boolean {
  try {
    return localStorage.getItem('ts-debug') === '1'
  } catch {
    return false
  }
}

/** Content script: file sink when ts-debug=1. Background: always try in DEV. */
function wantFileSink(): boolean {
  if (fileSinkEnabled != null) return fileSinkEnabled
  try {
    // Background / service worker has no localStorage; use DEV flag
    if (typeof localStorage === 'undefined') {
      fileSinkEnabled = import.meta.env.DEV
      return fileSinkEnabled
    }
    fileSinkEnabled = pageDebugOn() || import.meta.env.DEV
    return fileSinkEnabled
  } catch {
    fileSinkEnabled = false
    return false
  }
}

export function isTsDebug(): boolean {
  return pageDebugOn()
}

function enqueue(line: string): void {
  if (!wantFileSink()) return
  queue.push(line)
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushQueue()
  }, FLUSH_MS)
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return
  const lines = queue
  queue = []

  // Prefer background relay (avoids page CORS); fall back to direct fetch in SW
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({ type: 'debugLog', lines })
      return
    }
  } catch {
    /* fall through */
  }

  try {
    await fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines }),
    })
  } catch {
    /* server not running — ignore */
  }
}

/** Background handler: POST lines to local debug server (dev only). */
export async function forwardDebugLogs(lines: string[]): Promise<void> {
  if (!import.meta.env.DEV) return
  if (!lines.length) return
  try {
    await fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines }),
    })
  } catch {
    /* silent if server down */
  }
}

export function tsLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  ...optional: unknown[]
): void {
  const extra =
    optional.length > 0
      ? ' ' + optional.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')
      : ''
  const line = `${message}${extra}`
  if (level === 'warn') console.warn(line)
  else if (level === 'error') console.error(line)
  else console.info(line)
  enqueue(line)
}

export function tsInfo(message: string, ...optional: unknown[]): void {
  tsLog('info', message, ...optional)
}

export function tsWarn(message: string, ...optional: unknown[]): void {
  tsLog('warn', message, ...optional)
}

/** Reset cached sink flag after toggling localStorage.ts-debug */
export function resetDebugSinkFlag(): void {
  fileSinkEnabled = null
}
