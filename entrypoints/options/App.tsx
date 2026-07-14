import { useState, useEffect } from 'react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Languages, Settings2, Cpu, LoaderCircle, Check, X } from 'lucide-react'

const TABS = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'engines', label: '引擎配置', icon: Cpu },
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
  borderColor: string
  apiKeyPlaceholder: string
  modelPlaceholder: string
  hints: { text: string; url?: string }[]
}[] = [
  {
    engine: 'siliconflow',
    name: '硅基流动',
    borderColor: 'border-l-blue-500',
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
    borderColor: 'border-l-amber-500',
    apiKeyPlaceholder: 'zhipu-api-key',
    modelPlaceholder: 'GLM-4-Flash',
    hints: [
      { text: '注册获取免费 API Key：bigmodel.cn（需实名认证）', url: 'https://bigmodel.cn' },
      { text: '免费模型：GLM-4-Flash（永久免费）' },
    ],
  },
]

export default function App() {
  const [tab, setTab] = useState<TabId>('general')
  const [engine, setEngine] = useState<EngineId>('google')
  const [targetLang, setTargetLang] = useState('zh-CN')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('vertical')
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [models, setModels] = useState<Record<string, string>>({})
  const [baseURLs, setBaseURLs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
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
      setToast({ type: 'success', message: '已保存' })
    } catch (err) {
      setToast({ type: 'error', message: `保存失败: ${err}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Languages className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">设置</h1>
            <p className="text-sm text-muted-foreground">配置翻译引擎与默认行为</p>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 space-y-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 space-y-6">
            {tab === 'general' && (
              <Card>
                <CardHeader>
                  <CardTitle>通用设置</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="engine">翻译引擎</Label>
                    <Select
                      value={engine}
                      onValueChange={(v) => setEngine(v as EngineId)}
                    >
                      <SelectTrigger id="engine">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ENGINES.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="targetLang">目标语言</Label>
                    <Select value={targetLang} onValueChange={setTargetLang}>
                      <SelectTrigger id="targetLang">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l.value} value={l.value}>
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>对照样式</Label>
                    <RadioGroup
                      value={displayMode}
                      onValueChange={(v) => setDisplayMode(v as DisplayMode)}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="vertical" id="display-vertical" />
                        <Label htmlFor="display-vertical">纵向</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="horizontal" id="display-horizontal" />
                        <Label htmlFor="display-horizontal">横向并排</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </CardContent>
              </Card>
            )}

            {tab === 'engines' && (
              <Card>
                <CardHeader>
                  <CardTitle>引擎配置</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {ENGINE_CONFIGS.map((cfg) => (
                    <div
                      key={cfg.engine}
                      className={`space-y-3 rounded-lg border border-l-4 ${cfg.borderColor} p-4`}
                    >
                      <h3 className="font-semibold">{cfg.name}</h3>
                      {cfg.hints.map((hint, i) => (
                        <p key={i} className="text-sm text-muted-foreground">
                          {hint.url ? (
                            <>
                              {hint.text.slice(0, hint.text.indexOf('：') + 1)}
                              <a
                                href={hint.url}
                                target="_blank"
                                className="text-primary underline underline-offset-4"
                              >
                                {hint.text.slice(hint.text.indexOf('：') + 1)}
                              </a>
                            </>
                          ) : (
                            hint.text
                          )}
                        </p>
                      ))}
                      <div className="space-y-2">
                        <Label htmlFor={`apiKey-${cfg.engine}`}>API Key</Label>
                        <Input
                          id={`apiKey-${cfg.engine}`}
                          type="password"
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
                      <div className="space-y-2">
                        <Label htmlFor={`model-${cfg.engine}`}>模型</Label>
                        <Input
                          id={`model-${cfg.engine}`}
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
                      <div className="space-y-2">
                        <Label htmlFor={`baseURL-${cfg.engine}`}>
                          API 地址 <span className="text-xs text-muted-foreground">（可选）</span>
                        </Label>
                        <Input
                          id={`baseURL-${cfg.engine}`}
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
                  ))}
                </CardContent>
              </Card>
            )}

            <Button onClick={handleSave} disabled={saving}>
              {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-destructive text-destructive-foreground'
          }`}
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
