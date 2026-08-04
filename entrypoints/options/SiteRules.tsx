import { useState, useEffect, useMemo } from 'react'
import { getConfig, updateConfig } from '../../utils/storage'
import type { SiteRule, RuleMode, RuleGenProvider } from '../../utils/translate/types'
import { checkLocalAvailability, type LocalAvailability } from '../../utils/rule-chat'
import SelectorListEditor from './SelectorListEditor'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  LoaderCircle,
  ScanSearch,
  Check,
  Search,
  X,
} from 'lucide-react'
import { cn } from 'lib/utils'

const PAGE_SIZE = 10
const SEARCH_THRESHOLD = 5

const MODE_LABELS: Record<RuleMode, string> = {
  all: '整页翻译',
  include: '只翻译选中区域',
  exclude: '排除选中区域',
}

const MODE_BADGE_CLASSES: Record<RuleMode, string> = {
  all: 'bg-primary/10 text-primary',
  include: 'bg-emerald-50 text-emerald-600',
  exclude: 'bg-amber-50 text-amber-600',
}

const PROVIDERS: { value: RuleGenProvider; label: string }[] = [
  { value: 'auto', label: '自动（本地优先，回退云端）' },
  { value: 'chrome-local', label: 'Chrome 本地 AI（Gemini Nano）' },
  { value: 'siliconflow', label: '硅基流动' },
  { value: 'zhipu', label: '智谱 GLM' },
]

const AVAILABILITY_INFO: Record<
  LocalAvailability,
  { label: string; dotClass: string }
> = {
  available: { label: '可用（模型已就绪）', dotClass: 'bg-emerald-500' },
  downloadable: { label: '支持，模型待下载（首次使用时自动下载）', dotClass: 'bg-amber-500' },
  downloading: { label: '模型下载中', dotClass: 'bg-amber-500' },
  unavailable: {
    label: '不可用（硬件不满足要求：需 22GB 磁盘 + 4GB 显存或 16GB 内存）',
    dotClass: 'bg-destructive',
  },
  unsupported: { label: '不支持（需 Chrome 138+ 桌面版）', dotClass: 'bg-destructive' },
}

interface RuleEditState {
  mode: RuleMode
  includes: string[]
  excludes: string[]
}

export default function SiteRules() {
  const [rules, setRules] = useState<Record<string, SiteRule>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [edit, setEdit] = useState<RuleEditState | null>(null)
  const [provider, setProvider] = useState<RuleGenProvider>('auto')
  const [availability, setAvailability] = useState<LocalAvailability | 'checking'>('checking')
  const [savedFlash, setSavedFlash] = useState(false)
  const [siteQuery, setSiteQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    getConfig().then((config) => {
      setRules(config.siteRules)
      setProvider(config.ruleGenProvider)
    })
    checkLocalAvailability().then(setAvailability)

    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local' || !changes['translate-simple-config']) return
      const next = changes['translate-simple-config'].newValue as
        | { siteRules?: Record<string, SiteRule>; ruleGenProvider?: RuleGenProvider }
        | undefined
      if (!next?.siteRules) return
      setRules(next.siteRules)
      if (next.ruleGenProvider) setProvider(next.ruleGenProvider)
    }
    chrome.storage.onChanged.addListener(onStorageChange)
    return () => chrome.storage.onChanged.removeListener(onStorageChange)
  }, [])

  // 外部（页面「不再翻译」）更新规则时，同步当前展开站点的编辑态
  useEffect(() => {
    if (!expanded) return
    const rule = rules[expanded]
    if (!rule) {
      setExpanded(null)
      setEdit(null)
      return
    }
    setEdit({
      mode: rule.mode,
      includes: [...rule.includes],
      excludes: [...rule.excludes],
    })
  }, [rules, expanded])

  const hosts = useMemo(
    () =>
      Object.keys(rules).sort(
        (a, b) => (rules[b].updatedAt ?? 0) - (rules[a].updatedAt ?? 0)
      ),
    [rules]
  )

  const filteredHosts = useMemo(() => {
    const q = siteQuery.trim().toLowerCase()
    if (!q) return hosts
    return hosts.filter((h) => h.toLowerCase().includes(q))
  }, [hosts, siteQuery])

  const totalPages = Math.max(1, Math.ceil(filteredHosts.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageHosts = filteredHosts.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  // 页码越界时回退；搜索过滤后收起不可见展开项
  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  useEffect(() => {
    if (expanded && !filteredHosts.includes(expanded)) {
      setExpanded(null)
      setEdit(null)
    }
  }, [expanded, filteredHosts])

  function handleSiteQueryChange(value: string) {
    setSiteQuery(value)
    setPage(1)
  }

  function toggleExpand(host: string) {
    if (expanded === host) {
      setExpanded(null)
      setEdit(null)
      return
    }
    const rule = rules[host]
    setExpanded(host)
    setEdit({
      mode: rule.mode,
      includes: [...rule.includes],
      excludes: [...rule.excludes],
    })
  }

  async function handleProviderChange(v: string) {
    setProvider(v as RuleGenProvider)
    await updateConfig({ ruleGenProvider: v as RuleGenProvider })
  }

  async function handleDelete(host: string) {
    const next = { ...rules }
    delete next[host]
    setRules(next)
    if (expanded === host) {
      setExpanded(null)
      setEdit(null)
    }
    await updateConfig({ siteRules: next })
  }

  async function persistRule(host: string, partial: Partial<RuleEditState>) {
    const base = edit ?? {
      mode: rules[host].mode,
      includes: [...rules[host].includes],
      excludes: [...rules[host].excludes],
    }
    const merged: RuleEditState = {
      mode: partial.mode ?? base.mode,
      includes: partial.includes ?? base.includes,
      excludes: partial.excludes ?? base.excludes,
    }
    setEdit(merged)
    const next: Record<string, SiteRule> = {
      ...rules,
      [host]: {
        mode: merged.mode,
        includes: merged.includes,
        excludes: merged.excludes,
        source: 'manual',
        updatedAt: Date.now(),
      },
    }
    setRules(next)
    await updateConfig({ siteRules: next })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  const availInfo = availability === 'checking' ? null : AVAILABILITY_INFO[availability]
  const showSearch = hosts.length > SEARCH_THRESHOLD
  const showPagination = filteredHosts.length > PAGE_SIZE

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 px-5 py-3">
          <CardTitle className="text-sm">AI 规则生成</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          <div className="flex items-center justify-between gap-6 px-5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">AI 通道</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                云端通道使用「引擎配置」中已保存的 API Key
              </div>
            </div>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id="ruleGenProvider" className="h-9 w-[240px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-6 px-5 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-sm font-medium">Chrome 本地 AI 状态</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {availability === 'checking' ? (
                <>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  检测中...
                </>
              ) : (
                <>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', availInfo?.dotClass)} />
                  {availInfo?.label}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/40 px-5 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              站点规则
              {hosts.length > 0 && (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  · {siteQuery.trim() ? filteredHosts.length : hosts.length}
                </span>
              )}
            </CardTitle>
            {savedFlash && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <Check className="h-3.5 w-3.5" />
                已保存
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3">
          {hosts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <ScanSearch className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-1 text-sm font-medium">暂无站点规则</p>
              <p className="max-w-[320px] text-xs leading-relaxed text-muted-foreground">
                在网页上打开扩展弹窗，点击「AI 规则：选择翻译区域」，或悬停译文点击「不再翻译」
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {showSearch && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 bg-background pl-8 text-xs"
                    placeholder="搜索站点…"
                    value={siteQuery}
                    onChange={(e) => handleSiteQueryChange(e.target.value)}
                  />
                  {siteQuery && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => handleSiteQueryChange('')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              {filteredHosts.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  无匹配站点
                </div>
              ) : (
                pageHosts.map((host) => {
                  const rule = rules[host]
                  const isOpen = expanded === host
                  return (
                    <div
                      key={host}
                      className={cn(
                        'overflow-hidden rounded-lg border transition-colors',
                        isOpen && 'border-primary/30'
                      )}
                    >
                      <div
                        className={cn(
                          'flex items-center justify-between px-2.5 py-2 transition-colors',
                          !isOpen && 'hover:bg-muted/60'
                        )}
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => toggleExpand(host)}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate text-[13px] font-medium">{host}</span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium',
                              MODE_BADGE_CLASSES[rule.mode]
                            )}
                          >
                            {MODE_LABELS[rule.mode]}
                          </span>
                          {rule.includes.length > 0 && (
                            <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-px text-[11px] font-medium text-emerald-600">
                              包含 {rule.includes.length}
                            </span>
                          )}
                          {rule.excludes.length > 0 && (
                            <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-600">
                              排除 {rule.excludes.length}
                            </span>
                          )}
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {rule.source === 'ai' ? 'AI 生成' : '手动'}
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(host)}
                        >
                          <Trash2 className="!size-3.5" />
                        </Button>
                      </div>

                      {isOpen && edit && (
                        <div className="space-y-3 border-t bg-muted/40 px-3.5 py-3.5">
                          <div className="space-y-1.5">
                            <Label className="text-[13px]">模式</Label>
                            <Select
                              value={edit.mode}
                              onValueChange={(v) => persistRule(host, { mode: v as RuleMode })}
                            >
                              <SelectTrigger className="h-9 w-[240px] bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(MODE_LABELS) as RuleMode[]).map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {MODE_LABELS[m]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <SelectorListEditor
                            label="翻译区域"
                            description="仅「只翻译选中区域」时生效"
                            items={edit.includes}
                            placeholder="main"
                            emptyText="暂无翻译区域选择器"
                            onChange={(includes) => persistRule(host, { includes })}
                          />

                          <SelectorListEditor
                            label="排除区域"
                            description="任何模式下生效"
                            items={edit.excludes}
                            placeholder="nav"
                            emptyText="暂无排除规则"
                            onChange={(excludes) => persistRule(host, { excludes })}
                          />
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              {showPagination && (
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                  <span>共 {filteredHosts.length} 个站点</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-0.5 px-2"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      上一页
                    </Button>
                    <span className="min-w-[4.5rem] text-center">
                      第 {safePage} / {totalPages} 页
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-0.5 px-2"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      下一页
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
