import * as React from 'react'
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '@shadcn/react/message-scroller'
import { ArrowDown } from 'lucide-react'

import { cn } from 'lib/utils'

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        'size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain',
        // 顶部/底部渐隐(scroll-fade 的 Tailwind 3 mask 近似实现)
        '[mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-16px),transparent)]',
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-5 px-3 py-4', className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn('min-w-0 shrink-0', className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      direction="end"
      className={cn(
        'absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-all duration-200 hover:bg-muted',
        'data-[active=false]:pointer-events-none data-[active=false]:translate-y-2 data-[active=false]:opacity-0',
        className
      )}
      {...props}
    >
      <ArrowDown className="h-4 w-4" />
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
}
