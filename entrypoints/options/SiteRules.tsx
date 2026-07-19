import { useState, useEffect } from 'react'
import { getConfig, updateConfig } from '../../utils/storage'
import type { SiteRule, RuleMode, RuleGenProvider } from '../../utils/translate/types'
import { checkLocalAvailability, type LocalAvailability } from '../../utils/rule-chat'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Trash2, ChevronDown, ChevronRight, Save, Sparkles, Check, LoaderCircle, ScanSearch } from 'lucide-react'
import { cn } from 'lib/utils'

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
  'available': { label: '可用（模型已就绪）', dotClass: 'bg-emerald-500' },
  'downloadable': { label: '支持，模型待下载（首次使用时自动下载）', dotClass: 'bg-amber-500' },
  'downloading': { label: '模型下载中', dotClass: 'bg-amber-500' },
  'unavailable': {
    label: '不可用（硬件不满足要求：需 22GB 磁盘 + 4GB 显存或 16GB 内存）',
    dotClass: 'bg-destructive',
  },
  'unsupported': { label: '不支持（需 Chrome 138+ 桌面版）', dotClass: 'bg-destructive' },
}

interface RuleEditState {
  mode: RuleMode
  includesText: string
  excludesText: string
}

export default function SiteRules() {
  const [rules, setRules] = useState<Record<string, SiteRule>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [edit, setEdit] = useState<RuleEditState | null>(null)
  const [provider, setProvider] = useState<RuleGenProvider>('auto')
  const [availability, setAvailability] = useState<LocalAvailability | 'checking'>('checking')
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    getConfig().then((config) => {
      setRules(config.siteRules)
      setProvider(config.ruleGenProvider)
    })
    checkLocalAvailability().then(setAvailability)
  }, [])

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
      includesText: rule.includes.join('\n'),
      excludesText: rule.excludes.join('\n'),
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

  async function handleSaveRule(host: string) {
    if (!edit) return
    const parse = (text: string) =>
      text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    const next: Record<string, SiteRule> = {
      ...rules,
      [host]: {
        mode: edit.mode,
        includes: parse(edit.includesText),
        excludes: parse(edit.excludesText),
        source: 'manual',
        updatedAt: Date.now(),
      },
    }
    setRules(next)
    await updateConfig({ siteRules: next })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  const hosts = Object.keys(rules).sort()
  const availInfo = availability === 'checking' ? null : AVAILABILITY_INFO[availability]

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
          <CardTitle className="text-sm">站点规则</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {hosts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <ScanSearch className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-1 text-sm font-medium">暂无站点规则</p>
              <p className="max-w-[320px] text-xs leading-relaxed text-muted-foreground">
                在网页上打开扩展弹窗，点击「AI 规则：选择翻译区域」，与 AI 对话生成规则
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {hosts.map((host) => {
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
                            onValueChange={(v) => setEdit({ ...edit, mode: v as RuleMode })}
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
                        <div className="space-y-1.5">
                          <Label className="text-[13px]">
                            翻译区域选择器{' '}
                            <span className="text-xs font-normal text-muted-foreground">（每行一个，mode 为「只翻译选中区域」时生效）</span>
                          </Label>
                          <textarea
                            className="flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            placeholder={'main\narticle .post-body'}
                            value={edit.includesText}
                            onChange={(e) => setEdit({ ...edit, includesText: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[13px]">
                            排除区域选择器 <span className="text-xs font-normal text-muted-foreground">（每行一个，任何模式下生效）</span>
                          </Label>
                          <textarea
                            className="flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            placeholder={'nav\n.sidebar\nfooter'}
                            value={edit.excludesText}
                            onChange={(e) => setEdit({ ...edit, excludesText: e.target.value })}
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            className={cn(
                              'gap-1.5',
                              savedFlash && 'bg-emerald-600 hover:bg-emerald-600'
                            )}
                            onClick={() => handleSaveRule(host)}
                          >
                            {savedFlash ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                            {savedFlash ? '已保存' : '保存修改'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
