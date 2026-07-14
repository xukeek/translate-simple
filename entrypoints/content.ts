import { defineContentScript } from 'wxt/utils/define-content-script'
import { getConfig } from '../utils/storage'
import { collectTextBlocks, renderTranslation, removeTranslations, injectStyles } from '../utils/dom'
import type { DisplayMode } from '../utils/translate/types'

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    start()
  },
})

let isTranslating = false
let displayMode: DisplayMode = 'vertical'
let observer: MutationObserver | null = null
let translateInProgress = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingMutations = false

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
    }
  })

  getConfig().then((config) => {
    displayMode = config.displayMode
    const hostname = location.hostname
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

async function translatePage(): Promise<void> {
  if (translateInProgress) return
  translateInProgress = true
  pendingMutations = false

  try {
    const blocks = collectTextBlocks(document)
    const CONCURRENCY = 6
    for (let i = 0; i < blocks.length; i += CONCURRENCY) {
      const batch = blocks.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(async (block) => {
          const translated = await translateText(block.text)
          renderTranslation(block, translated, displayMode)
        })
      )
    }
  } finally {
    translateInProgress = false
    if (pendingMutations) translatePage()
  }
}

async function translateOnce(): Promise<void> {
  if (translateInProgress) return
  translateInProgress = true

  try {
    injectStyles()
    const blocks = collectTextBlocks(document)
    const CONCURRENCY = 6
    for (let i = 0; i < blocks.length; i += CONCURRENCY) {
      const batch = blocks.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(async (block) => {
          const translated = await translateText(block.text)
          renderTranslation(block, translated, displayMode)
        })
      )
    }
  } finally {
    translateInProgress = false
  }
}

function startTranslation(): void {
  if (isTranslating) return
  isTranslating = true

  injectStyles()
  translatePage()

  window.addEventListener('popstate', onSPANavigate)
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

  observer = new MutationObserver(() => {
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
  const shouldTranslate = config.siteList.includes(hostname)

  if (shouldTranslate && !isTranslating) {
    startTranslation()
  } else if (!shouldTranslate && isTranslating) {
    stopTranslation()
  } else if (shouldTranslate && isTranslating) {
    stopTranslation()
    startTranslation()
  }
}
