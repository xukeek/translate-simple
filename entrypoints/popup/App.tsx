import { useState, useEffect } from 'react'
import { getConfig, updateConfig } from '../../utils/storage'
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
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Button } from '@/components/ui/button'
import { Languages, Globe, Zap, Check } from 'lucide-react'

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
  const [pageTranslated, setPageTranslated] = useState(false)
  const [engine, setEngine] = useState<EngineId>('google')
  const [targetLang, setTargetLang] = useState('zh-CN')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('vertical')

  useEffect(() => {
    Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      getConfig(),
    ]).then(([tabs, config]) => {
      const tab = tabs[0]
      const h = tab?.url ? new URL(tab.url).hostname : ''
      setHostname(h)
      setSiteListed(config.siteList.includes(h))
      setEngine(config.engine)
      setTargetLang(config.targetLang)
      setDisplayMode(config.displayMode)

      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'getTranslationState' }, (res) => {
          if (res?.translated) setPageTranslated(true)
        })
      }
    })
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

  async function handleDisplayModeChange(v: string) {
    setDisplayMode(v as DisplayMode)
    await updateConfig({ displayMode: v as DisplayMode })
  }

  async function handleTranslateOnce() {
    if (pageTranslated) {
      notifyTab('removeTranslations')
      setPageTranslated(false)
    } else {
      setPageTranslated(true)
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

  return (
    <div className="w-[400px] p-4 bg-background">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">简单翻译</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant={pageTranslated ? 'default' : 'outline'}
            className="w-full justify-start gap-2"
            onClick={handleTranslateOnce}
          >
            {pageTranslated ? <Check className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            {pageTranslated ? '已翻译' : '翻译此页'}
          </Button>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                总是翻译此网站
                {hostname && (
                  <span className="ml-1 text-xs text-muted-foreground">({hostname})</span>
                )}
              </span>
            </div>
            <Switch checked={siteListed} onCheckedChange={handleSiteListChange} />
          </div>

          <div className="space-y-2 pt-1">
            <Label htmlFor="engine">翻译引擎</Label>
            <Select value={engine} onValueChange={handleEngineChange}>
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
            <Select value={targetLang} onValueChange={handleTargetLangChange}>
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
              onValueChange={handleDisplayModeChange}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="vertical" id="vertical" />
                <Label htmlFor="vertical">纵向</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="horizontal" id="horizontal" />
                <Label htmlFor="horizontal">横向并排</Label>
              </div>
            </RadioGroup>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={openOptions}
          >
            更多设置
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
