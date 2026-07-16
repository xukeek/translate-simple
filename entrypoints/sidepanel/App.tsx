import { useState, useEffect, useRef, useCallback } from 'react'
import { getConfig, updateConfig } from '../../utils/storage'
import {
  createRuleChatSession,
  type RuleChatSession,
  type RuleProposal,
} from '../../utils/rule-chat'
import type { SelectorCount } from '../../utils/preview'
import type { SiteRule } from '../../utils/translate/types'

import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '@/components/ui/message-scroller'
import { Message, MessageContent, MessageAvatar } from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerIcon, MarkerContent } from '@/components/ui/marker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sparkles, Send, Trash2, Bot, User, ScanSearch, CircleAlert } from 'lucide-react'
import RuleCard from './RuleCard'

interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  proposal?: RuleProposal
  counts?: SelectorCount[]
  saved?: boolean
}

type Status =
  | { kind: 'idle' }
  | { kind: 'thinking'; label: string }
  | { kind: 'downloading'; progress: number }
  | { kind: 'error'; message: string }

let itemCounter = 0
const nextId = () => `msg-${++itemCounter}`

const PROVIDER_LABELS: Record<string, string> = {
  'chrome-local': 'Chrome 本地 AI',
  siliconflow: '硅基流动',
  zhipu: '智谱 GLM',
}

async function sendToTab<T = any>(tabId: number, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response)
      }
    })
  })
}

export default function App() {
  const [tabId, setTabId] = useState<number | null>(null)
  const [hostname, setHostname] = useState('')
  const [items, setItems] = useState<ChatItem[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [input, setInput] = useState('')
  const [hasRule, setHasRule] = useState(false)
  const [providerLabel, setProviderLabel] = useState('')

  const sessionRef = useRef<RuleChatSession | null>(null)
  const outlineSentRef = useRef(false)
  const busyRef = useRef(false)

  const resetConversation = useCallback(() => {
    sessionRef.current?.destroy()
    sessionRef.current = null
    outlineSentRef.current = false
    setItems([])
    setStatus({ kind: 'idle' })
    setProviderLabel('')
  }, [])

  const syncActiveTab = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const h = tab.url ? new URL(tab.url).hostname : ''
    setTabId(tab.id)
    setHostname((prev) => {
      if (prev !== h) resetConversation()
      return h
    })
    const config = await getConfig()
    setHasRule(Boolean(h && config.siteRules[h]))
  }, [resetConversation])

  useEffect(() => {
    syncActiveTab()
    const onActivated = () => syncActiveTab()
    const onUpdated = (_id: number, info: { url?: string }) => {
      if (info.url) syncActiveTab()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [syncActiveTab])

  function pushItem(item: ChatItem) {
    setItems((prev) => [...prev, item])
  }

  function updateItem(id: string, patch: Partial<ChatItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  async function ensureSession(): Promise<RuleChatSession> {
    if (sessionRef.current) return sessionRef.current
    const config = await getConfig()
    const { session, downloading } = await createRuleChatSession(config, (loaded) => {
      setStatus({ kind: 'downloading', progress: Math.round(loaded * 100) })
    })
    if (downloading) {
      setStatus({ kind: 'downloading', progress: 0 })
    }
    sessionRef.current = session
    setProviderLabel(PROVIDER_LABELS[session.provider] ?? session.provider)
    return session
  }

  /** 校验提案选择器命中数(同时会触发页面高亮,随后立即清除) */
  async function validateProposal(proposal: RuleProposal): Promise<SelectorCount[]> {
    if (!tabId) return []
    try {
      const res = await sendToTab<{ counts: SelectorCount[] }>(tabId, {
        type: 'previewRule',
        data: { includes: proposal.includes, excludes: proposal.excludes },
      })
      await sendToTab(tabId, { type: 'clearPreview' })
      return res?.counts ?? []
    } catch {
      return []
    }
  }

  async function runTurn(displayText: string, aiText: string) {
    if (busyRef.current) return
    busyRef.current = true
    setStatus({ kind: 'thinking', label: '思考中' })
    pushItem({ id: nextId(), role: 'user', content: displayText })

    try {
      const session = await ensureSession()
      setStatus({ kind: 'thinking', label: '思考中' })
      let { reply, rule } = await session.send(aiText)

      // 提案校验:无效/零命中选择器自动让 AI 修正一轮
      let counts: SelectorCount[] = []
      if (rule) {
        counts = await validateProposal(rule)
        const bad = counts.filter((c) => !c.valid || c.count === 0)
        if (bad.length > 0 && counts.length > 0) {
          setStatus({ kind: 'thinking', label: '修正选择器中' })
          const feedback = `以下选择器在页面上未命中任何元素或无效: ${bad
            .map((c) => c.selector)
            .join(', ')}。请修正规则,只使用页面结构摘要中真实存在的标签、id、class。`
          const fixed = await session.send(feedback)
          if (fixed.rule) {
            reply = fixed.reply
            rule = fixed.rule
            counts = await validateProposal(rule)
          }
        }
      }

      pushItem({
        id: nextId(),
        role: 'assistant',
        content: reply,
        proposal: rule ?? undefined,
        counts: rule ? counts : undefined,
        saved: false,
      })
      setStatus({ kind: 'idle' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      busyRef.current = false
    }
  }

  async function handleAnalyze() {
    if (!tabId) return
    let outline = ''
    try {
      const res = await sendToTab<{ outline: string; title: string }>(tabId, { type: 'getPageOutline' })
      outline = res?.outline ?? ''
    } catch {
      setStatus({ kind: 'error', message: '无法访问当前页面(浏览器内部页面或页面未加载完成)' })
      return
    }
    if (!outline) {
      setStatus({ kind: 'error', message: '未能提取到页面结构,请刷新页面后重试' })
      return
    }
    outlineSentRef.current = true
    await runTurn(
      '分析此页面,生成翻译规则',
      `以下是页面「${hostname}」的结构摘要:\n\n${outline}\n\n请分析页面结构,识别主要内容区域,生成合适的局部翻译规则(通常只翻译正文内容,排除导航、菜单、页脚等)。`
    )
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || !tabId) return
    setInput('')

    if (!outlineSentRef.current) {
      // 首条消息:附带页面摘要
      let outline = ''
      try {
        const res = await sendToTab<{ outline: string }>(tabId, { type: 'getPageOutline' })
        outline = res?.outline ?? ''
      } catch {
        // 拿不到摘要也继续,让 AI 基于用户描述工作
      }
      outlineSentRef.current = true
      const aiText = outline
        ? `以下是页面「${hostname}」的结构摘要:\n\n${outline}\n\n用户需求: ${text}`
        : text
      await runTurn(text, aiText)
    } else {
      await runTurn(text, text)
    }
  }

  async function handleSaveRule(item: ChatItem) {
    if (!item.proposal || !hostname) return
    const config = await getConfig()
    const rule: SiteRule = {
      mode: item.proposal.mode,
      includes: item.proposal.includes,
      excludes: item.proposal.excludes,
      source: 'ai',
      updatedAt: Date.now(),
    }
    await updateConfig({ siteRules: { ...config.siteRules, [hostname]: rule } })
    if (tabId) {
      sendToTab(tabId, { type: 'clearPreview' }).catch(() => {})
    }
    updateItem(item.id, { saved: true })
    setHasRule(true)
  }

  async function handleClearRule() {
    if (!hostname) return
    const config = await getConfig()
    const rules = { ...config.siteRules }
    delete rules[hostname]
    await updateConfig({ siteRules: rules })
    setHasRule(false)
    setItems((prev) => prev.map((it) => (it.saved ? { ...it, saved: false } : it)))
  }

  function handlePreview(item: ChatItem) {
    if (!tabId || !item.proposal) return
    sendToTab(tabId, {
      type: 'previewRule',
      data: { includes: item.proposal.includes, excludes: item.proposal.excludes },
    }).catch(() => {})
  }

  function handleClearPreview() {
    if (!tabId) return
    sendToTab(tabId, { type: 'clearPreview' }).catch(() => {})
  }

  const busy = status.kind === 'thinking' || status.kind === 'downloading'

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">AI 翻译规则</div>
            <div className="truncate text-xs text-muted-foreground">
              {hostname || '无活动页面'}
              {providerLabel && ` · ${providerLabel}`}
            </div>
          </div>
        </div>
        {hasRule && (
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={handleClearRule}>
            <Trash2 className="h-3.5 w-3.5" />
            清除规则
          </Button>
        )}
      </div>

      {/* Chat */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent>
              {items.length === 0 && (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <ScanSearch className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-sm font-medium">让 AI 帮你决定翻译哪些区域</div>
                  <p className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
                    AI 会分析当前页面结构,生成"只翻译部分元素"的规则。你可以继续对话微调,比如"评论区也要翻译"、"别翻译代码示例"。
                  </p>
                  <Button size="sm" className="gap-1.5" onClick={handleAnalyze} disabled={!tabId || busy}>
                    <Sparkles className="h-3.5 w-3.5" />
                    分析此页面
                  </Button>
                  {hasRule && (
                    <p className="text-xs text-muted-foreground">此站点已有规则,重新分析将生成新提案。</p>
                  )}
                </div>
              )}

              {items.map((item) => (
                <MessageScrollerItem key={item.id} messageId={item.id}>
                  <Message align={item.role === 'user' ? 'end' : 'start'}>
                    <MessageAvatar>
                      {item.role === 'user' ? (
                        <User className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Bot className="h-4 w-4 text-primary" />
                      )}
                    </MessageAvatar>
                    <MessageContent>
                      <Bubble
                        variant={item.role === 'user' ? 'default' : 'muted'}
                        align={item.role === 'user' ? 'end' : 'start'}
                      >
                        <BubbleContent>{item.content}</BubbleContent>
                      </Bubble>
                      {item.proposal && (
                        <RuleCard
                          proposal={item.proposal}
                          counts={item.counts ?? []}
                          saved={Boolean(item.saved)}
                          onPreview={() => handlePreview(item)}
                          onClearPreview={handleClearPreview}
                          onSave={() => handleSaveRule(item)}
                        />
                      )}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}

              {status.kind === 'thinking' && (
                <MessageScrollerItem messageId="status-thinking">
                  <Marker>
                    <MarkerIcon>
                      <Bot className="h-4 w-4" />
                    </MarkerIcon>
                    <MarkerContent>
                      <span className="shimmer">{status.label}…</span>
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}

              {status.kind === 'downloading' && (
                <MessageScrollerItem messageId="status-downloading">
                  <Marker>
                    <MarkerIcon>
                      <Sparkles className="h-4 w-4" />
                    </MarkerIcon>
                    <MarkerContent>
                      <span className="shimmer">正在下载 Chrome 本地模型 {status.progress}%…</span>
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}

              {status.kind === 'error' && (
                <MessageScrollerItem messageId="status-error">
                  <Marker variant="border">
                    <MarkerIcon>
                      <CircleAlert className="h-4 w-4 text-destructive" />
                    </MarkerIcon>
                    <MarkerContent className="text-destructive">{status.message}</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {/* Input */}
      <div className="border-t p-3">
        {items.length > 0 && (
          <div className="mb-2 flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={handleAnalyze}
              disabled={busy}
            >
              <Sparkles className="h-3 w-3" />
              重新分析
            </Button>
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='如"只翻译正文"、"评论区也要翻译"'
            disabled={busy || !tabId}
            className="h-9 text-sm"
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
