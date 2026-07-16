/**
 * 页面结构摘要提取:把 DOM 压缩成 AI 可读的骨架文本(控制在几 KB 内),
 * 供 AI 分析"哪些区域是正文、哪些是导航/侧栏"并生成选择器规则。
 */

const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe',
  'canvas', 'video', 'audio', 'object', 'embed', 'link', 'meta', 'br', 'hr',
])

const MAX_DEPTH = 5
const MAX_LINES = 160
const TEXT_SAMPLE_LEN = 60
const MAX_CLASSES = 3

interface NodeInfo {
  descriptor: string
  textLength: number
  linkTextLength: number
  sample: string
}

function isElementVisible(el: Element): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 1 && rect.height > 1
}

/** 元素的选择器描述:tag#id.cls1.cls2 [role] [aria-label] */
function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  let desc = tag
  if (el.id) desc += `#${el.id}`
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith('ts-'))
    .slice(0, MAX_CLASSES)
  if (classes.length > 0) desc += '.' + classes.join('.')
  const role = el.getAttribute('role')
  if (role) desc += ` [role=${role}]`
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) desc += ` [aria-label=${ariaLabel.slice(0, 30)}]`
  return desc
}

function getInfo(el: Element): NodeInfo {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  let linkTextLength = 0
  el.querySelectorAll('a').forEach((a) => {
    linkTextLength += (a.textContent ?? '').replace(/\s+/g, ' ').trim().length
  })
  return {
    descriptor: describe(el),
    textLength: text.length,
    linkTextLength,
    sample: text.slice(0, TEXT_SAMPLE_LEN),
  }
}

/** 两个元素结构是否同构(用于折叠列表项) */
function isHomogeneous(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false
  const ca = Array.from(a.classList).filter((c) => !c.startsWith('ts-')).sort().join(' ')
  const cb = Array.from(b.classList).filter((c) => !c.startsWith('ts-')).sort().join(' ')
  return ca === cb
}

function walkOutline(el: Element, depth: number, lines: string[]): void {
  if (lines.length >= MAX_LINES) return
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return
  if (!isElementVisible(el)) return

  const info = getInfo(el)
  if (info.textLength === 0) return

  const indent = '  '.repeat(depth)
  const linkRatio = info.textLength > 0 ? info.linkTextLength / info.textLength : 0
  const meta: string[] = [`text=${info.textLength}`]
  if (linkRatio > 0.5) meta.push(`links=${Math.round(linkRatio * 100)}%`)

  let line = `${indent}${info.descriptor} (${meta.join(', ')})`
  if (info.sample && depth >= 1) line += ` "${info.sample}"`
  lines.push(line)

  if (depth >= MAX_DEPTH) return

  // 同构兄弟折叠:连续同类元素只展开第一个,标注 xN
  const children = Array.from(el.children).filter(
    (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()) && !c.classList.contains('ts-translation')
  )
  let i = 0
  while (i < children.length && lines.length < MAX_LINES) {
    const child = children[i]
    let count = 1
    while (i + count < children.length && isHomogeneous(child, children[i + count])) {
      count++
    }
    walkOutline(child, depth + 1, lines)
    if (count > 1 && lines.length > 0 && lines.length < MAX_LINES) {
      lines[lines.length - 1] += ` x${count}`
    }
    i += count
  }
}

export function extractPageOutline(): string {
  const lines: string[] = []
  walkOutline(document.body, 0, lines)
  return lines.join('\n')
}
