import { useState } from 'react'
import { Search, MessageSquare, Phone, Mail, Bot } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { DataTable } from '../components/DataTable'
import { AdminError } from '../components/AdminError'
import { useAdminApi } from '../hooks/useAdminApi'

interface AdminConversation {
  id: string
  channel: string
  status: string
  ai_handling: boolean
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  businesses: { name: string } | null
  contacts: { name: string | null } | null
  messages: Array<{ id: string }>
}

const CHANNEL_ICON: Record<string, typeof MessageSquare> = {
  sms: MessageSquare,
  whatsapp: MessageSquare,
  email: Mail,
  voice: Phone,
}

const CHANNEL_COLOR: Record<string, string> = {
  sms: 'text-brand',
  whatsapp: 'text-emerald-500',
  email: 'text-violet-500',
  voice: 'text-success',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function ConversationMonitorPage() {
  const [search, setSearch] = useState('')
  const { data: conversations, error } = useAdminApi<AdminConversation[]>('conversations', [])

  const filtered = conversations.filter(
    (c) =>
      (c.contacts?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.businesses?.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Conversations</h1>
      {error && <AdminError error={error} />}
      <p className="mt-1 text-[13px] text-ink-muted">All messaging threads across businesses</p>

      <div className="relative mt-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by contact or business..."
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="mt-4">
        <DataTable
          columns={[
            {
              key: 'channel',
              header: '',
              render: (c) => {
                const Icon = CHANNEL_ICON[c.channel] || MessageSquare
                return <Icon size={14} className={cn(CHANNEL_COLOR[c.channel] || 'text-ink-muted')} />
              },
              className: 'w-10',
            },
            {
              key: 'contact',
              header: 'Contact',
              render: (c) => (
                <div>
                  <p className="font-medium text-ink">{c.contacts?.name || 'Unknown'}</p>
                  <p className="text-[11px] capitalize text-ink-muted">{c.channel}</p>
                </div>
              ),
            },
            {
              key: 'business',
              header: 'Business',
              render: (c) => <span className="text-ink-muted">{c.businesses?.name || '—'}</span>,
            },
            {
              key: 'lastMessage',
              header: 'Last Message',
              render: (c) => <span className="truncate text-ink-muted">{c.last_message_preview || '—'}</span>,
            },
            {
              key: 'messages',
              header: 'Messages',
              render: (c) => c.messages?.length || 0,
              className: 'w-20',
            },
            {
              key: 'ai',
              header: 'AI',
              render: (c) =>
                c.ai_handling ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-brand">
                    <Bot size={11} /> On
                  </span>
                ) : (
                  <span className="text-[11px] text-ink-muted">Off</span>
                ),
              className: 'w-16',
            },
            {
              key: 'updated',
              header: 'Updated',
              render: (c) => <span className="text-ink-muted">{timeAgo(c.last_message_at)}</span>,
            },
          ]}
          data={filtered}
          keyExtractor={(c) => c.id}
          emptyMessage="No conversations match your search"
        />
      </div>
    </div>
  )
}
