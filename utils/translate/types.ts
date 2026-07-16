export type EngineId = 'google' | 'siliconflow' | 'zhipu'

export type DisplayMode = 'vertical' | 'horizontal'

export interface EngineConfig {
  apiKey?: string
  model?: string
  baseURL?: string
}

export type RuleMode = 'all' | 'include' | 'exclude'

/** 站点级局部翻译规则(选择器均为 CSS selector) */
export interface SiteRule {
  /** all=整页翻译; include=只翻译 includes 命中的区域; exclude=跳过 excludes 命中的区域 */
  mode: RuleMode
  includes: string[]
  excludes: string[]
  source: 'ai' | 'manual'
  updatedAt: number
}

/** AI 规则生成通道: auto=本地优先自动回退 */
export type RuleGenProvider = 'auto' | 'chrome-local' | EngineId

export interface UserConfig {
  enabled: boolean
  engine: EngineId
  targetLang: string
  displayMode: DisplayMode
  siteList: string[]
  /** key 为 hostname */
  siteRules: Record<string, SiteRule>
  ruleGenProvider: RuleGenProvider
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
