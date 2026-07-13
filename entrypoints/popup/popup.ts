import { getConfig, setConfig, updateConfig } from '../../utils/storage'
import type { EngineId, DisplayMode } from '../../utils/translate/types'

async function init(): Promise<void> {
  const config = await getConfig()

  const toggle = document.getElementById('toggle') as HTMLInputElement
  const engine = document.getElementById('engine') as HTMLSelectElement
  const targetLang = document.getElementById('targetLang') as HTMLSelectElement
  const displayRadios = document.querySelectorAll<HTMLInputElement>('input[name="displayMode"]')
  const optionsLink = document.getElementById('openOptions')

  toggle.checked = config.enabled
  engine.value = config.engine
  targetLang.value = config.targetLang

  for (const radio of displayRadios) {
    if (radio.value === config.displayMode) radio.checked = true
  }

  toggle.addEventListener('change', async () => {
    await updateConfig({ enabled: toggle.checked })
    notifyActiveTab()
  })

  engine.addEventListener('change', async () => {
    await updateConfig({ engine: engine.value as EngineId })
    notifyActiveTab()
  })

  targetLang.addEventListener('change', async () => {
    await updateConfig({ targetLang: targetLang.value })
    notifyActiveTab()
  })

  for (const radio of displayRadios) {
    radio.addEventListener('change', async () => {
      await updateConfig({ displayMode: radio.value as DisplayMode })
      notifyActiveTab()
    })
  }

  optionsLink?.addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.openOptionsPage()
  })
}

async function notifyActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {})
  }
}

document.addEventListener('DOMContentLoaded', init)
