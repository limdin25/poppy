import { useState } from 'react'
import { Search, MessageSquare, Phone, Mail, Bot } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { DataTable } from '../components/DataTable'

interface AdminConversation {
  id: string
  business: string
  contact: string
  channel: 'sms' | 'whatsapp' | 'email' | 'voice'
  lastMessage: string
  aiHandling: boolean
  messageCount: number
  updatedAt: string
}

const MOCK_CONVERSATIONS: AdminConversation[] = [
  { id: '1', business: 'Smith & Sons Plumbing', contact: 'John Peterson', channel: 'sms', lastMessage: "Thanks, I'll see you tomorrow!", aiHandling: true, messageCount: 5, updatedAt: '2 min ago' },
  { id: '2', business: 'Brighton Heating Co', contact: 'Tom Brown', channel: 'whatsapp', lastMessage: 'Can I get a quote for underfloor heating?', aiHandling: true, messageCount: 3, updatedAt: '15 min ago' },
  { id: '3', business: 'D&M Electrical', contact: 'Lisa Green', channel: 'email', lastMessage: 'Re: Invoice #1234', aiHandling: false, messageCount: 8, updatedAt: '1 hour ago' },
  { id: '4', business: "Sarah's Salon", contact: 'Emma White', channel: 'sms', lastMessage: 'Confirmed for Saturday 10am', aiHandling: true, messageCount: 4, updatedAt: '3 hours ago' },
  { id: '5', business: 'Smith & Sons Plumbing', contact: 'David Chen', channel: 'whatsapp', lastMessage: 'Perfect, Friday 2pm works for me.', aiHandling: false, messageCount: 3, updatedAt: 'Yesterday' },
]

const CHANNEL_ICON = {
  sms: MessageSquare,
  whatsapp: MessageSquare,
  email: Mail,
  voice: Phone,
}

const CHANNEL_COLOR = {
  sms: 'text-brand',
  whatsapp: 'text-emerald-500',
  email: 'text-violet-500',
  voice: 'text-success',
}

export default function ConversationMonitorPage() {
  const [search, setSearch] = useState('')

  const filtered = MOCK_CONVERSATIONS.filter(
    (c) =>
      c.contact.toLowerCase().includes(search.toLowerCase()) ||
      c.business.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Conversations</h1>
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
                const Icon = CHANNEL_ICON[c.channel]
                return <Icon size={14} className={cn(CHANNEL_COLOR[c.channel])} />
              },
              className: 'w-10',
            },
            {
              key: 'contact',
              header: 'Contact',
              render: (c) => (
                <div>
                  <p className="font-medium text-ink">{c.contact}</p>
                  <p className="text-[11px] capitalize text-ink-muted">{c.channel}</p>
                </div>
              ),
            },
            {
              key: 'business',
              header: 'Business',
              render: (c) => <span className="text-ink-muted">{c.business}</span>,
            },
            {
              key: 'lastMessage',
              header: 'Last Message',
              render: (c) => <span className="truncate text-ink-muted">{c.lastMessage}</span>,
            },
            {
              key: 'messages',
              header: 'Messages',
              render: (c) => c.messageCount,
              className: 'w-20',
            },
            {
              key: 'ai',
              header: 'AI',
              render: (c) =>
                c.aiHandling ? (
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
              render: (c) => <span className="text-ink-muted">{c.updatedAt}</span>,
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
