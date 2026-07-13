import type { UserConfig } from './translate/types'

const STORAGE_KEY = 'translate-simple-config'

export const DEFAULT_CONFIG: UserConfig = {
  enabled: false,
  engine: 'google',
  targetLang: 'zh-CN',
  displayMode: 'vertical',
  engines: {
    google: {},
    siliconflow: {
      model: 'tencent/Hunyuan-MT-7B',
      baseURL: 'https://api.siliconflow.cn/v1',
    },
    zhipu: {
      model: 'GLM-4-Flash',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    },
  },
}

export async function getConfig(): Promise<UserConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return result[STORAGE_KEY] ?? DEFAULT_CONFIG
}

export async function setConfig(config: UserConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config })
}

export async function updateConfig(partial: Partial<UserConfig>): Promise<UserConfig> {
  const config = await getConfig()
  const updated = { ...config, ...partial }
  await setConfig(updated)
  return updated
}
