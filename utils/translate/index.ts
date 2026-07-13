import type { TranslateRequest, TranslateResponse } from './types'
import { translateGoogle } from './google'
import { translateOpenAICompat } from './openai-compat'
import { getConfig } from '../storage'

export async function translate(req: TranslateRequest): Promise<TranslateResponse> {
  const text = req.text.trim()
  if (!text) return { text: '', from: '' }

  switch (req.engine) {
    case 'google':
      return translateGoogle(text, req.targetLang)

    case 'siliconflow':
    case 'zhipu': {
      const config = await getConfig()
      const engineCfg = config.engines[req.engine]
      if (!engineCfg?.apiKey) {
        throw new Error(`${req.engine === 'siliconflow' ? '硅基流动' : '智谱 GLM'} 未配置 API Key`)
      }
      return translateOpenAICompat(text, req.targetLang, {
        apiKey: engineCfg.apiKey,
        baseURL: engineCfg.baseURL!,
        model: engineCfg.model!,
      })
    }

    default:
      throw new Error(`不支持的翻译引擎: ${req.engine}`)
  }
}
