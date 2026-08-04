import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Trash2, Pencil, Plus, Search, X } from 'lucide-react'
import { cn } from 'lib/utils'

interface SelectorListEditorProps {
  label: string
  description?: string
  items: string[]
  placeholder?: string
  emptyText?: string
  onChange: (items: string[]) => void
}

export default function SelectorListEditor({
  label,
  description,
  items,
  placeholder = 'CSS 选择器',
  emptyText = '暂无规则',
  onChange,
}: SelectorListEditorProps) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingIndex !== null) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingIndex])

  const filtered = query
    ? items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.toLowerCase().includes(query.toLowerCase()))
    : items.map((item, index) => ({ item, index }))

  function handleAdd() {
    const value = draft.trim()
    if (!value) return
    if (items.includes(value)) {
      setDraft('')
      return
    }
    onChange([...items, value])
    setDraft('')
    addInputRef.current?.focus()
  }

  function handleDelete(index: number) {
    onChange(items.filter((_, i) => i !== index))
    if (editingIndex === index) {
      setEditingIndex(null)
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1)
    }
  }

  function startEdit(index: number) {
    setEditingIndex(index)
    setEditValue(items[index])
  }

  function commitEdit() {
    if (editingIndex === null) return
    const value = editValue.trim()
    if (!value) {
      handleDelete(editingIndex)
      setEditingIndex(null)
      return
    }
    const withoutEdited = items.filter((_, i) => i !== editingIndex)
    const withoutDup = withoutEdited.filter((s) => s !== value)
    const insertAt = Math.min(editingIndex, withoutDup.length)
    withoutDup.splice(insertAt, 0, value)
    onChange(withoutDup)
    setEditingIndex(null)
  }

  function cancelEdit() {
    setEditingIndex(null)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[13px]">
          {label}
          {items.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">({items.length})</span>
          )}
        </Label>
        {description && (
          <span className="text-[11px] text-muted-foreground">{description}</span>
        )}
      </div>

      {items.length > 5 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 bg-background pl-8 text-xs"
            placeholder="搜索选择器..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed bg-background px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed bg-background px-3 py-3 text-center text-xs text-muted-foreground">
          无匹配结果
        </div>
      ) : (
        <ul className="max-h-[240px] space-y-1 overflow-y-auto rounded-md border bg-background p-1">
          {filtered.map(({ item, index }) => (
            <li
              key={`${index}-${item}`}
              className={cn(
                'group flex items-center gap-1 rounded px-1.5 py-1',
                editingIndex === index ? 'bg-muted/80' : 'hover:bg-muted/50'
              )}
            >
              {editingIndex === index ? (
                <Input
                  ref={editInputRef}
                  className="h-7 flex-1 font-mono text-xs"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitEdit()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    }
                  }}
                />
              ) : (
                <>
                  <code
                    className="min-w-0 flex-1 truncate font-mono text-xs"
                    title={item}
                  >
                    {item}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                    onClick={() => startEdit(index)}
                    title="编辑"
                  >
                    <Pencil className="!size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                    onClick={() => handleDelete(index)}
                    title="删除"
                  >
                    <Trash2 className="!size-3" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <Input
          ref={addInputRef}
          className="h-8 flex-1 bg-background font-mono text-xs"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1 px-2.5"
          onClick={handleAdd}
          disabled={!draft.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </div>
  )
}
