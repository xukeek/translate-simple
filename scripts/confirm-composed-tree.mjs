/**
 * Generic composed-tree regression for collectTextBlocks heuristics
 * (mirrors utils/dom.ts rules in-browser without loading the extension bundle).
 *
 * Usage: node scripts/confirm-composed-tree.mjs
 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FIXTURE = join(__dirname, 'fixtures', 'composed-tree.html')
const LOG_DIR = join(ROOT, 'debug')
const LOG_FILE = join(LOG_DIR, 'ts-collect.log')
const OUT_JSON = join(LOG_DIR, 'composed-tree-confirm.json')

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

function log(line) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  console.log(line)
}

/** In-page evaluation of the unified composed-tree split rules */
const BROWSER_CONFIRM_FN = () => {
  const BLOCK_DISPLAYS = new Set([
    'block', 'flex', 'grid', 'table', 'table-cell', 'table-caption',
    'table-row', 'table-row-group', 'table-header-group', 'table-footer-group',
    'list-item', 'flow-root',
  ])

  function openShadow(el) {
    try { return el.shadowRoot } catch { return null }
  }
  function getDisplay(el) {
    return getComputedStyle(el).display
  }
  function flattenSlots(nodes) {
    if (!nodes.some((n) => n.nodeType === 1 && n.tagName === 'SLOT')) return nodes
    const out = []
    for (const n of nodes) {
      if (n.nodeType === 1 && n.tagName === 'SLOT') {
        const assigned = n.assignedNodes({ flatten: true })
        if (assigned.length > 0) out.push(...assigned)
        else out.push(...flattenSlots([...n.childNodes]))
        continue
      }
      out.push(n)
    }
    return out
  }
  function composedChildren(node) {
    if (node.nodeType !== 1) return []
    const el = node
    const sr = openShadow(el)
    const raw = sr ? [...sr.childNodes] : [...el.childNodes]
    return flattenSlots(raw)
  }

  function generatesNoBox(el, display) {
    return display === 'contents' || el.tagName === 'SLOT'
  }

  function composedTextLength(el, cap = 8) {
    let len = (el.textContent || '').replace(/\s+/g, ' ').trim().length
    if (len >= cap) return len
    if (el.tagName === 'SLOT') {
      for (const n of el.assignedNodes({ flatten: true })) {
        len += (n.textContent || '').replace(/\s+/g, ' ').trim().length
        if (len >= cap) return len
      }
      return len
    }
    const sr = openShadow(el)
    if (sr) len += (sr.textContent || '').replace(/\s+/g, ' ').trim().length
    return len
  }

  /** mirrors hiddenSkipReason zero-size rule */
  function isHiddenSkip(el) {
    const style = getComputedStyle(el)
    if (style.display === 'none') return true
    if (style.visibility === 'hidden') return true
    if (generatesNoBox(el, style.display)) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 1 && rect.height <= 1) {
      if (composedTextLength(el) < 3) return true
    }
    return false
  }
  function layoutCtx(el) {
    const d = getDisplay(el)
    if (d === 'flex' || d === 'inline-flex') {
      const dir = getComputedStyle(el).flexDirection
      return dir === 'column' || dir === 'column-reverse' ? 'flex-col' : 'flex-row'
    }
    if (d === 'grid' || d === 'inline-grid') return 'grid'
    if (d === 'table' || d.startsWith('table-')) return 'table'
    if (BLOCK_DISPLAYS.has(d)) return 'block'
    return 'inline'
  }

  const blockTextCache = new WeakMap()

  function composedHasVisibleText(el) {
    for (const node of composedChildren(el)) {
      if (node.nodeType === 3) {
        if (node.textContent?.trim()) return true
        continue
      }
      if (node.nodeType !== 1) continue
      if (getDisplay(node) === 'none') continue
      if (composedHasVisibleText(node)) return true
    }
    return false
  }

  function hasComposedBlockContent(el) {
    if (blockTextCache.has(el)) return blockTextCache.get(el)
    const parentCtx = layoutCtx(el)
    const parentIsFlexOrGrid = parentCtx === 'flex-row' || parentCtx === 'flex-col' || parentCtx === 'grid'
    let result = false
    for (const node of composedChildren(el)) {
      if (node.nodeType !== 1) continue
      const display = getDisplay(node)
      if (display === 'none') continue
      if (display === 'contents') {
        if (hasComposedBlockContent(node)) { result = true; break }
        continue
      }
      if (parentIsFlexOrGrid) {
        if (hasComposedBlockContent(node)) { result = true; break }
      } else if (BLOCK_DISPLAYS.has(display) && composedHasVisibleText(node)) {
        result = true
        break
      } else if (hasComposedBlockContent(node)) {
        result = true
        break
      }
    }
    blockTextCache.set(el, result)
    return result
  }

  function shouldSplitChild(child, parentCtx) {
    const display = getDisplay(child)
    if (display === 'none') return false
    if (display === 'contents') return true
    const shellWithBlocks = !BLOCK_DISPLAYS.has(display) && hasComposedBlockContent(child)
    switch (parentCtx) {
      case 'flex-row':
        return hasComposedBlockContent(child) || shellWithBlocks
      case 'flex-col':
      case 'grid':
      case 'table':
        return composedHasVisibleText(child) || hasComposedBlockContent(child) || shellWithBlocks
      case 'block':
        if (BLOCK_DISPLAYS.has(display)) return true
        return shellWithBlocks || hasComposedBlockContent(child)
      case 'inline':
        return shellWithBlocks || hasComposedBlockContent(child)
    }
  }

  function collectUnits(el, out, inheritedCtx) {
    if (isHiddenSkip(el)) return
    const display = getDisplay(el)
    const transparent = generatesNoBox(el, display)
    const ctx = transparent ? (inheritedCtx || 'block') : layoutCtx(el)

    if (!hasComposedBlockContent(el)) {
      const text = extractComposed(el).replace(/\s+/g, ' ').trim()
      if (text.length >= 3) out.push({ el: el.id || el.tagName.toLowerCase(), text: text.slice(0, 60) })
      return
    }
    for (const node of composedChildren(el)) {
      if (node.nodeType !== 1) continue
      if (isHiddenSkip(node)) continue
      if (shouldSplitChild(node, ctx)) collectUnits(node, out, ctx)
      else {
        const text = extractComposed(node).replace(/\s+/g, ' ').trim()
        if (text.length >= 3) out.push({ el: (node.id || node.tagName.toLowerCase()), text: text.slice(0, 60), merged: true })
      }
    }
  }

  function extractComposed(root) {
    const parts = []
    const visit = (node, isRoot) => {
      if (node.nodeType === 3) {
        const t = node.textContent?.trim()
        if (t) parts.push(t)
        return
      }
      if (node.nodeType !== 1) return
      if (!isRoot && getDisplay(node) === 'none') return
      for (const c of composedChildren(node)) visit(c, false)
    }
    visit(root, true)
    return parts.join(' ')
  }

  function countSplits(container) {
    const out = []
    collectUnits(container, out)
    return out
  }

  const results = {}
  results.blockInline = countSplits(document.getElementById('block-inline')).length
  results.inlineShell = countSplits(document.getElementById('inline-shell')).length
  results.flexCol = countSplits(document.getElementById('flex-col')).length
  results.grid = countSplits(document.getElementById('grid')).length
  results.contents = countSplits(document.getElementById('contents')).length

  const mount = document.getElementById('shadow-host-mount')
  const shadowUnits = countSplits(mount)
  results.shadowCards = shadowUnits.length

  // Slot text should appear once (composed), not doubled with shadow chrome
  const firstCard = mount.querySelector('demo-card')
  const composedText = extractComposed(firstCard)
  results.slotNoDup =
    (composedText.match(/First slotted card title here/g) || []).length === 1 &&
    !composedText.includes('internal chrome should not dominate')

  // Bare <slot>: display:contents + zero rect + empty fallback text.
  // Regression for the bug where it was dropped as "zero-size", losing all projected content.
  const nested = mount.querySelector('nested-host')
  const bareSlot = nested.shadowRoot.querySelector('slot[name="body"]')
  const slotRect = bareSlot.getBoundingClientRect()
  results.slotDisplay = getDisplay(bareSlot)
  results.slotZeroRect = slotRect.width <= 1 && slotRect.height <= 1
  results.slotFallbackTextEmpty = (bareSlot.textContent || '').trim().length === 0
  results.slotSurvivesHiddenCheck = !isHiddenSkip(bareSlot)
  results.nestedSlotTextCollected = countSplits(nested).some((u) =>
    u.text.includes('Nested slot body paragraph text')
  )
  results.slottedTextCollected = shadowUnits.some((u) =>
    u.text.includes('First slotted card title here')
  )

  // Old bug: inline shell children all merged under block parent without shellWithBlocks
  const shell = document.getElementById('shell')
  const oldWouldMerge = getDisplay(shell) === 'inline' && shell.children.length >= 2

  results.checks = {
    blockInline: results.blockInline >= 2,
    inlineShellSplit: results.inlineShell >= 2,
    flexColSplit: results.flexCol >= 3,
    gridSplit: results.grid >= 4,
    contentsSplit: results.contents >= 2,
    shadowSplit: results.shadowCards >= 3,
    slotNoDup: results.slotNoDup,
    bareSlotIsZeroRect: results.slotZeroRect && results.slotFallbackTextEmpty,
    slotSurvivesHiddenCheck: results.slotSurvivesHiddenCheck,
    slottedTextCollected: results.slottedTextCollected,
    nestedSlotTextCollected: results.nestedSlotTextCollected,
    noSlotAsUnit: !shadowUnits.some((u) => u.el === 'slot'),
  }
  results.info = { oldInlineShellWouldCollapse: oldWouldMerge, slotDisplay: results.slotDisplay }
  results.ok = Object.values(results.checks).every((v) => v === true)

  return results
}

async function main() {
  const html = readFileSync(FIXTURE, 'utf8')
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`

  let playwright
  try {
    playwright = await import('playwright')
  } catch (err) {
    log(`[ts-confirm] playwright missing: ${err.message}`)
    server.close()
    process.exit(1)
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL || 'chrome',
  }).catch(() => playwright.chromium.launch({ headless: true }))

  const page = await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.__fixtureReady === true)
  const result = await page.evaluate(BROWSER_CONFIRM_FN)
  await browser.close()
  server.close()

  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2))
  log(`[ts-confirm] ${JSON.stringify(result)}`)

  try {
    await fetch('http://127.0.0.1:8787/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: [`[ts-confirm] ${JSON.stringify(result)}`] }),
    })
  } catch { /* optional */ }

  if (!result.ok) {
    console.error('[ts-confirm] FAIL')
    process.exit(1)
  }
  log('[ts-confirm] PASS: composed-tree split rules')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
