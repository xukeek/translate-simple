import type { DisplayMode } from './translate/types'

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'td', 'th', 'blockquote', 'section', 'article',
  'figcaption', 'dd', 'dt', 'caption',
])

const IGNORE_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'textarea',
  'select', 'option', 'svg', 'path', 'code', 'pre',
])

export interface TextBlock {
  id: string
  element: Node
  text: string
}

let blockCounter = 0

function findBlockParent(node: Node): Node | null {
  let current = node.parentNode
  while (current && current !== document.body && current !== document.documentElement) {
    const el = current as Element
    const tag = el.tagName.toLowerCase()

    if (IGNORE_TAGS.has(tag)) return null
    if (el.classList.contains('ts-translation') || el.classList.contains('ts-horizontal-wrapper')) return null

    if (BLOCK_TAGS.has(tag) && el.children.length > 0) {
      return current
    }
    if (tag === 'a' || tag === 'button' || tag === 'label') {
      return current
    }
    current = current.parentNode
  }
  return null
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    el.getBoundingClientRect().height > 0
  )
}

function shouldTranslate(text: string): boolean {
  const t = text.trim()
  if (t.length < 10 || t.length > 5000) return false

  const chineseChars = (t.match(/[\u4e00-\u9fff]/g) || []).length
  const totalChars = t.replace(/\s/g, '').length
  if (totalChars > 0 && chineseChars / totalChars > 0.5) return false

  return true
}

export function collectTextBlocks(root: Document | Element): TextBlock[] {
  const map = new Map<Node, string[]>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName.toLowerCase()
      if (IGNORE_TAGS.has(tag)) return NodeFilter.FILTER_REJECT
      if (parent.closest('.ts-translation, .ts-horizontal-wrapper')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const parent = findBlockParent(node)
    if (!parent) continue
    if (!isVisible(parent as Element)) continue

    const text = node.textContent?.trim()
    if (!text) continue

    if (!map.has(parent)) map.set(parent, [])
    map.get(parent)!.push(text)
  }

  const blocks: TextBlock[] = []
  for (const [element, texts] of map) {
    const combined = texts.join(' ').replace(/\s+/g, ' ')
    if (shouldTranslate(combined)) {
      blocks.push({
        id: `blk-${++blockCounter}`,
        element,
        text: combined,
      })
    }
  }

  return blocks
}

export function renderTranslation(
  block: TextBlock,
  translation: string,
  mode: DisplayMode
): void {
  const parent = block.element as Element
  if (parent.querySelector('.ts-translation')) return

  if (mode === 'vertical') {
    const transEl = document.createElement('div')
    transEl.className = 'ts-translation ts-vertical'
    transEl.textContent = translation
    parent.appendChild(transEl)
  } else {
    const wrapper = document.createElement('div')
    wrapper.className = 'ts-horizontal-wrapper'
    parent.parentNode?.insertBefore(wrapper, parent)
    wrapper.appendChild(parent)

    const transEl = document.createElement('div')
    transEl.className = 'ts-translation ts-horizontal'
    transEl.textContent = translation
    wrapper.appendChild(transEl)
  }
}

export function removeTranslations(root: Document | Element): void {
  root.querySelectorAll('.ts-translation, .ts-horizontal-wrapper').forEach((el) => {
    const wrapper = el.closest('.ts-horizontal-wrapper')
    if (wrapper) {
      const child = wrapper.firstElementChild
      if (child) {
        wrapper.parentNode?.insertBefore(child, wrapper)
      }
      wrapper.remove()
    } else {
      el.remove()
    }
  })
}

const STYLE_ID = 'ts-style'

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .ts-translation {
      font-size: inherit;
      line-height: 1.6;
      padding: 2px 0;
      color: #666;
    }
    .ts-translation.ts-vertical {
      display: block;
    }
    .ts-horizontal-wrapper {
      display: flex !important;
      gap: 12px;
    }
    .ts-horizontal-wrapper > * {
      flex: 1;
      min-width: 0;
    }
  `
  document.head.appendChild(style)
}
