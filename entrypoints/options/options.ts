import { getConfig, setConfig, DEFAULT_CONFIG } from '../../utils/storage'
import type { EngineId } from '../../utils/translate/types'

async function init(): Promise<void> {
  const config = await getConfig()

  const defaultEngine = document.getElementById('defaultEngine') as HTMLSelectElement
  const defaultTargetLang = document.getElementById('defaultTargetLang') as HTMLSelectElement

  defaultEngine.value = config.engine
  defaultTargetLang.value = config.targetLang

  document.querySelectorAll<HTMLInputElement>('.api-key').forEach((input) => {
    const engine = input.dataset.engine as EngineId
    if (config.engines[engine]?.apiKey) {
      input.value = config.engines[engine].apiKey!
    }
  })

  document.querySelectorAll<HTMLInputElement>('.model').forEach((input) => {
    const engine = input.dataset.engine as EngineId
    const defaultCfg = DEFAULT_CONFIG.engines[engine]
    const current = config.engines[engine]?.model
    input.value = current || defaultCfg?.model || ''
  })

  document.getElementById('saveBtn')?.addEventListener('click', save)
}

async function save(): Promise<void> {
  const status = document.getElementById('status')!

  try {
    const defaultEngine = (document.getElementById('defaultEngine') as HTMLSelectElement).value as EngineId
    const defaultTargetLang = (document.getElementById('defaultTargetLang') as HTMLSelectElement).value

    const engines = { ...DEFAULT_CONFIG.engines }

    document.querySelectorAll<HTMLInputElement>('.api-key').forEach((input) => {
      const engine = input.dataset.engine as EngineId
      const modelInput = document.querySelector<HTMLInputElement>(`.model[data-engine="${engine}"]`)
      engines[engine] = {
        ...engines[engine],
        apiKey: input.value.trim() || undefined,
        model: modelInput?.value.trim() || engines[engine]?.model,
      }
    })

    const config = await getConfig()
    await setConfig({
      ...config,
      engine: defaultEngine,
      targetLang: defaultTargetLang,
      engines,
    })

    status.textContent = '✓ 已保存'
    status.className = 'status'
    setTimeout(() => { status.textContent = '' }, 2000)
  } catch (err) {
    status.textContent = `✗ 保存失败: ${err}`
    status.className = 'status error'
  }
}

document.addEventListener('DOMContentLoaded', init)
