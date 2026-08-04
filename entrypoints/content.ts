import { defineContentScript } from 'wxt/utils/define-content-script'
import { getConfig, updateConfig } from '../utils/storage'
import { collectTextBlocks, renderTranslation, removeTranslations, injectStyles, markUnprocessed, translationSourceMap, generateSelector, logShadowCensus, observeOpenShadows, observeOpenShadowsInSubtree } from '../utils/dom'
import { extractPageOutline } from '../utils/outline'
import { previewRule, clearPreview } from '../utils/preview'
import { tsInfo } from '../utils/debugLog'
import type { SiteRule } from '../utils/translate/types'

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    start()
  },
})

let isTranslating = false
let siteRule: SiteRule | null = null
let observer: MutationObserver | null = null
let observedShadows = new WeakSet<ShadowRoot>()
let translateInProgress = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingMutations = false
let historyPatched = false
let scrollWatchAttached = false

function getTranslationState(): { translated: boolean; translating: boolean } {
  return {
    translated: document.querySelector('.ts-translation') !== null,
    translating: translateInProgress || isTranslating,
  }
}

function start(): void {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['translate-simple-config']) {
      onConfigChange()
    }
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'toggleTranslate') {
      if (document.querySelector('.ts-translation')) {
        stopTranslation()
      } else {
        translateOnce()
      }
      sendResponse({ ok: true })
    } else if (message.type === 'translateOnce') {
      translateOnce()
      sendResponse({ ok: true })
    } else if (message.type === 'alwaysTranslate') {
      onConfigChange()
      sendResponse({ ok: true })
    } else if (message.type === 'getTranslationState') {
      sendResponse(getTranslationState())
    } else if (message.type === 'removeTranslations') {
      stopTranslation()
      sendResponse({ ok: true })
    } else if (message.type === 'getPageOutline') {
      sendResponse({ outline: extractPageOutline(), title: document.title, hostname: location.hostname })
    } else if (message.type === 'previewRule') {
      const counts = previewRule(message.data?.includes ?? [], message.data?.excludes ?? [])
      sendResponse({ counts })
    } else if (message.type === 'clearPreview') {
      clearPreview()
      sendResponse({ ok: true })
    }
  })

  getConfig().then((config) => {
    const hostname = location.hostname
    siteRule = config.siteRules[hostname] ?? null
    if (config.siteList.includes(hostname)) {
      startTranslation()
    }
  })

  // 事件委托：点击排除按钮 → 生成选择器 → 写入站点规则
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element)?.closest?.('[data-ts-exclude]')
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    const transEl = btn.closest('.ts-translation')
    if (!transEl) return
    const sourceEl = translationSourceMap.get(transEl)
    if (!sourceEl) return
    const selector = generateSelector(sourceEl)
    if (!selector) return
    addExcludeRule(selector)
  }, true)
}

async function addExcludeRule(selector: string): Promise<void> {
  const config = await getConfig()
  const hostname = location.hostname
  const existing = config.siteRules[hostname]
  const rule = existing
    ? { ...existing, excludes: [...existing.excludes.filter((s) => s !== selector), selector], updatedAt: Date.now() }
    : { mode: 'all' as const, includes: [] as string[], excludes: [selector], source: 'manual' as const, updatedAt: Date.now() }
  await updateConfig({ siteRules: { ...config.siteRules, [hostname]: rule } })
  showExcludeToast(selector)
}

function showExcludeToast(selector: string): void {
  const toast = document.createElement('div')
  toast.className = 'ts-exclude-toast'
  toast.textContent = `已排除: ${selector}`
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 2200)
}

async function translateText(text: string): Promise<string> {
  const config = await getConfig()
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'translate',
        data: {
          text,
          sourceLang: 'auto',
          targetLang: config.targetLang,
          engine: config.engine,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (response?.error) {
          reject(new Error(response.error))
        } else {
          resolve(response.text)
        }
      }
    )
  })
}

/** 收集未翻译的单元并增量翻译(已翻译的单元会被 collectTextBlocks 跳过) */
async function runTranslate(): Promise<void> {
  injectStyles()
  logShadowCensus(document)
  const blocks = collectTextBlocks(document, siteRule)
  tsInfo(`[ts-collect] blocks=${blocks.length}`)
  // 列出 top 最大的几个 block 的 top,便于对照「从哪张卡开始没有」
  const byTop = [...blocks]
    .map((b) => ({
      top: Math.round(b.element.getBoundingClientRect().top),
      text: b.text.slice(0, 40),
    }))
    .sort((a, b) => a.top - b.top)
  tsInfo(
    `[ts-collect] topRange=${byTop[0]?.top ?? '-'}..${byTop[byTop.length - 1]?.top ?? '-'}` +
      ` (vh=${window.innerHeight})`
  )
  byTop.slice(-5).forEach((b, i) => {
    tsInfo(`[ts-collect] last#${i} top=${b.top} text="${b.text}"`)
  })

  let translated = 0
  let failed = 0
  const CONCURRENCY = 6
  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const batch = blocks.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (block) => {
        try {
          const text = await translateText(block.text)
          renderTranslation(block, text)
        } catch (err) {
          markUnprocessed(block)
          throw err
        }
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled') translated++
      else failed++
    }
    tsInfo(
      `[ts-collect] batch ${Math.floor(i / CONCURRENCY) + 1}` +
        ` ok=${results.filter((r) => r.status === 'fulfilled').length}` +
        ` fail=${results.filter((r) => r.status === 'rejected').length}` +
        ` progress=${translated + failed}/${blocks.length}`
    )
  }
  tsInfo(`[ts-collect] done translated=${translated} failed=${failed}`)
}

async function translatePage(): Promise<void> {
  if (translateInProgress) return
  translateInProgress = true
  pendingMutations = false

  try {
    await runTranslate()
  } finally {
    translateInProgress = false
    if (pendingMutations && isTranslating) translatePage()
  }
}

async function translateOnce(): Promise<void> {
  if (translateInProgress) return
  translateInProgress = true
  pendingMutations = false

  try {
    await runTranslate()
    attachScrollWatch()
  } finally {
    translateInProgress = false
    if (pendingMutations && document.querySelector('.ts-translation')) {
      translateOnce()
    }
  }
}

/** 虚拟列表滚动不触发 mutation,需靠 scroll 增量收集 */
function onScrollRetranslate(): void {
  if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer)
  scrollDebounceTimer = setTimeout(() => {
    scrollDebounceTimer = null
    const hasTranslations = document.querySelector('.ts-translation') !== null
    if (!hasTranslations && !isTranslating) return
    if (translateInProgress) {
      pendingMutations = true
      return
    }
    if (isTranslating) {
      translatePage()
    } else {
      // 一次性翻译后的滚动补翻
      translateOnce()
    }
  }, 300)
}

function attachScrollWatch(): void {
  if (scrollWatchAttached) return
  scrollWatchAttached = true
  window.addEventListener('scroll', onScrollRetranslate, { passive: true, capture: true })
}

function detachScrollWatch(): void {
  if (!scrollWatchAttached) return
  scrollWatchAttached = false
  window.removeEventListener('scroll', onScrollRetranslate, true)
  if (scrollDebounceTimer) {
    clearTimeout(scrollDebounceTimer)
    scrollDebounceTimer = null
  }
}

function isOwnNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as Element
  return el.classList.contains('ts-translation') || el.classList.contains('ts-exclude-toast') || el.id === 'ts-style'
}

function isRelevantMutation(mutation: MutationRecord): boolean {
  const target = mutation.target
  if (target.nodeType === Node.ELEMENT_NODE) {
    const el = target as Element
    if (el.closest('.ts-translation')) return false
  }
  for (const node of mutation.addedNodes) {
    if (!isOwnNode(node)) return true
  }
  return false
}

function startTranslation(): void {
  if (isTranslating) return
  isTranslating = true

  injectStyles()
  translatePage()
  attachScrollWatch()

  window.addEventListener('popstate', onSPANavigate)
  if (!historyPatched) {
    historyPatched = true
    const origPushState = history.pushState
    history.pushState = function (...args) {
      origPushState.apply(this, args)
      setTimeout(() => onSPANavigate(), 500)
    }
    const origReplaceState = history.replaceState
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args)
      setTimeout(() => onSPANavigate(), 500)
    }
  }

  observer = new MutationObserver((mutations) => {
    if (!mutations.some(isRelevantMutation)) return
    // 仅扫描新增子树中的 open shadow,避免每次全页 querySelectorAll
    if (observer) {
      let added = 0
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          added += observeOpenShadowsInSubtree(node, observer, observedShadows)
        }
        // 目标节点自身也可能刚 attachShadow
        if (m.target.nodeType === Node.ELEMENT_NODE) {
          added += observeOpenShadowsInSubtree(m.target, observer, observedShadows)
        }
      }
      if (added > 0) tsInfo(`[ts-shadow] observe+${added}`)
    }
    if (translateInProgress) {
      pendingMutations = true
      return
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => translatePage(), 300)
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
  const initial = observeOpenShadows(document, observer, observedShadows)
  if (initial > 0) tsInfo(`[ts-shadow] observe initial=${initial}`)
}

function onSPANavigate(): void {
  if (!isTranslating) return
  removeTranslations(document)
  translatePage()
}

function stopTranslation(): void {
  isTranslating = false
  translateInProgress = false
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (observer) {
    observer.disconnect()
    observer = null
  }
  observedShadows = new WeakSet()
  detachScrollWatch()
  window.removeEventListener('popstate', onSPANavigate)
  removeTranslations(document)
}

async function onConfigChange(): Promise<void> {
  const config = await getConfig()

  const hostname = location.hostname
  const newRule = config.siteRules[hostname] ?? null
  const ruleChanged = JSON.stringify(newRule) !== JSON.stringify(siteRule)
  siteRule = newRule

  const shouldTranslate = config.siteList.includes(hostname)

  if (shouldTranslate && !isTranslating) {
    startTranslation()
  } else if (!shouldTranslate && isTranslating) {
    stopTranslation()
  } else if (shouldTranslate && isTranslating) {
    stopTranslation()
    startTranslation()
  } else if (ruleChanged && document.querySelector('.ts-translation')) {
    // 手动翻译过的页面:规则变化时按新规则重新翻译
    removeTranslations(document)
    translateOnce()
  }
}
