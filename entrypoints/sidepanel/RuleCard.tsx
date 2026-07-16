import { useState } from 'react'
import type { RuleProposal } from '../../utils/rule-chat'
import type { SelectorCount } from '../../utils/preview'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Check, CircleAlert } from 'lucide-react'

const MODE_LABELS: Record<string, string> = {
  all: '整页翻译',
  include: '只翻译选中区域',
  exclude: '排除选中区域',
}

interface RuleCardProps {
  proposal: RuleProposal
  counts: SelectorCount[]
  saved: boolean
  onPreview: () => void
  onClearPreview: () => void
  onSave: () => void
}

function SelectorRow({ selector, count, valid, kind }: SelectorCount) {
  const bad = !valid || count === 0
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <code
        className={`min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-xs ${
          kind === 'include' ? 'text-green-700' : 'text-red-700'
        }`}
      >
        {selector}
      </code>
      <span className={`shrink-0 text-xs ${bad ? 'text-destructive' : 'text-muted-foreground'}`}>
        {valid ? `${count} 个` : '无效'}
        {bad && <CircleAlert className="ml-1 inline h-3 w-3" />}
      </span>
    </div>
  )
}

export default function RuleCard({ proposal, counts, saved, onPreview, onClearPreview, onSave }: RuleCardProps) {
  const [previewing, setPreviewing] = useState(false)

  const includeCounts = counts.filter((c) => c.kind === 'include')
  const excludeCounts = counts.filter((c) => c.kind === 'exclude')

  function togglePreview() {
    if (previewing) {
      onClearPreview()
    } else {
      onPreview()
    }
    setPreviewing(!previewing)
  }

  return (
    <div className="w-full space-y-2 rounded-2xl border bg-card p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">规则提案</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          {MODE_LABELS[proposal.mode] ?? proposal.mode}
        </span>
      </div>

      {includeCounts.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-green-700">翻译区域</div>
          {includeCounts.map((c, i) => (
            <SelectorRow key={`inc-${i}`} {...c} />
          ))}
        </div>
      )}

      {excludeCounts.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-red-700">排除区域</div>
          {excludeCounts.map((c, i) => (
            <SelectorRow key={`exc-${i}`} {...c} />
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={togglePreview}>
          {previewing ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {previewing ? '取消预览' : '预览'}
        </Button>
        <Button size="sm" className="flex-1 gap-1" onClick={onSave} disabled={saved}>
          <Check className="h-3.5 w-3.5" />
          {saved ? '已保存' : '保存规则'}
        </Button>
      </div>
    </div>
  )
}
