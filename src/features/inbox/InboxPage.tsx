import { useState } from 'react'
import { Search, Phone, MessageSquare, Mail, Send, ArrowLeft, Bot, MoreHorizontal } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { MessageBubble } from '@/core/ui/MessageBubble'
import { EmptyState } from '@/core/ui/EmptyState'
import { useConversations, useMessages } from '@/core/hooks/useConversations'
import type { Conversation, Message } from '@/core/types/database'

function timeAgo(dateStr: string | null) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  return 'Yesterday'
}

const CHANNEL_ICON = {
  voice: Phone,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  email: Mail,
}

const CHANNEL_COLOR = {
  voice: 'text-success',
  sms: 'text-brand',
  whatsapp: 'text-emerald-500',
  email: 'text-violet-500',
}

export default function InboxPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const { data: conversations, loading } = useConversations()

  const selected = conversations.find((c) => c.id === selectedId)

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase()
    const name = c.contact?.name?.toLowerCase() ?? ''
    const preview = c.last_message_preview?.toLowerCase() ?? ''
    return name.includes(q) || preview.includes(q)
  })

  if (selected && typeof window !== 'undefined' && window.innerWidth < 1024) {
    return (
      <div className="flex h-full flex-col">
        <ThreadView conversation={selected} reply={reply} setReply={setReply} onBack={() => setSelectedId(null)} />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className={cn('flex w-full flex-col border-r border-border lg:w-[300px] lg:shrink-0', selected && 'hidden lg:flex')}>
        <div className="flex items-center justify-between px-4 pt-4">
          <h1 className="text-lg font-semibold text-ink">Inbox</h1>
          <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[12px] font-semibold text-brand">
            {conversations.filter((c) => c.unread_count > 0).length} new
          </span>
        </div>

        <div className="relative mt-3 px-4">
          <Search size={15} className="absolute left-7 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-muted">No conversations yet</p>
          ) : (
            filtered.map((conv) => {
              const Icon = CHANNEL_ICON[conv.channel]
              const contactName = conv.contact?.name ?? 'Unknown'
              const unread = conv.unread_count > 0
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition',
                    selectedId === conv.id
                      ? 'bg-brand-50 border border-brand/20'
                      : 'hover:bg-elevated border border-transparent'
                  )}
                >
                  <div className="relative">
                    <Avatar name={contactName} size="sm" className="border-0" />
                    {unread && (
                      <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className={cn('truncate text-[13px] font-medium', unread ? 'text-ink' : 'text-ink-muted')}>
                          {contactName}
                        </p>
                        <Icon size={12} className={cn('shrink-0', CHANNEL_COLOR[conv.channel])} />
                      </div>
                      <span className="shrink-0 text-[10px] text-ink-subtle">{timeAgo(conv.last_message_at)}</span>
                    </div>
                    <p className={cn('mt-0.5 truncate text-[12px]', unread ? 'font-medium text-ink' : 'text-ink-muted')}>
                      {conv.last_message_preview ?? 'No messages'}
                    </p>
                    {conv.ai_handling && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                        <Bot size={10} /> AI active
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="hidden flex-1 lg:flex lg:flex-col">
        {selected ? (
          <ThreadView conversation={selected} reply={reply} setReply={setReply} onBack={() => setSelectedId(null)} desktop />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MessageSquare size={24} />}
              title="No conversation selected"
              description="Choose a conversation from the list to view messages"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ThreadView({
  conversation,
  reply,
  setReply,
  onBack,
  desktop,
}: {
  conversation: Conversation
  reply: string
  setReply: (v: string) => void
  onBack: () => void
  desktop?: boolean
}) {
  const Icon = CHANNEL_ICON[conversation.channel]
  const contactName = conversation.contact?.name ?? 'Unknown'
  const { data: messages, loading } = useMessages(conversation.id)

  function senderLabel(msg: Message): 'ai' | 'customer' | 'user' {
    if (msg.sender === 'contact') return 'customer'
    if (msg.sender === 'ai') return 'ai'
    return 'user'
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        {!desktop && (
          <button onClick={onBack} className="text-brand">
            <ArrowLeft size={18} />
          </button>
        )}
        <Avatar name={contactName} size="sm" className="border-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">{contactName}</p>
          <div className="flex items-center gap-1.5">
            <Icon size={11} className={CHANNEL_COLOR[conversation.channel]} />
            <span className="text-[11px] capitalize text-ink-subtle">{conversation.channel}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
              conversation.ai_handling ? 'bg-brand/10 text-brand' : 'bg-elevated text-ink-muted'
            )}
          >
            <Bot size={12} />
            {conversation.ai_handling ? 'AI On' : 'AI Off'}
          </button>
          <button className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">No messages yet</p>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              sender={senderLabel(msg)}
              text={msg.body ?? ''}
              time={new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            />
          ))
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type a reply..."
            rows={1}
            className="min-h-[36px] max-h-[120px] w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            disabled={!reply.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-subtle">
          Replying via {conversation.channel} · {conversation.ai_handling ? "AI will auto-reply if you don't respond" : 'Manual mode'}
        </p>
      </div>
    </div>
  )
}
