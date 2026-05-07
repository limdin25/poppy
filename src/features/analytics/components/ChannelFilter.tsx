import { Phone, MessageSquare, Mail } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface Props {
  value: string | null
  onChange: (channel: string | null) => void
}

const channels = [
  { key: null, label: 'All', icon: null },
  { key: 'voice', label: 'Calls', icon: Phone },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { key: 'email', label: 'Email', icon: Mail },
] as const

export function ChannelFilter({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {channels.map(ch => (
        <button
          key={ch.key ?? 'all'}
          onClick={() => onChange(ch.key)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
            value === ch.key
              ? 'bg-brand text-white'
              : 'bg-elevated text-ink-muted hover:bg-brand/10 hover:text-ink'
          )}
        >
          {ch.icon && <ch.icon size={12} />}
          {ch.label}
        </button>
      ))}
    </div>
  )
}
