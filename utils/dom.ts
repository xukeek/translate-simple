import type { SiteRule } from './translate/types'
import { isTsDebug, resetDebugSinkFlag, tsInfo, tsWarn } from './debugLog'

const IGNORE_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'textarea', 'input',
  'select', 'option', 'svg', 'path', 'code', 'pre', 'kbd', 'samp',
  'template', 'canvas', 'video', 'audio', 'object', 'embed', 'button',
])

/** 语义地标:导航/工具栏等壳层不翻译 */
const UI_LANDMARK_TAGS = new Set(['nav'])
const UI_LANDMARK_ROLES = new Set([
  'navigation', 'banner', 'menubar', 'menu', 'menuitem',
  'tab', 'tablist', 'search', 'toolbar', 'complementary', 'tooltip',
])

// 只有这些 computed display 才视为块级容器(注意不含 inline-block)
const BLOCK_DISPLAYS = new Set([
  'block', 'flex', 'grid', 'table', 'table-cell', 'table-caption',
  'table-row', 'table-row-group', 'table-header-group', 'table-footer-group',
  'list-item', 'flow-root',
])

export interface TextBlock {
  id: string
  /** 翻译单元所在的块级容器 */
  element: Element
  /** 译文插入锚点:整块单元时等于 element,行内片段时为片段最后一个节点 */
  anchor: Node
  /** 是否是混合容器中的行内片段 */
  inlineSegment: boolean
  text: string
  /** 锚点若为 slotted light node,译文需继承同名 slot 才能投影到正确位置 */
  slotName?: string | null
}

let blockCounter = 0
// 已收集/已翻译的锚点,避免重复翻译(removeTranslations 时重置)
let processed = new WeakSet<Node>()
// containsBlockWithText 的单次收集缓存
let blockTextCache = new WeakMap<Element, boolean>()

// 当前生效的站点规则 exclude 选择器(collectTextBlocks 调用期间有效)
let excludeSelector: string | null = null

function isExcluded(el: Element): boolean {
  if (!excludeSelector) return false
  try {
    return Boolean(el.closest(excludeSelector))
  } catch {
    return false
  }
}

/** 是否落在导航等 UI 地标内；返回具体 reason 或 null */
function landmarkSkipReason(el: Element): string | null {
  let cur: Element | null = el
  while (cur) {
    const tag = cur.tagName.toLowerCase()
    if (UI_LANDMARK_TAGS.has(tag)) return 'landmark'
    if (tag === 'button' || cur.getAttribute('role') === 'button') return 'button'
    const role = cur.getAttribute('role')
    if (role && UI_LANDMARK_ROLES.has(role)) return role === 'tooltip' ? 'tooltip' : 'landmark'
    cur = cur.parentElement
  }
  return null
}

/** 主内容区(浮层启发式时排除,避免误伤正文) */
function isInMainContent(el: Element): boolean {
  return Boolean(el.closest('main, article, [role="main"]'))
}

/**
 * 无盒模型节点:<slot> 与 display:contents 本就没有尺寸,
 * 其可见性完全由投影/子节点决定,不能按 rect 判隐藏。
 */
function generatesNoBox(el: Element, display: string): boolean {
  return display === 'contents' || el.tagName === 'SLOT'
}

/** composed 子树的可见文本长度(含 shadow / slot 投影),用于零尺寸判定 */
function composedTextLength(el: Element, cap = 8): number {
  let len = (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
  if (len >= cap) return len
  if (el.tagName === 'SLOT') {
    for (const node of (el as HTMLSlotElement).assignedNodes({ flatten: true })) {
      len += (node.textContent ?? '').replace(/\s+/g, ' ').trim().length
      if (len >= cap) return len
    }
    return len
  }
  const sr = openShadow(el)
  if (sr) len += (sr.textContent ?? '').replace(/\s+/g, ' ').trim().length
  return len
}

/** 隐藏态细分 reason；未隐藏返回 null */
function hiddenSkipReason(el: Element): string | null {
  if (el instanceof HTMLElement && el.hidden) return 'hidden-attr'
  if (el.getAttribute('aria-hidden') === 'true') return 'aria-hidden'

  const style = window.getComputedStyle(el)
  if (style.display === 'none') return 'display'
  if (style.visibility === 'hidden') return 'visibility'

  // 无盒节点: opacity / rect 对其无意义,交给子节点判定
  if (generatesNoBox(el, style.display)) return null

  if (style.opacity === '0' || Number.parseFloat(style.opacity) === 0) return 'opacity'
  if (style.contentVisibility === 'hidden') return 'content-visibility'

  // 零尺寸:仅无可用文本时跳过(虚拟列表占位常有文本但 rect=0)
  const rect = el.getBoundingClientRect()
  if (rect.width <= 1 && rect.height <= 1) {
    if (composedTextLength(el) < 3) return 'zero-size'
  }

  return null
}

/**
 * main 外的小浮层 tip:需 tip 信号,避免误伤虚拟列表卡片。
 */
function isFloatingChrome(el: Element): boolean {
  if (isInMainContent(el)) return false
  const style = window.getComputedStyle(el)
  const pos = style.position
  if (pos !== 'absolute' && pos !== 'fixed') return false

  if (el.getAttribute('role') === 'tooltip') return true
  if (style.pointerEvents === 'none') return true
  const rect = el.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0 && rect.width < 80 && rect.height < 80) return true
  return false
}

function isDebug(): boolean {
  return isTsDebug()
}

let skipLogCount = 0
const SKIP_LOG_MAX = 120
/** reason -> count（含未逐条打印的） */
const skipReasonCounts = new Map<string, number>()
let emitRejectCounts = new Map<string, number>()
let suspiciousFloatingLogCount = 0
const SUSPICIOUS_FLOATING_LOG_MAX = 8
let megaSegmentLogCount = 0
const MEGA_SEGMENT_LOG_MAX = 5
/** 超过该长度的行内片段视为「容器塌陷」,值得记录成因 */
const MEGA_SEGMENT_CHARS = 200

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** 简短元素标识,便于在日志里定位具体节点 */
function describeEl(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = Array.from(el.classList)
    .filter((c) => !c.startsWith('ts-'))
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join('')
  const testid = el.getAttribute('data-testid')
  const slot = el.getAttribute('slot')
  return `${tag}${id}${cls}${testid ? `[testid=${testid}]` : ''}${slot ? `[slot=${slot}]` : ''}`
}

/** 收集开始时重置跳过日志计数 */
export function resetSkipDebug(): void {
  skipLogCount = 0
  skipReasonCounts.clear()
  emitRejectCounts = new Map()
  suspiciousFloatingLogCount = 0
  megaSegmentLogCount = 0
  resetDebugSinkFlag()
  if (isDebug()) {
    tsInfo('[ts-debug] on — will log [ts-skip]/[ts-emit]/[ts-block] (localStorage.ts-debug=1)')
  } else {
    tsInfo('[ts-debug] off — localStorage.setItem("ts-debug","1") then re-translate for details')
  }
}

export function flushDebugSummary(blocks: TextBlock[]): void {
  if (!isDebug() && skipReasonCounts.size === 0) {
    // debug 关时仍打简要汇总,方便确认「收集到了什么」
    tsInfo(
      `[ts-summary] blocks=${blocks.length}` +
        ` samples=${blocks.slice(0, 5).map((b) => JSON.stringify(b.text.slice(0, 32))).join(' | ')}`
    )
    return
  }

  const skipParts = [...skipReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
  tsInfo(`[ts-summary] skipReasons: ${skipParts.join(', ') || '(none)'}`)

  const emitParts = [...emitRejectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
  if (emitParts.length > 0) {
    tsInfo(`[ts-summary] emitReject: ${emitParts.join(', ')}`)
  }

  tsInfo(`[ts-summary] collected=${blocks.length}`)
  blocks.slice(0, 15).forEach((b, i) => {
    const el = b.element
    const rect = el.getBoundingClientRect?.() ?? { top: 0, height: 0 }
    tsInfo(
      `[ts-block] #${i} top=${Math.round(rect.top)} h=${Math.round(rect.height)}` +
        ` inline=${b.inlineSegment} el=${describeEl(el)} text="${b.text.slice(0, 50)}"`
    )
  })
  if (blocks.length > 15) {
    tsInfo(`[ts-block] ... +${blocks.length - 15} more`)
  }
}

function sampleText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)
}

function shouldLogSkipDetail(el: Element): boolean {
  if (!isDebug()) return false
  if (skipLogCount >= SKIP_LOG_MAX) return false
  const t = sampleText(el)
  // 放宽: ≥6 且含字母即可
  if (t.length < 6) return false
  if (!/[a-zA-Z]/.test(t)) return false
  return true
}

function logSkip(el: Element, reason: string): void {
  bump(skipReasonCounts, reason)
  if (reason === 'floating') {
    logSuspiciousFloatingSkip(el)
  }
  if (!shouldLogSkipDetail(el)) return
  skipLogCount++
  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  tsInfo(
    `[ts-skip] reason=${reason} tag=${el.tagName.toLowerCase()} pos=${style.position}` +
      ` rect=${Math.round(rect.top)},${Math.round(rect.left)},${Math.round(rect.width)},${Math.round(rect.height)}` +
      ` inMain=${isInMainContent(el)} text="${sampleText(el)}"`
  )
}

function logSuspiciousFloatingSkip(el: Element): void {
  if (suspiciousFloatingLogCount >= SUSPICIOUS_FLOATING_LOG_MAX) return
  const text = sampleText(el)
  if (text.length < 20) return

  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const largePanel = rect.width >= 260 && rect.height >= 180
  if (!largePanel) return

  suspiciousFloatingLogCount++
  const role = el.getAttribute('role') || '-'
  const cls = Array.from(el.classList).slice(0, 5).join('.') || '-'
  tsWarn(
    `[ts-probe] possible-content-panel skipped as floating` +
      ` tag=${el.tagName.toLowerCase()} role=${role} pos=${style.position}` +
      ` rect=${Math.round(rect.top)},${Math.round(rect.left)},${Math.round(rect.width)},${Math.round(rect.height)}` +
      ` inMain=${isInMainContent(el)} class="${cls}" text="${text}"`
  )
}

function logEmitReject(kind: string, detail: string, el?: Element): void {
  bump(emitRejectCounts, kind)
  if (!isDebug()) return
  const text = el ? sampleText(el) : detail.slice(0, 50)
  if (text.length < 6 && detail.length < 6) return
  tsInfo(`[ts-emit] reject=${kind} ${detail}${el ? ` text="${text}"` : ''}`)
}

function shouldTranslateReason(text: string): string | null {
  const t = text.trim()
  if (t.length < 3) return 'too-short'
  if (t.length > 5000) return 'too-long'
  if (!/[a-zA-Z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\uac00-\ud7af]/.test(t)) {
    return 'no-letters'
  }
  if (/^https?:\/\/\S+$/i.test(t)) return 'url'
  const chineseChars = (t.match(/[\u4e00-\u9fff]/g) || []).length
  const totalChars = t.replace(/\s/g, '').length
  if (totalChars > 0 && chineseChars / totalChars > 0.5) return 'mostly-chinese'
  return null
}

/** 返回跳过原因；应翻译则 null(逻辑与原先 isIgnored 一致) */
function getSkipReason(el: Element): string | null {
  const tag = el.tagName.toLowerCase()
  if (IGNORE_TAGS.has(tag)) return 'ignore-tag'
  if (el.classList.contains('notranslate') || el.getAttribute('translate') === 'no') return 'notranslate'
  if (el.classList.contains('ts-translation')) return 'ts-translation'
  if (isExcluded(el)) return 'exclude'
  const landmark = landmarkSkipReason(el)
  if (landmark) return landmark
  const hidden = hiddenSkipReason(el)
  if (hidden) return hidden
  if (isFloatingChrome(el)) return 'floating'
  return null
}

function isIgnored(el: Element): boolean {
  const reason = getSkipReason(el)
  if (reason) {
    logSkip(el, reason)
    return true
  }
  return false
}

/** 过滤非法选择器后合并为一个逗号分隔的选择器串 */
export function buildSelector(selectors?: string[]): string | null {
  if (!selectors || selectors.length === 0) return null
  const valid = selectors.filter((s) => {
    const t = s.trim()
    if (!t) return false
    try {
      document.querySelector(t)
      return true
    } catch {
      return false
    }
  })
  return valid.length > 0 ? valid.map((s) => s.trim()).join(', ') : null
}

/** 去掉互相嵌套的元素,只保留最外层 */
function dedupeNested(els: Element[]): Element[] {
  return els.filter((el) => !els.some((other) => other !== el && other.contains(el)))
}

function getDisplay(el: Element): string {
  return window.getComputedStyle(el).display
}

function isFlexOrGridDisplay(display: string): boolean {
  return display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid'
}

/** 开放 ShadowRoot(闭包无法读取) */
function openShadow(el: Element): ShadowRoot | null {
  try {
    return el.shadowRoot
  } catch {
    return null
  }
}

/** 把 <slot> 替换为其投影内容,使 slot 本身不出现在遍历结果里 */
function flattenSlots(nodes: Node[]): Node[] {
  let hasSlot = false
  for (const n of nodes) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'SLOT') {
      hasSlot = true
      break
    }
  }
  if (!hasSlot) return nodes

  const out: Node[] = []
  for (const n of nodes) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'SLOT') {
      const slot = n as HTMLSlotElement
      const assigned = slot.assignedNodes({ flatten: true })
      if (assigned.length > 0) out.push(...assigned)
      else out.push(...flattenSlots(Array.from(slot.childNodes)))
      continue
    }
    out.push(n)
  }
  return out
}

/**
 * Composed Tree 子节点:进入 open shadow,并展平 <slot> 的投影内容。
 * slot 永不作为节点返回,避免把译文插进 fallback 位置而不渲染;
 * 同一节点只会出现在投影位置,不会 light/shadow 重复遍历。
 */
function composedChildren(node: Node): Node[] {
  if (node.nodeType !== Node.ELEMENT_NODE) return []
  const el = node as Element
  const sr = openShadow(el)
  const raw = sr ? Array.from(sr.childNodes) : Array.from(el.childNodes)
  return flattenSlots(raw)
}

/** Composed Tree 上的父节点(用于祖先链调试;翻译插入仍用真实 DOM parent) */
function composedParent(node: Node): Node | null {
  if (node instanceof Element && node.assignedSlot) return node.assignedSlot
  const parent = node.parentNode
  if (parent instanceof ShadowRoot) return parent.host
  return parent
}

/** CSS 格式化上下文 */
type LayoutCtx = 'block' | 'flex-row' | 'flex-col' | 'grid' | 'table' | 'inline'

function layoutCtx(el: Element): LayoutCtx {
  const d = getDisplay(el)
  if (d === 'flex' || d === 'inline-flex') {
    const dir = window.getComputedStyle(el).flexDirection
    return dir === 'column' || dir === 'column-reverse' ? 'flex-col' : 'flex-row'
  }
  if (d === 'grid' || d === 'inline-grid') return 'grid'
  if (d === 'table' || d.startsWith('table-')) return 'table'
  if (BLOCK_DISPLAYS.has(d)) return 'block'
  return 'inline'
}

/** 允许译文换行的宿主 display(真正的块级段落容器) */
const BLOCK_SAFE_DISPLAYS = new Set(['block', 'flow-root', 'list-item'])

function composedHasVisibleText(el: Element): boolean {
  for (const node of composedChildren(el)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) return true
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    if (child.classList.contains('ts-translation')) continue
    if (isIgnored(child)) continue
    if (getDisplay(child) === 'none') continue
    if (composedHasVisibleText(child)) return true
  }
  return false
}

/**
 * 子孙(composed)中是否存在含文本的块级结构。
 * flex/grid 子项的假 block(blockify)不计,只看其内部是否仍有真块级结构。
 */
function hasComposedBlockContent(el: Element): boolean {
  const cached = blockTextCache.get(el)
  if (cached !== undefined) return cached

  const parentCtx = layoutCtx(el)
  const parentIsFlexOrGrid = parentCtx === 'flex-row' || parentCtx === 'flex-col' || parentCtx === 'grid'
  let result = false

  for (const node of composedChildren(el)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    if (isIgnored(child)) continue
    const display = getDisplay(child)
    if (display === 'none') continue

    if (display === 'contents') {
      if (hasComposedBlockContent(child)) {
        result = true
        break
      }
      continue
    }

    if (parentIsFlexOrGrid) {
      if (hasComposedBlockContent(child)) {
        result = true
        break
      }
    } else if (BLOCK_DISPLAYS.has(display) && composedHasVisibleText(child)) {
      result = true
      break
    } else if (hasComposedBlockContent(child)) {
      result = true
      break
    }
  }

  blockTextCache.set(el, result)
  return result
}

/**
 * 是否应将 child 作为独立边界切开并递归(统一规则,无标签特判)。
 */
function shouldSplitChild(child: Element, parentCtx: LayoutCtx): boolean {
  const display = getDisplay(child)
  if (display === 'none') return false
  if (display === 'contents') return true

  // 行内外壳包着块格式化内容:透明下钻,避免巨型行内片段
  const shellWithBlocks = !BLOCK_DISPLAYS.has(display) && hasComposedBlockContent(child)

  switch (parentCtx) {
    case 'flex-row':
      // row 项被 blockify,不能靠 display 切开;有内部块结构才下钻
      return hasComposedBlockContent(child) || shellWithBlocks
    case 'flex-col':
    case 'grid':
    case 'table':
      // 纵向/格子项:有内容则进入,叶子处 emitWholeUnit
      return composedHasVisibleText(child) || hasComposedBlockContent(child) || shellWithBlocks
    case 'block':
      if (BLOCK_DISPLAYS.has(display)) return true
      return shellWithBlocks || hasComposedBlockContent(child)
    case 'inline':
      return shellWithBlocks || hasComposedBlockContent(child)
  }
}

/** 提取元素 composed 子树内可翻译纯文本(跳过忽略/译文;slot 只计投影一次) */
function extractText(root: Element): string {
  const parts: string[] = []

  const visit = (node: Node, isRoot: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim()
      if (t) parts.push(t)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (!isRoot) {
      if (el.classList.contains('ts-translation')) return
      if (isIgnored(el)) return
      if (getDisplay(el) === 'none') return
    }
    for (const child of composedChildren(el)) visit(child, false)
  }

  visit(root, true)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** 统计 open shadow host(自动选有文本的代表,无站点选择器) */
export function logShadowCensus(root: Document | Element = document): void {
  const scope: ParentNode = root instanceof Document ? root : root
  const tags = new Map<string, number>()
  let hosts = 0
  let sample: Element | null = null
  for (const el of scope.querySelectorAll('*')) {
    if (!openShadow(el)) continue
    hosts++
    const t = el.tagName.toLowerCase()
    tags.set(t, (tags.get(t) ?? 0) + 1)
    if (!sample) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length >= 12) sample = el
    }
  }
  const top = [...tags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  tsInfo(`[ts-shadow] hosts=${hosts}${top ? ` top=[${top}]` : ''}`)

  if (sample) {
    const kids = composedChildren(sample)
      .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
      .slice(0, 8)
      .map((c) => {
        const slot = c.getAttribute('slot')
        return `${c.tagName.toLowerCase()}:${getDisplay(c)}${slot ? `[slot=${slot}]` : ''}`
      })
      .join(', ')
    tsInfo(
      `[ts-shadow] sample=${sample.tagName.toLowerCase()} display=${getDisplay(sample)}` +
        ` shadow=${Boolean(openShadow(sample))} composedChildren=[${kids}]`
    )
  }
}

/**
 * 在 subtree 内挂载尚未观察的 open shadow(增量用;避免每次 mutation 全页扫描)。
 */
export function observeOpenShadowsInSubtree(
  root: Node,
  observer: MutationObserver,
  seen: WeakSet<ShadowRoot>
): number {
  let added = 0
  const visit = (el: Element): void => {
    const sr = openShadow(el)
    if (sr && !seen.has(sr)) {
      seen.add(sr)
      observer.observe(sr, { childList: true, subtree: true })
      added++
      for (const child of sr.querySelectorAll('*')) visit(child)
    }
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return 0
  }
  if (root.nodeType === Node.ELEMENT_NODE) {
    visit(root as Element)
    for (const el of (root as Element).querySelectorAll('*')) visit(el)
  } else {
    for (const el of (root as DocumentFragment).querySelectorAll('*')) visit(el)
  }
  return added
}

/** 兼容:从 document/element 全量挂载 open shadow */
export function observeOpenShadows(
  root: Document | Element,
  observer: MutationObserver,
  seen: WeakSet<ShadowRoot>
): number {
  const scope = root instanceof Document ? root.body : root
  if (!scope) return 0
  return observeOpenShadowsInSubtree(scope, observer, seen)
}

export function collectTextBlocks(root: Document | Element, rule?: SiteRule | null): TextBlock[] {
  blockTextCache = new WeakMap()
  resetSkipDebug()
  const blocks: TextBlock[] = []
  const rootEl = root instanceof Document ? root.body : root
  if (!rootEl) return blocks

  excludeSelector = rule ? buildSelector(rule.excludes) : null
  try {
    if (rule?.mode === 'include') {
      const includeSel = buildSelector(rule.includes)
      if (includeSel) {
        const matched = Array.from(rootEl.querySelectorAll(includeSel))
        if (rootEl.matches?.(includeSel)) matched.unshift(rootEl)
        const roots = dedupeNested(matched)
        if (roots.length > 0) {
          for (const r of roots) walk(r, blocks)
          flushDebugSummary(blocks)
          return blocks
        }
      }
      // include 未命中任何元素:降级为整页翻译,避免规则过期导致完全不翻译
    }
    walk(rootEl, blocks)
    flushDebugSummary(blocks)
    return blocks
  } finally {
    excludeSelector = null
  }
}

function walk(el: Element, out: TextBlock[], inheritedCtx?: LayoutCtx): void {
  if (isIgnored(el)) return

  const display = getDisplay(el)
  // display:contents 不建立格式化上下文,沿用父级上下文判断子节点边界
  const transparent = generatesNoBox(el, display)
  const ctx: LayoutCtx = transparent ? (inheritedCtx ?? 'block') : layoutCtx(el)

  // 最小单元:composed 子树内不再有块级结构
  if (!hasComposedBlockContent(el)) {
    emitWholeUnit(el, out)
    return
  }

  let segment: Node[] = []
  const flush = () => {
    if (segment.length > 0) {
      emitSegment(el, segment, out)
      segment = []
    }
  }

  for (const node of composedChildren(el)) {
    if (node.nodeType === Node.TEXT_NODE) {
      segment.push(node)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    if (child.classList.contains('ts-translation')) continue
    if (isIgnored(child)) continue

    if (shouldSplitChild(child, ctx)) {
      flush()
      walk(child, out, ctx)
    } else {
      segment.push(child)
    }
  }
  flush()
}

function slotNameFor(node: Node): string | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).getAttribute('slot')
  }
  const pe = node.parentElement
  return pe ? pe.getAttribute('slot') : null
}

function emitWholeUnit(el: Element, out: TextBlock[]): void {
  if (processed.has(el)) {
    logEmitReject('processed', 'already processed', el)
    return
  }
  if (el.querySelector(':scope > .ts-translation')) {
    logEmitReject('has-translation', 'already has .ts-translation child', el)
    return
  }

  const text = extractText(el)
  const why = shouldTranslateReason(text)
  if (why) {
    logEmitReject(`shouldTranslate:${why}`, `len=${text.length}`, el)
    return
  }

  processed.add(el)
  out.push({
    id: `blk-${++blockCounter}`,
    element: el,
    anchor: el,
    inlineSegment: false,
    text,
    slotName: slotNameFor(el),
  })
}

/**
 * 巨型行内片段检测(异常日志,不是修复规则)。
 */
function logMegaSegment(container: Element, nodes: Node[], text: string): void {
  if (megaSegmentLogCount >= MEGA_SEGMENT_LOG_MAX) return
  megaSegmentLogCount++

  const display = getDisplay(container)
  const ctx = layoutCtx(container)
  const rect = container.getBoundingClientRect()
  tsWarn(
    `[ts-mega] len=${text.length} nodes=${nodes.length} container=${describeEl(container)}` +
      ` display=${display} ctx=${ctx} rect=${Math.round(rect.width)}x${Math.round(rect.height)}`
  )

  const kids = composedChildren(container)
    .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
    .slice(0, 14)
    .map((c) => {
      const d = getDisplay(c)
      const skip = getSkipReason(c)
      let verdict: string
      if (skip) verdict = `skip:${skip}`
      else if (shouldSplitChild(c, ctx)) verdict = 'split'
      else verdict = `merge:${d}`
      return `${describeEl(c)}:${d}=>${verdict}`
    })
  tsWarn(`[ts-mega] composedChildren=[${kids.join(' | ')}]`)

  const chain: string[] = []
  let cur: Node | null = composedParent(container)
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      chain.push(`${describeEl(cur as Element)}:${getDisplay(cur as Element)}`)
    }
    cur = composedParent(cur)
  }
  tsWarn(`[ts-mega] ancestors=[${chain.join(' < ')}]`)
}

function emitSegment(container: Element, nodes: Node[], out: TextBlock[]): void {
  const last = nodes[nodes.length - 1]
  if (processed.has(last)) {
    logEmitReject('processed', 'segment already processed', container)
    return
  }

  const texts = nodes.map((n) =>
    n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '') : extractText(n as Element)
  )
  const text = texts.join(' ').replace(/\s+/g, ' ').trim()
  const why = shouldTranslateReason(text)
  if (why) {
    logEmitReject(`shouldTranslate:${why}`, `len=${text.length} text="${text.slice(0, 40)}"`, container)
    return
  }

  if (text.length >= MEGA_SEGMENT_CHARS) {
    logMegaSegment(container, nodes, text)
  }

  let next = last.nextSibling
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent?.trim()) {
    next = next.nextSibling
  }
  if (next && next.nodeType === Node.ELEMENT_NODE && (next as Element).classList.contains('ts-translation')) {
    logEmitReject('has-translation', 'next sibling is translation', container)
    return
  }

  processed.add(last)
  out.push({
    id: `blk-${++blockCounter}`,
    element: container,
    anchor: last,
    inlineSegment: true,
    text,
    slotName: slotNameFor(last),
  })
}

/** 翻译失败时解除标记,允许下次重试 */
export function markUnprocessed(block: TextBlock): void {
  processed.delete(block.anchor)
}

const BLOCK_HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li'])
type ParentLayoutKind = 'block' | 'flex' | 'grid' | 'table' | 'other'

function anchorElement(block: TextBlock): Element | null {
  const a = block.anchor
  if (a.nodeType === Node.ELEMENT_NODE) return a as Element
  return a.parentElement
}

function parentLayoutKind(el: Element): ParentLayoutKind {
  const display = getDisplay(el)
  if (display === 'flex' || display === 'inline-flex') return 'flex'
  if (display === 'grid' || display === 'inline-grid') return 'grid'
  if (display === 'table' || display === 'table-cell' || display.startsWith('table-')) return 'table'
  if (BLOCK_SAFE_DISPLAYS.has(display) || display === 'table-cell') return 'block'
  return 'other'
}

/** grid 子项是否占整行(如 Upwork 的 span-12 / 标题) */
function isGridFullRowItem(el: Element): boolean {
  const parent = el.parentElement
  if (!parent) return false
  const pd = getDisplay(parent)
  if (pd !== 'grid' && pd !== 'inline-grid') return false
  if (/\bspan-\d+\b/.test(el.className)) return true
  return BLOCK_HEADING_TAGS.has(el.tagName.toLowerCase())
}

/** 从锚点复制 grid 列宽 class(如 span-12) */
function copyGridSpanClasses(transEl: HTMLElement, anchor: Element): void {
  for (const cls of anchor.classList) {
    if (/^span-\d+$/.test(cls) || /^col-\d+$/.test(cls)) {
      transEl.classList.add(cls)
    }
  }
}

/** 仅在会拆散横排时强制 inline; 单元格/块级整单元走下方对照(沉浸式) */
function shouldRenderInline(block: TextBlock): boolean {
  const anchorEl = anchorElement(block)

  // 标题、段落、grid 整行项: block 放下方,与原文同宽
  if (anchorEl) {
    if (BLOCK_HEADING_TAGS.has(anchorEl.tagName.toLowerCase())) return false
    if (isGridFullRowItem(anchorEl)) return false
  }

  if (block.inlineSegment) return true

  const el = block.element
  const display = getDisplay(el)
  const parent = el.parentElement

  // flex column: 译文可作为下一行 flex item(ts-block-row)
  if (parent) {
    const pCtx = layoutCtx(parent)
    if (pCtx === 'flex-col') return false
    if (pCtx === 'flex-row') return true
    if (pCtx === 'grid') {
      // 非整行 grid item 保持 inline,避免打乱列
      if (!isGridFullRowItem(el) && !BLOCK_HEADING_TAGS.has(el.tagName.toLowerCase())) return true
    }
  }

  // 自身是 flex/grid 容器:追加 block 子项可能拆布局 → inline
  if (isFlexOrGridDisplay(display)) return true

  // 块级段落、表格单元格、或单元格内的整单元: 译文放下方
  if (BLOCK_SAFE_DISPLAYS.has(display) || display === 'table-cell') return false
  if (parent && getDisplay(parent) === 'table-cell') return false

  return true
}

/** 取原文主文本节点的计算样式,使译文视觉与原文一致 */
function styleSampleFor(block: TextBlock): Element {
  const root = block.inlineSegment
    ? (block.anchor.nodeType === Node.ELEMENT_NODE
        ? (block.anchor as Element)
        : block.anchor.parentElement)
    : block.element
  if (!root) return block.element

  // 优先用第一个可见链接/强调文本(如标题 <a>),避免继承到父级默认色
  const preferred = root.querySelector('a, b, strong, em, h1, h2, h3, h4, h5, h6')
  if (preferred && !isIgnored(preferred)) return preferred
  return root instanceof Element ? root : block.element
}

function applyMatchedStyles(transEl: HTMLElement, sample: Element): void {
  const cs = window.getComputedStyle(sample)
  transEl.style.color = cs.color
  transEl.style.fontSize = cs.fontSize
  transEl.style.fontWeight = cs.fontWeight
  transEl.style.fontFamily = cs.fontFamily
  transEl.style.lineHeight = cs.lineHeight
  transEl.style.letterSpacing = cs.letterSpacing
}

/** 沉浸式双语对照:块级/单元格译文在下方,仅横排片段跟在原文后 */
export function renderTranslation(block: TextBlock, translation: string): void {
  const { element, anchor, inlineSegment } = block
  if (!element.isConnected) return

  const useInline = shouldRenderInline(block)
  const layoutKind = !useInline ? parentLayoutKind(element) : 'other'

  // 样式注入到实际插入根(document 或 open ShadowRoot)
  const styleHost: Node =
    inlineSegment ? (anchor.parentNode ?? element)
      : (!useInline && layoutKind === 'flex' ? (element.parentNode ?? element) : element)
  const styleRoot = styleHost.getRootNode()
  if (styleRoot instanceof ShadowRoot) injectStyles(styleRoot)
  else injectStyles()

  const transEl = document.createElement('span')
  transEl.className = useInline ? 'ts-translation ts-inline' : 'ts-translation ts-block'
  transEl.appendChild(document.createTextNode(translation))
  applyMatchedStyles(transEl, styleSampleFor(block))

  const slotName = block.slotName ?? (anchor.nodeType === Node.ELEMENT_NODE
    ? (anchor as Element).getAttribute('slot')
    : null)
  if (slotName != null && slotName !== '') {
    transEl.setAttribute('slot', slotName)
  }

  translationSourceMap.set(transEl, element)

  const btn = document.createElement('button')
  btn.className = 'ts-exclude-btn'
  btn.textContent = '不再翻译'
  btn.setAttribute('data-ts-exclude', '')
  transEl.appendChild(btn)

  const anchorEl = anchorElement(block)
  if (!useInline && layoutKind === 'flex') {
    transEl.classList.add('ts-block-row')
  }
  if (!useInline && anchorEl && layoutKind === 'grid') {
    copyGridSpanClasses(transEl, anchorEl)
  }

  if (inlineSegment) {
    anchor.parentNode?.insertBefore(transEl, anchor.nextSibling)
  } else if (!useInline && layoutKind === 'flex') {
    element.insertAdjacentElement('afterend', transEl)
  } else {
    element.appendChild(transEl)
  }
}

/** 译文 span → 对应的原始页面元素 */
export const translationSourceMap = new WeakMap<Element, Element>()

function removeTranslationsDeep(root: ParentNode): void {
  root.querySelectorAll?.('.ts-translation').forEach((el) => el.remove())
  const all = root.querySelectorAll?.('*') ?? []
  for (const el of all) {
    const sr = openShadow(el)
    if (sr) removeTranslationsDeep(sr)
  }
}

export function removeTranslations(root: Document | Element): void {
  const scope: ParentNode = root instanceof Document ? root : root
  removeTranslationsDeep(scope)
  processed = new WeakSet()
}

const STYLE_ID = 'ts-style'

const TRANSLATION_CSS = `
    .ts-translation {
      font: inherit;
      font-size: inherit;
      font-weight: inherit;
      font-family: inherit;
      line-height: inherit;
      letter-spacing: inherit;
      color: inherit;
      word-break: normal;
      overflow-wrap: break-word;
      unicode-bidi: normal;
      position: relative;
    }
    .ts-translation.ts-block {
      display: block;
      margin-top: 2px;
      box-sizing: border-box;
    }
    .ts-translation.ts-block-row {
      width: 100%;
      min-width: 0;
      flex: 0 0 100%;
    }
    .ts-translation.ts-inline {
      display: inline;
      margin-left: 8px;
    }
    .ts-exclude-btn {
      display: none;
      position: absolute;
      top: -2px;
      right: 0;
      z-index: 2147483647;
      padding: 2px 6px;
      font-size: 11px;
      line-height: 1.4;
      font-family: system-ui, sans-serif;
      color: #fff;
      background: rgba(0,0,0,0.72);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      pointer-events: auto;
    }
    .ts-translation:hover .ts-exclude-btn {
      display: inline-block;
    }
    .ts-exclude-btn:hover {
      background: rgba(220,38,38,0.85);
    }
    .ts-exclude-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      padding: 8px 16px;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      color: #fff;
      background: rgba(0,0,0,0.78);
      border-radius: 6px;
      pointer-events: none;
      animation: ts-toast-fade 2s ease forwards;
    }
    @keyframes ts-toast-fade {
      0%,70% { opacity: 1; }
      100% { opacity: 0; }
    }
  `

/** 注入样式到 document 或 open ShadowRoot(shadow 内样式不继承页面) */
export function injectStyles(target: Document | ShadowRoot = document): void {
  const css = TRANSLATION_CSS
  if (target instanceof ShadowRoot) {
    let style = target.querySelector(`#${STYLE_ID}`) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      target.appendChild(style)
    }
    style.textContent = css
    return
  }
  let style = target.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = target.createElement('style')
    style.id = STYLE_ID
    target.head.appendChild(style)
  }
  style.textContent = css
}

/**
 * 为元素生成一个尽量稳定的 CSS 选择器。
 * 策略：#id > tag.stableClasses > 向上寻找稳定祖先 > nth-of-type 兜底
 */
export function generateSelector(el: Element): string | null {
  const sel = buildSelectorForElement(el)
  if (!sel) return null
  try {
    if (document.querySelector(sel)) return sel
  } catch { /* invalid */ }
  return null
}

function parentSelector(el: Element): string | null {
  if (el.id && !/\d{4,}/.test(el.id) && !el.id.startsWith('ts-')) {
    return `#${CSS.escape(el.id)}`
  }
  const tag = el.tagName.toLowerCase()
  const stableClasses = Array.from(el.classList).filter(isStableClass)
  if (stableClasses.length > 0) {
    const sel = tag + stableClasses.slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('')
    try {
      if (document.querySelectorAll(sel).length <= 5) return sel
    } catch { /* fallthrough */ }
  }
  return null
}

function isStableClass(cls: string): boolean {
  if (cls.startsWith('ts-')) return false
  // 过滤看起来像动态 hash 的类名（含连续数字/hex 尾缀）
  if (/[-_][a-f0-9]{5,}$/i.test(cls)) return false
  if (/^[a-z]+-[A-Za-z0-9_]{8,}$/.test(cls)) return false
  return true
}

function buildSelectorForElement(el: Element): string | null {
  // 有 id 且不含动态特征
  if (el.id && !/\d{4,}/.test(el.id) && !el.id.startsWith('ts-')) {
    return `#${CSS.escape(el.id)}`
  }

  const tag = el.tagName.toLowerCase()
  const stableClasses = Array.from(el.classList).filter(isStableClass)

  if (stableClasses.length > 0) {
    const sel = tag + stableClasses.map((c) => `.${CSS.escape(c)}`).join('')
    // 如果选择器足够具体（命中少量元素），直接用
    try {
      if (document.querySelectorAll(sel).length <= 10) return sel
    } catch { /* fallthrough */ }
  }

  // 向上找一层有 id 或稳定 class 的祖先
  const parent = el.parentElement
  if (parent) {
    const parentSel = parentSelector(parent)
    if (parentSel) {
      const childPart = tag + (stableClasses.length > 0 ? stableClasses.slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('') : '')
      const combined = `${parentSel} > ${childPart}`
      try {
        const hits = document.querySelectorAll(combined).length
        if (hits >= 1 && hits <= 10) return combined
      } catch { /* fallthrough */ }

      // nth-of-type 兜底
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1
        const nthSel = `${parentSel} > ${tag}:nth-of-type(${idx})`
        try {
          if (document.querySelector(nthSel) === el) return nthSel
        } catch { /* fallthrough */ }
      }
    }
  }

  // 最后兜底：tag + nth-of-type from parent
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
    const idx = siblings.indexOf(el) + 1
    const pTag = parent.tagName.toLowerCase()
    const pClasses = Array.from(parent.classList).filter(isStableClass).slice(0, 2)
    const pSel = pClasses.length > 0 ? pTag + pClasses.map((c) => `.${CSS.escape(c)}`).join('') : pTag
    return `${pSel} > ${tag}:nth-of-type(${idx})`
  }

  return tag
}
