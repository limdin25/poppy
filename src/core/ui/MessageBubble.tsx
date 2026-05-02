import { cn } from '@/core/lib/cn'

interface MessageBubbleProps {
  sender: 'ai' | 'customer' | 'user'
  text: string
  time?: string
  className?: string
}

const SENDER_CONFIG = {
  customer: {
    align: 'flex-row',
    bubble: 'rounded-tl-md bg-elevated text-ink',
    avatar: 'bg-elevated text-ink-muted',
    label: 'C',
  },
  ai: {
    align: 'flex-row-reverse',
    bubble: 'rounded-tr-md bg-brand-50 text-ink',
    avatar: 'bg-brand/10 text-brand',
    label: 'P',
  },
  user: {
    align: 'flex-row-reverse',
    bubble: 'rounded-tr-md bg-success/10 text-ink',
    avatar: 'bg-success/10 text-success',
    label: 'Y',
  },
} as const

export function MessageBubble({ sender, text, time, className }: MessageBubbleProps) {
  const config = SENDER_CONFIG[sender]

  return (
    <div className={cn('flex gap-2.5', config.align, className)}>
      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          config.avatar
        )}
      >
        {config.label}
      </div>
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed',
          config.bubble
        )}
      >
        <p className="whitespace-pre-wrap">{text}</p>
        {time && <p className="mt-1 text-[10px] text-ink-subtle">{time}</p>}
      </div>
    </div>
  )
}
