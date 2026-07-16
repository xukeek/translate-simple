/**
 * AI 规则对话服务:与 AI 多轮对话分析页面结构,生成/微调站点局部翻译规则。
 * 双通道:Chrome 内置 Prompt API(Gemini Nano,本地) / 云端 OpenAI 兼容 LLM(硅基流动、智谱)。
 */
import type { EngineId, RuleMode, UserConfig } from './translate/types'

export interface RuleProposal {
  mode: RuleMode
  includes: string[]
  excludes: string[]
}

export interface ChatReply {
  reply: string
  rule: RuleProposal | null
}

export interface RuleChatSession {
  readonly provider: 'chrome-local' | EngineId
  send(userText: string): Promise<ChatReply>
  destroy(): void
}

const SYSTEM_PROMPT = `你是一个浏览器翻译扩展的助手,帮助用户创建"站点局部翻译规则"。

用户会提供网页的结构摘要(缩进表示层级,每行格式为: 标签#id.class (text=文本长度, links=链接文字占比) "文本样例" xN 表示同类元素重复 N 次)。

你的任务:
1. 分析页面结构,识别正文/主要内容区域,以及导航、侧边栏、页脚、菜单、评论等辅助区域。
2. 根据用户需求生成翻译规则,规则包含:
   - mode: "include"(只翻译 includes 命中的区域) / "exclude"(翻译整页但跳过 excludes 命中的区域) / "all"(整页翻译)
   - includes: CSS 选择器数组
   - excludes: CSS 选择器数组
3. 选择器必须基于摘要中真实存在的标签、id、class,优先使用简洁稳定的选择器(如 main、article、#content、.post-body),避免过长的层级链。
4. 用户继续提出修改时,基于上一版规则调整并输出完整的新规则。

回复要求:必须输出 JSON 对象,格式为 {"reply": "给用户的简短中文说明", "rule": {"mode": "...", "includes": [...], "excludes": [...]} 或 null}。
"reply" 简要说明你识别出的区域和规则思路,不超过 120 字。仅当用户在闲聊或提问(无需改规则)时 "rule" 为 null。不要输出 JSON 以外的任何内容。`

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    rule: {
      type: ['object', 'null'],
      properties: {
        mode: { type: 'string', enum: ['all', 'include', 'exclude'] },
        includes: { type: 'array', items: { type: 'string' } },
        excludes: { type: 'array', items: { type: 'string' } },
      },
      required: ['mode', 'includes', 'excludes'],
      additionalProperties: false,
    },
  },
  required: ['reply', 'rule'],
  additionalProperties: false,
}

/** 容错解析模型输出的 JSON(剥掉 markdown 代码围栏、截取首个对象) */
export function parseChatReply(raw: string): ChatReply {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)

  try {
    const obj = JSON.parse(text)
    const rule = obj.rule
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : String(raw),
      rule:
        rule && typeof rule === 'object' && ['all', 'include', 'exclude'].includes(rule.mode)
          ? {
              mode: rule.mode,
              includes: Array.isArray(rule.includes) ? rule.includes.filter((s: unknown) => typeof s === 'string') : [],
              excludes: Array.isArray(rule.excludes) ? rule.excludes.filter((s: unknown) => typeof s === 'string') : [],
            }
          : null,
    }
  } catch {
    return { reply: raw.trim(), rule: null }
  }
}

// ---------- Chrome 本地(Prompt API / Gemini Nano) ----------

export type LocalAvailability = Availability | 'unsupported'

export async function checkLocalAvailability(): Promise<LocalAvailability> {
  if (typeof LanguageModel === 'undefined') return 'unsupported'
  try {
    return await LanguageModel.availability()
  } catch {
    return 'unavailable'
  }
}

class ChromeLocalSession implements RuleChatSession {
  readonly provider = 'chrome-local' as const
  private session: LanguageModel

  private constructor(session: LanguageModel) {
    this.session = session
  }

  static async create(onDownloadProgress?: (loaded: number) => void): Promise<ChromeLocalSession> {
    const session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          onDownloadProgress?.((e as ProgressEvent).loaded)
        })
      },
    })
    return new ChromeLocalSession(session)
  }

  async send(userText: string): Promise<ChatReply> {
    const raw = await this.session.prompt(userText, {
      responseConstraint: RULE_SCHEMA,
    })
    return parseChatReply(raw)
  }

  destroy(): void {
    this.session.destroy()
  }
}

// ---------- 云端 OpenAI 兼容 ----------

interface CloudMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

class CloudSession implements RuleChatSession {
  readonly provider: EngineId
  private messages: CloudMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  private apiKey: string
  private baseURL: string
  private model: string

  constructor(provider: EngineId, cfg: { apiKey: string; baseURL: string; model: string }) {
    this.provider = provider
    this.apiKey = cfg.apiKey
    this.baseURL = cfg.baseURL.replace(/\/$/, '')
    this.model = cfg.model
  }

  async send(userText: string): Promise<ChatReply> {
    this.messages.push({ role: 'user', content: userText })

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.messages,
        temperature: 0.2,
        max_tokens: 2048,
      }),
    })

    if (!res.ok) {
      this.messages.pop()
      const err = await res.text()
      throw new Error(`AI 请求失败 (${res.status}): ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    const raw: string = data.choices?.[0]?.message?.content ?? ''
    this.messages.push({ role: 'assistant', content: raw })
    return parseChatReply(raw)
  }

  destroy(): void {
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  }
}

// ---------- 通道选择 ----------

export interface CreateSessionResult {
  session: RuleChatSession
  /** 本地模型需要下载时为 true(创建过程会触发下载) */
  downloading: boolean
}

/** 找到已配置 API Key 的可用云端引擎 */
export function findConfiguredCloudEngine(config: UserConfig): EngineId | null {
  for (const id of ['siliconflow', 'zhipu'] as EngineId[]) {
    if (config.engines[id]?.apiKey) return id
  }
  return null
}

export async function createRuleChatSession(
  config: UserConfig,
  onDownloadProgress?: (loaded: number) => void
): Promise<CreateSessionResult> {
  const provider = config.ruleGenProvider

  const createCloud = (id: EngineId): CloudSession => {
    const cfg = config.engines[id]
    if (!cfg?.apiKey || !cfg.baseURL || !cfg.model) {
      throw new Error(`引擎 ${id} 未配置 API Key,请到设置页配置`)
    }
    return new CloudSession(id, { apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model })
  }

  if (provider === 'chrome-local') {
    const avail = await checkLocalAvailability()
    if (avail === 'unsupported' || avail === 'unavailable') {
      throw new Error('当前浏览器不支持 Chrome 内置 AI(需 Chrome 138+ 桌面版且硬件满足要求)')
    }
    const downloading = avail !== 'available'
    return { session: await ChromeLocalSession.create(onDownloadProgress), downloading }
  }

  if (provider !== 'auto') {
    return { session: createCloud(provider), downloading: false }
  }

  // auto:本地可用即本地,需下载或不可用时回退云端;云端也没配则尝试触发本地下载
  const avail = await checkLocalAvailability()
  if (avail === 'available') {
    return { session: await ChromeLocalSession.create(), downloading: false }
  }

  const cloudEngine = findConfiguredCloudEngine(config)
  if (cloudEngine) {
    return { session: createCloud(cloudEngine), downloading: false }
  }

  if (avail === 'downloadable' || avail === 'downloading') {
    return { session: await ChromeLocalSession.create(onDownloadProgress), downloading: true }
  }

  throw new Error(
    '没有可用的 AI:当前浏览器不支持 Chrome 内置 AI,且未配置任何云端引擎的 API Key。请到设置页配置硅基流动或智谱的 API Key。'
  )
}
