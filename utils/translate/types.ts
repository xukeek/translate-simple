export type EngineId = 'google' | 'siliconflow' | 'zhipu'

export type DisplayMode = 'vertical' | 'horizontal'

export interface EngineConfig {
  apiKey?: string
  model?: string
  baseURL?: string
}

export interface UserConfig {
  enabled: boolean
  engine: EngineId
  targetLang: string
  displayMode: DisplayMode
  engines: Record<EngineId, EngineConfig>
}

export interface TranslateRequest {
  text: string
  sourceLang: string
  targetLang: string
  engine: EngineId
}

export interface TranslateResponse {
  text: string
  from: string
}
