import type { TranslateResponse } from './types'

interface OpenAIConfig {
  apiKey: string
  baseURL: string
  model: string
}

const LANG_MAP: Record<string, string> = {
  'zh-CN': '简体中文',
  'en': '英语',
  'ja': '日语',
  'ko': '韩语',
  'fr': '法语',
  'de': '德语',
  'es': '西班牙语',
  'ru': '俄语',
  'pt': '葡萄牙语',
  'it': '意大利语',
  'th': '泰语',
  'vi': '越南语',
  'ar': '阿拉伯语',
}

export async function translateOpenAICompat(
  text: string,
  targetLang: string,
  config: OpenAIConfig
): Promise<TranslateResponse> {
  const baseURL = config.baseURL.replace(/\/$/, '')
  const url = `${baseURL}/chat/completions`
  const target = LANG_MAP[targetLang] || targetLang

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${target}. Return ONLY the translated text, nothing else.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`翻译 API 错误 (${res.status}): ${err}`)
  }

  const data = await res.json()
  const translated = data.choices?.[0]?.message?.content?.trim() ?? ''

  return { text: translated, from: 'auto' }
}
