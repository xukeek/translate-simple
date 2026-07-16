import type { DisplayMode, SiteRule } from './translate/types'

const IGNORE_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'textarea', 'input',
  'select', 'option', 'svg', 'path', 'code', 'pre', 'kbd', 'samp',
  'template', 'canvas', 'video', 'audio', 'object', 'embed',
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
    return el.matches(excludeSelector)
  } catch {
    return false
  }
}

function isIgnored(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (IGNORE_TAGS.has(tag)) return true
  if (el.classList.contains('notranslate') || el.getAttribute('translate') === 'no') return true
  if (el.classList.contains('ts-translation')) return true
  if (isExcluded(el)) return true
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

function isBlockLike(el: Element): boolean {
  return BLOCK_DISPLAYS.has(getDisplay(el))
}

/** 子孙中是否存在含文本的块级元素(译文节点除外) */
function containsBlockWithText(el: Element): boolean {
  const cached = blockTextCache.get(el)
  if (cached !== undefined) return cached

  let result = false
  for (const child of el.children) {
    if (isIgnored(child)) continue
    const display = getDisplay(child)
    if (display === 'none') continue
    if (BLOCK_DISPLAYS.has(display) && (child.textContent?.trim().length ?? 0) > 0) {
      result = true
      break
    }
    if (containsBlockWithText(child)) {
      result = true
      break
    }
  }
  blockTextCache.set(el, result)
  return result
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 1 && rect.height > 1
}

/** 提取元素内可翻译的纯文本(跳过忽略标签、隐藏元素与已插入的译文) */
function extractText(root: Element): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT
      let cur = node.parentElement
      while (cur && cur !== root) {
        if (isIgnored(cur) || getDisplay(cur) === 'none') return NodeFilter.FILTER_REJECT
        cur = cur.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode()) {
    parts.push(walker.currentNode.textContent!.trim())
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function shouldTranslate(text: string): boolean {
  const t = text.trim()
  if (t.length < 3 || t.length > 5000) return false
  // 必须包含字母类字符(排除纯数字/符号/时间)
  if (!/[a-zA-Z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\uac00-\ud7af]/.test(t)) return false
  if (/^https?:\/\/\S+$/i.test(t)) return false

  const chineseChars = (t.match(/[\u4e00-\u9fff]/g) || []).length
  const totalChars = t.replace(/\s/g, '').length
  if (totalChars > 0 && chineseChars / totalChars > 0.5) return false

  return true
}

export function collectTextBlocks(root: Document | Element, rule?: SiteRule | null): TextBlock[] {
  blockTextCache = new WeakMap()
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
          return blocks
        }
      }
      // include 未命中任何元素:降级为整页翻译,避免规则过期导致完全不翻译
    }
    walk(rootEl, blocks)
    return blocks
  } finally {
    excludeSelector = null
  }
}

function walk(el: Element, out: TextBlock[]): void {
  if (isIgnored(el)) return
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return

  // 最小块级容器:内部不再有含文本的块级元素,整体作为一个翻译单元
  if (!containsBlockWithText(el)) {
    emitWholeUnit(el, out)
    return
  }

  // 混合容器:块级子元素递归,连续的行内节点合并为一个片段
  let segment: Node[] = []
  const flush = () => {
    if (segment.length > 0) {
      emitSegment(el, segment, out)
      segment = []
    }
  }

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      segment.push(node)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    if (isIgnored(child)) continue
    const display = getDisplay(child)
    if (display === 'none') continue
    if (BLOCK_DISPLAYS.has(display)) {
      flush()
      walk(child, out)
    } else {
      segment.push(child)
    }
  }
  flush()
}

function emitWholeUnit(el: Element, out: TextBlock[]): void {
  if (processed.has(el)) return
  if (el.querySelector(':scope > .ts-translation')) return
  if (!isVisible(el)) return

  const text = extractText(el)
  if (!shouldTranslate(text)) return

  processed.add(el)
  out.push({
    id: `blk-${++blockCounter}`,
    element: el,
    anchor: el,
    inlineSegment: false,
    text,
  })
}

function emitSegment(container: Element, nodes: Node[], out: TextBlock[]): void {
  const last = nodes[nodes.length - 1]
  if (processed.has(last)) return

  const texts = nodes.map((n) =>
    n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '') : extractText(n as Element)
  )
  const text = texts.join(' ').replace(/\s+/g, ' ').trim()
  if (!shouldTranslate(text)) return

  // 片段之后紧跟的已是译文节点则跳过
  let next = last.nextSibling
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent?.trim()) {
    next = next.nextSibling
  }
  if (next && next.nodeType === Node.ELEMENT_NODE && (next as Element).classList.contains('ts-translation')) {
    return
  }

  processed.add(last)
  out.push({
    id: `blk-${++blockCounter}`,
    element: container,
    anchor: last,
    inlineSegment: true,
    text,
  })
}

/** 翻译失败时解除标记,允许下次重试 */
export function markUnprocessed(block: TextBlock): void {
  processed.delete(block.anchor)
}

// 译文很短时同行内联显示,否则换行块级显示
const INLINE_TEXT_LIMIT = 24

function canWrapHorizontal(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (['td', 'th', 'tr', 'table', 'li', 'caption', 'dt', 'dd'].includes(tag)) return false
  const display = getDisplay(el)
  if (display !== 'block' && display !== 'flow-root') return false
  const parent = el.parentElement
  if (parent) {
    const pd = getDisplay(parent)
    if (pd.startsWith('table') || pd === 'flex' || pd === 'grid') return false
  }
  return true
}

export function renderTranslation(
  block: TextBlock,
  translation: string,
  mode: DisplayMode
): void {
  const { element, anchor, inlineSegment } = block
  if (!element.isConnected) return

  // 双栏对照模式:仅对真正的块级、非表格/弹性布局上下文启用
  if (mode === 'horizontal' && !inlineSegment && canWrapHorizontal(element)) {
    const wrapper = document.createElement('div')
    wrapper.className = 'ts-horizontal-wrapper'
    element.parentNode?.insertBefore(wrapper, element)
    wrapper.appendChild(element)

    const transEl = document.createElement('div')
    transEl.className = 'ts-translation ts-horizontal'
    transEl.textContent = translation
    wrapper.appendChild(transEl)
    return
  }

  const transEl = document.createElement('span')
  const inline = translation.length <= INLINE_TEXT_LIMIT && block.text.length <= INLINE_TEXT_LIMIT
  transEl.className = inline ? 'ts-translation ts-inline' : 'ts-translation ts-block'
  transEl.textContent = translation

  if (inlineSegment) {
    anchor.parentNode?.insertBefore(transEl, anchor.nextSibling)
  } else {
    element.appendChild(transEl)
  }
}

export function removeTranslations(root: Document | Element): void {
  root.querySelectorAll('.ts-translation').forEach((el) => el.remove())
  root.querySelectorAll('.ts-horizontal-wrapper').forEach((wrapper) => {
    const child = wrapper.firstElementChild
    if (child) {
      wrapper.parentNode?.insertBefore(child, wrapper)
    }
    wrapper.remove()
  })
  processed = new WeakSet()
}

const STYLE_ID = 'ts-style'

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .ts-translation {
      font-size: inherit;
      font-weight: inherit;
      line-height: inherit;
      color: inherit;
      opacity: 0.75;
      word-break: break-word;
      overflow-wrap: break-word;
      unicode-bidi: normal;
    }
    .ts-translation.ts-block {
      display: block;
      margin-top: 2px;
    }
    .ts-translation.ts-inline {
      display: inline;
      margin-left: 8px;
    }
    .ts-horizontal-wrapper {
      display: flex !important;
      gap: 12px;
      box-sizing: border-box;
    }
    .ts-horizontal-wrapper > * {
      flex: 1;
      min-width: 0;
    }
  `
  document.head.appendChild(style)
}
