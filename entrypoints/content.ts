import { defineContentScript } from 'wxt/utils/define-content-script'
import { getConfig } from '../utils/storage'
import { collectTextBlocks, renderTranslation, removeTranslations, injectStyles, markUnprocessed } from '../utils/dom'
import { extractPageOutline } from '../utils/outline'
import { previewRule, clearPreview } from '../utils/preview'
import type { DisplayMode, SiteRule } from '../utils/translate/types'

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    start()
  },
})

let isTranslating = false
let displayMode: DisplayMode = 'vertical'
let siteRule: SiteRule | null = null
let observer: MutationObserver | null = null
let translateInProgress = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingMutations = false
let historyPatched = false

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
      const translated = document.querySelector('.ts-translation') !== null
      sendResponse({ translated })
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
    displayMode = config.displayMode
    const hostname = location.hostname
    siteRule = config.siteRules[hostname] ?? null
    if (config.siteList.includes(hostname)) {
      startTranslation()
    }
  })
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
  const blocks = collectTextBlocks(document, siteRule)
  const CONCURRENCY = 6
  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const batch = blocks.slice(i, i + CONCURRENCY)
    await Promise.allSettled(
      batch.map(async (block) => {
        try {
          const translated = await translateText(block.text)
          renderTranslation(block, translated, displayMode)
        } catch (err) {
          markUnprocessed(block)
          throw err
        }
      })
    )
  }
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

  try {
    await runTranslate()
  } finally {
    translateInProgress = false
  }
}

function isOwnNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as Element
  return (
    el.classList.contains('ts-translation') ||
    el.classList.contains('ts-horizontal-wrapper') ||
    el.id === 'ts-style'
  )
}

function isRelevantMutation(mutation: MutationRecord): boolean {
  const target = mutation.target
  if (target.nodeType === Node.ELEMENT_NODE) {
    const el = target as Element
    if (el.closest('.ts-translation, .ts-horizontal-wrapper')) return false
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
  window.removeEventListener('popstate', onSPANavigate)
  removeTranslations(document)
}

async function onConfigChange(): Promise<void> {
  const config = await getConfig()
  displayMode = config.displayMode

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
