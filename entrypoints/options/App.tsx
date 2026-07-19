import { useState, useEffect, type ReactNode } from 'react'
import { getConfig, setConfig, DEFAULT_CONFIG } from '../../utils/storage'
import type { EngineId, DisplayMode } from '../../utils/translate/types'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Languages, Settings2, Cpu, LoaderCircle, Check, X, ScanSearch } from 'lucide-react'
import { cn } from 'lib/utils'
import SiteRules from './SiteRules'

const TABS = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'engines', label: '引擎配置', icon: Cpu },
  { id: 'siteRules', label: '站点规则', icon: ScanSearch },
] as const

type TabId = (typeof TABS)[number]['id']

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

const ENGINE_CONFIGS: {
  engine: EngineId
  name: string
  apiKeyPlaceholder: string
  modelPlaceholder: string
  hints: { text: string; url?: string }[]
}[] = [
  {
    engine: 'siliconflow',
    name: '硅基流动',
    apiKeyPlaceholder: 'sk-...',
    modelPlaceholder: 'tencent/Hunyuan-MT-7B',
    hints: [
      { text: '注册获取免费 API Key：cloud.siliconflow.cn', url: 'https://cloud.siliconflow.cn' },
      { text: '免费模型：tencent/Hunyuan-MT-7B（翻译专用）、THUDM/GLM-Z1-9B-0414' },
    ],
  },
  {
    engine: 'zhipu',
    name: '智谱 GLM',
    apiKeyPlaceholder: 'zhipu-api-key',
    modelPlaceholder: 'GLM-4-Flash',
    hints: [
      { text: '注册获取免费 API Key：bigmodel.cn（需实名认证）', url: 'https://bigmodel.cn' },
      { text: '免费模型：GLM-4-Flash（永久免费）' },
    ],
  },
]

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string
  desc?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabId>('general')
  const [engine, setEngine] = useState<EngineId>('google')
  const [targetLang, setTargetLang] = useState('zh-CN')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('vertical')
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [models, setModels] = useState<Record<string, string>>({})
  const [baseURLs, setBaseURLs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    getConfig().then((config) => {
      setEngine(config.engine)
      setTargetLang(config.targetLang)
      setDisplayMode(config.displayMode)
      const keys: Record<string, string> = {}
      const mods: Record<string, string> = {}
      const urls: Record<string, string> = {}
      for (const [e, cfg] of Object.entries(config.engines)) {
        keys[e] = cfg.apiKey || ''
        mods[e] = cfg.model || DEFAULT_CONFIG.engines[e as EngineId]?.model || ''
        urls[e] = cfg.baseURL || ''
      }
      setApiKeys(keys)
      setModels(mods)
      setBaseURLs(urls)
    })
  }, [])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  async function handleSave() {
    setSaving(true)
    try {
      const config = await getConfig()
      const engines = { ...config.engines }
      for (const { engine: e } of ENGINE_CONFIGS) {
        engines[e] = {
          ...engines[e],
          apiKey: apiKeys[e]?.trim() || undefined,
          model: models[e]?.trim() || engines[e]?.model,
          baseURL: baseURLs[e]?.trim() || engines[e]?.baseURL,
        }
      }
      await setConfig({
        ...config,
        engine,
        targetLang,
        displayMode,
        engines,
      })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (err) {
      setToast({ type: 'error', message: `保存失败: ${err}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[hsl(220,25%,96.5%)] p-6">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 pb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/75 shadow-sm">
            <Languages className="h-[18px] w-[18px] text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">简单翻译</h1>
            <p className="text-xs text-muted-foreground">配置翻译引擎与默认行为</p>
          </div>
        </div>

        <div className="flex gap-5">
          {/* Sidebar */}
          <nav className="w-36 shrink-0 space-y-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98]',
                  tab === t.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 space-y-4">
            {tab === 'general' && (
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-muted/40 px-5 py-3">
                  <CardTitle className="text-sm">通用设置</CardTitle>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  <SettingRow label="翻译引擎" desc="整页翻译使用的默认引擎">
                    <Select
                      value={engine}
                      onValueChange={(v) => setEngine(v as EngineId)}
                    >
                      <SelectTrigger id="engine" className="h-9 w-[200px] shrink-0">
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
                  </SettingRow>
                  <SettingRow label="目标语言" desc="页面内容将被翻译为该语言">
                    <Select value={targetLang} onValueChange={setTargetLang}>
                      <SelectTrigger id="targetLang" className="h-9 w-[200px] shrink-0">
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
                  </SettingRow>
                  <SettingRow label="对照样式" desc="译文与原文的排列方式">
                    <div className="flex shrink-0 rounded-md bg-muted p-0.5">
                      {(
                        [
                          { value: 'vertical', label: '纵向' },
                          { value: 'horizontal', label: '横向并排' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.value}
                          className={cn(
                            'h-7 rounded-[5px] px-3 text-[13px] font-medium transition-all active:scale-[0.97]',
                            displayMode === m.value
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => setDisplayMode(m.value)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                </CardContent>
              </Card>
            )}

            {tab === 'engines' &&
              ENGINE_CONFIGS.map((cfg) => {
                const configured = Boolean(apiKeys[cfg.engine]?.trim())
                return (
                  <Card key={cfg.engine} className="overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-muted/40 px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                          <Cpu className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm">{cfg.name}</CardTitle>
                          <span className="rounded-full bg-emerald-100/80 px-2 py-px text-[11px] font-medium text-emerald-700">
                            有免费额度
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            configured ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                          )}
                        />
                        {configured ? '已配置' : '未配置'}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3.5 px-5 py-4">
                      <div className="space-y-0.5 rounded-md border border-primary/10 bg-primary/[0.04] px-3 py-2">
                        {cfg.hints.map((hint, i) => (
                          <p key={i} className="text-xs leading-relaxed text-muted-foreground">
                            {hint.url ? (
                              <>
                                {hint.text.slice(0, hint.text.indexOf('：') + 1)}
                                <a
                                  href={hint.url}
                                  target="_blank"
                                  className="font-medium text-primary underline-offset-4 hover:underline"
                                >
                                  {hint.text.slice(hint.text.indexOf('：') + 1)}
                                </a>
                              </>
                            ) : (
                              hint.text
                            )}
                          </p>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`apiKey-${cfg.engine}`} className="text-[13px]">
                          API Key
                        </Label>
                        <Input
                          id={`apiKey-${cfg.engine}`}
                          type="password"
                          className="h-9"
                          placeholder={cfg.apiKeyPlaceholder}
                          value={apiKeys[cfg.engine] || ''}
                          onChange={(e) =>
                            setApiKeys((prev) => ({
                              ...prev,
                              [cfg.engine]: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-3.5 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`model-${cfg.engine}`} className="text-[13px]">
                            模型
                          </Label>
                          <Input
                            id={`model-${cfg.engine}`}
                            className="h-9"
                            placeholder={cfg.modelPlaceholder}
                            value={models[cfg.engine] || ''}
                            onChange={(e) =>
                              setModels((prev) => ({
                                ...prev,
                                [cfg.engine]: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`baseURL-${cfg.engine}`} className="text-[13px]">
                            API 地址{' '}
                            <span className="text-xs font-normal text-muted-foreground">
                              （可选）
                            </span>
                          </Label>
                          <Input
                            id={`baseURL-${cfg.engine}`}
                            className="h-9"
                            placeholder="https://api.example.com/v1"
                            value={baseURLs[cfg.engine] || ''}
                            onChange={(e) =>
                              setBaseURLs((prev) => ({
                                ...prev,
                                [cfg.engine]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

            {tab === 'siteRules' && <SiteRules />}

            {tab !== 'siteRules' && (
              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className={cn(
                    'h-9 min-w-[96px] shadow-sm',
                    savedFlash && 'bg-emerald-600 hover:bg-emerald-600'
                  )}
                >
                  {saving ? (
                    <LoaderCircle className="animate-spin" />
                  ) : savedFlash ? (
                    <Check />
                  ) : null}
                  {saving ? '保存中...' : savedFlash ? '已保存' : '保存'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'toast-enter fixed bottom-6 right-6 flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg',
            toast.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-destructive text-destructive-foreground'
          )}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <X className="h-4 w-4" />
          )}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}
    </div>
  )
}
