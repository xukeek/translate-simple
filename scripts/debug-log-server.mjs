#!/usr/bin/env node
/**
 * Dev-only: receive debug lines from the extension and append to debug/ts-collect.log
 * Usage: node scripts/debug-log-server.mjs
 */
import { createServer } from 'node:http'
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const LOG_DIR = join(ROOT, 'debug')
const LOG_FILE = join(LOG_DIR, 'ts-collect.log')
const PORT = Number(process.env.TS_DEBUG_PORT || 8787)
const HOST = '127.0.0.1'

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

function stamp() {
  return new Date().toISOString()
}

function writeLine(line) {
  const text = line.endsWith('\n') ? line : `${line}\n`
  appendFileSync(LOG_FILE, text, 'utf8')
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, file: LOG_FILE }))
    return
  }

  if (req.method === 'POST' && (req.url === '/log' || req.url === '/')) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let lines = []
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') lines = [parsed]
      else if (Array.isArray(parsed?.lines)) lines = parsed.lines.map(String)
      else if (parsed?.line != null) lines = [String(parsed.line)]
      else lines = [raw]
    } catch {
      lines = raw ? [raw] : []
    }
    for (const line of lines) {
      writeLine(`[${stamp()}] ${line}`)
      console.log(line)
    }
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/clear') {
    writeFileSync(LOG_FILE, `# cleared ${stamp()}\n`, 'utf8')
    res.writeHead(204)
    res.end()
    return
  }

  res.writeHead(404)
  res.end('not found')
})

/** Probe an existing listener to see whether it is another instance of this server. */
async function probeExisting() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`http://${HOST}:${PORT}/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(`[ts-debug-server] ${err.message}`)
    process.exit(1)
  }

  const existing = await probeExisting()
  if (existing?.ok) {
    console.log(
      `[ts-debug-server] already running on http://${HOST}:${PORT} → ${existing.file}\n` +
        `[ts-debug-server] reusing it; nothing to do. ` +
        `Use TS_DEBUG_PORT=<port> to run a second instance.`
    )
    process.exit(0)
  }

  console.error(
    `[ts-debug-server] port ${PORT} is used by another process (not this log server).\n` +
      `[ts-debug-server] free the port, or run: TS_DEBUG_PORT=8788 pnpm dev:log\n` +
      `[ts-debug-server] (the extension posts to 127.0.0.1:8787 by default — see utils/debugLog.ts)`
  )
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  writeLine(`# server started ${stamp()} → ${LOG_FILE}`)
  console.log(`[ts-debug-server] http://${HOST}:${PORT} → ${LOG_FILE}`)
})
