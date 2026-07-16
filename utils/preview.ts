/**
 * 规则预览高亮:include 区域绿色描边,exclude 区域红色半透明遮罩。
 * 同时返回每个选择器的命中数量,供 AI 修正无效选择器。
 */

const PREVIEW_STYLE_ID = 'ts-preview-style'
const INCLUDE_CLASS = 'ts-preview-include'
const EXCLUDE_CLASS = 'ts-preview-exclude'

export interface SelectorCount {
  selector: string
  kind: 'include' | 'exclude'
  count: number
  valid: boolean
}

function injectPreviewStyles(): void {
  if (document.getElementById(PREVIEW_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PREVIEW_STYLE_ID
  style.textContent = `
    .${INCLUDE_CLASS} {
      outline: 2px solid #22c55e !important;
      outline-offset: -2px !important;
      background-color: rgba(34, 197, 94, 0.06) !important;
    }
    .${EXCLUDE_CLASS} {
      outline: 2px dashed #ef4444 !important;
      outline-offset: -2px !important;
      background-color: rgba(239, 68, 68, 0.12) !important;
    }
  `
  document.head.appendChild(style)
}

export function previewRule(includes: string[], excludes: string[]): SelectorCount[] {
  clearPreview()
  injectPreviewStyles()

  const counts: SelectorCount[] = []

  const apply = (selectors: string[], kind: 'include' | 'exclude', cls: string) => {
    for (const selector of selectors) {
      const s = selector.trim()
      if (!s) continue
      try {
        const els = document.querySelectorAll(s)
        els.forEach((el) => el.classList.add(cls))
        counts.push({ selector: s, kind, count: els.length, valid: true })
      } catch {
        counts.push({ selector: s, kind, count: 0, valid: false })
      }
    }
  }

  apply(includes, 'include', INCLUDE_CLASS)
  apply(excludes, 'exclude', EXCLUDE_CLASS)
  return counts
}

export function clearPreview(): void {
  document.querySelectorAll(`.${INCLUDE_CLASS}`).forEach((el) => el.classList.remove(INCLUDE_CLASS))
  document.querySelectorAll(`.${EXCLUDE_CLASS}`).forEach((el) => el.classList.remove(EXCLUDE_CLASS))
  document.getElementById(PREVIEW_STYLE_ID)?.remove()
}
