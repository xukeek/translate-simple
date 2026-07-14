import { defineBackground } from 'wxt/utils/define-background'
import { translate } from '../utils/translate'
import { TranslationCache } from '../utils/cache'
import { getConfig, updateConfig } from '../utils/storage'
import type { TranslateRequest } from '../utils/translate/types'

export default defineBackground({
  main() {
    const cache = new TranslationCache()

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'translate') {
        const req: TranslateRequest = message.data

        const cached = cache.get(req.text, req.sourceLang, req.targetLang, req.engine)
        if (cached) {
          sendResponse({ text: cached, from: req.sourceLang })
          return
        }

        translate(req)
          .then((result) => {
            cache.set(req.text, req.sourceLang, req.targetLang, req.engine, result.text)
            sendResponse({ text: result.text, from: result.from })
          })
          .catch((err) => {
            sendResponse({ error: err.message })
          })

        return true
      }
    })

    chrome.commands.onCommand.addListener(async (command) => {
      if (command === 'toggleTranslate') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'toggleTranslate' }).catch(() => {})
        }
      }
    })
  },
})
