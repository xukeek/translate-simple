import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from 'lib/utils'

function BubbleGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="bubble-group"
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    />
  )
}

const bubbleVariants = cva(
  'group/bubble relative flex w-fit max-w-[85%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full',
  {
    variants: {
      variant: {
        default: '[&>[data-slot=bubble-content]]:bg-primary [&>[data-slot=bubble-content]]:text-primary-foreground',
        secondary: '[&>[data-slot=bubble-content]]:bg-secondary [&>[data-slot=bubble-content]]:text-secondary-foreground',
        muted: '[&>[data-slot=bubble-content]]:bg-muted',
        outline: '[&>[data-slot=bubble-content]]:border-border [&>[data-slot=bubble-content]]:bg-background',
        ghost: 'border-none [&>[data-slot=bubble-content]]:rounded-none [&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0',
        destructive: '[&>[data-slot=bubble-content]]:bg-destructive/10 [&>[data-slot=bubble-content]]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function Bubble({
  variant = 'default',
  align = 'start',
  className,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof bubbleVariants> & {
    align?: 'start' | 'end'
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  )
}

function BubbleContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        'w-fit max-w-full min-w-0 overflow-hidden rounded-2xl border border-transparent px-3 py-2 text-sm leading-relaxed break-words group-data-[align=end]/bubble:self-end',
        className
      )}
      {...props}
    />
  )
}

export { BubbleGroup, Bubble, BubbleContent }
