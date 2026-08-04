import { useState, useEffect } from 'react'
import { getConfig, updateConfig } from '../../utils/storage'
import type { EngineId } from '../../utils/translate/types'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Languages, Globe, Zap, Check, Sparkles, Settings2, ChevronRight } from 'lucide-react'
import { cn } from 'lib/utils'

type PageState = 'idle' | 'translating' | 'translated'
type TranslationStateResponse = { translated?: boolean; translating?: boolean }

const ENGINES: { id: EngineId; name: string }[] = [
  { id: 'google', name: 'Google 翻译（免费）' },
  { id: 'siliconflow', name: '硅基流动' },
  { id: 'zhipu', name: '智谱 GLM' },
]

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'de', label: '德语' },
  { value: 'es', label: '西班牙语' },
  { value: 'ru', label: '俄语' },
  { value: 'pt', label: '葡萄牙语' },
]

export default function App() {
  const [hostname, setHostname] = useState('')
  const [siteListed, setSiteListed] = useState(false)
  const [pageState, setPageState] = useState<PageState>('idle')
  const [engine, setEngine] = useState<EngineId>('google')
  const [targetLang, setTargetLang] = useState('zh-CN')

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let pollDeadline = 0

    function stateFromResponse(res?: TranslationStateResponse): PageState {
      if (res?.translated) return 'translated'
      if (res?.translating) return 'translating'
      return 'idle'
    }

    function stopPolling() {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
    }

    function syncPageState(tabId?: number) {
      if (!tabId || cancelled) return
      chrome.tabs.sendMessage(tabId, { type: 'getTranslationState' }, (res?: TranslationStateResponse) => {
        if (cancelled) return
        if (chrome.runtime.lastError) {
          setPageState('idle')
          stopPolling()
          return
        }
        const nextState = stateFromResponse(res)
        setPageState(nextState)
        if (nextState === 'translating' && Date.now() < pollDeadline) {
          pollTimer = setTimeout(() => syncPageState(tabId), 300)
        } else {
          stopPolling()
        }
      })
    }

    Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      getConfig(),
    ]).then(([tabs, config]) => {
      if (cancelled) return
      const tab = tabs[0]
      const h = tab?.url ? new URL(tab.url).hostname : ''
      setHostname(h)
      setSiteListed(config.siteList.includes(h))
      setEngine(config.engine)
      setTargetLang(config.targetLang)

      if (tab?.id) {
        pollDeadline = Date.now() + 5000
        syncPageState(tab.id)
      }
    })
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [])

  function notifyTab(type: string) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type }).catch(() => {})
      }
    })
  }

  async function handleEngineChange(v: string) {
    setEngine(v as EngineId)
    await updateConfig({ engine: v as EngineId })
  }

  async function handleTargetLangChange(v: string) {
    setTargetLang(v)
    await updateConfig({ targetLang: v })
  }

  async function handleTranslateOnce() {
    if (pageState === 'translated') {
      notifyTab('removeTranslations')
      setPageState('idle')
    } else if (pageState === 'idle') {
      setPageState('translating')
      notifyTab('translateOnce')
    }
  }

  async function handleSiteListChange(v: boolean) {
    setSiteListed(v)
    const config = await getConfig()
    const list = config.siteList.filter((d) => d !== hostname)
    if (v && hostname) list.push(hostname)
    await updateConfig({ siteList: list })
    notifyTab('alwaysTranslate')
  }

  function openOptions() {
    chrome.runtime.openOptionsPage()
  }

  async function openSidePanel() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }

  return (
    <div className="w-[320px] bg-[hsl(220,25%,96.5%)] text-foreground">
      {/* 头部 */}
      <header className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/75 shadow-sm">
            <Languages className="h-4 w-4 text-primary-foreground" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight">简单翻译</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={openOptions}
          title="更多设置"
        >
          <Settings2 className="!size-[15px]" />
        </Button>
      </header>

      <div className="space-y-2.5 px-3 pb-3">
        {/* 主操作 */}
        <Button
          className={cn(
            'h-10 w-full rounded-[10px] bg-gradient-to-b from-primary to-primary/85 text-sm font-medium shadow-md shadow-primary/20',
            pageState !== 'idle' &&
              'bg-none bg-primary/10 text-primary shadow-none hover:bg-primary/15'
          )}
          onClick={handleTranslateOnce}
          disabled={pageState === 'translating'}
        >
          {pageState === 'translated' ? <Check /> : <Zap />}
          {pageState === 'translated'
            ? '已翻译 · 点击还原'
            : pageState === 'translating'
              ? '翻译中...'
              : '翻译此页'}
        </Button>

        {/* 页面操作分组 */}
        <div className="divide-y overflow-hidden rounded-[10px] border bg-card shadow-sm">
          <button
            className="flex h-10 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
            onClick={openSidePanel}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-[13px]">AI 规则：选择翻译区域</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          </button>
          <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-[13px] leading-snug">总是翻译此网站</div>
                {hostname && (
                  <div className="truncate text-[11px] leading-snug text-muted-foreground">
                    {hostname}
                  </div>
                )}
              </div>
            </div>
            <Switch checked={siteListed} onCheckedChange={handleSiteListChange} />
          </div>
        </div>

        {/* 翻译设置分组 */}
        <div className="divide-y overflow-hidden rounded-[10px] border bg-card shadow-sm">
          <div className="flex h-10 items-center justify-between gap-3 pl-3 pr-1.5">
            <span className="shrink-0 text-[13px]">翻译引擎</span>
            <Select value={engine} onValueChange={handleEngineChange}>
              <SelectTrigger className="h-7 w-auto justify-end gap-1 border-0 bg-transparent px-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {ENGINES.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex h-10 items-center justify-between gap-3 pl-3 pr-1.5">
            <span className="shrink-0 text-[13px]">目标语言</span>
            <Select value={targetLang} onValueChange={handleTargetLangChange}>
              <SelectTrigger className="h-7 w-auto justify-end gap-1 border-0 bg-transparent px-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}
