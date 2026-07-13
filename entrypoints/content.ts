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

function start(): void {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['translate-simple-config']) {
      onConfigChange()
    }
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'toggle') {
      onConfigChange()
      sendResponse({ ok: true })
    }
  })

  onConfigChange()
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

  try {
    const blocks = collectTextBlocks(document)
    for (const block of blocks) {
      try {
        const translated = await translateText(block.text)
        renderTranslation(block, translated, displayMode)
      } catch {
      }
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

  observer = new MutationObserver((mutations) => {
    const hasNewContent = mutations.some((m) => {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element
          if (!el.closest('.ts-translation, .ts-horizontal-wrapper')) return true
        }
      }
      return false
    })
    if (hasNewContent) translatePage()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
}

function stopTranslation(): void {
  isTranslating = false
  translateInProgress = false
  if (observer) {
    observer.disconnect()
    observer = null
  }
  removeTranslations(document)
}

async function onConfigChange(): Promise<void> {
  const config = await getConfig()
  displayMode = config.displayMode

  if (config.enabled && !isTranslating) {
    startTranslation()
  } else if (!config.enabled && isTranslating) {
    stopTranslation()
  } else if (config.enabled && isTranslating) {
    stopTranslation()
    startTranslation()
  }
}


