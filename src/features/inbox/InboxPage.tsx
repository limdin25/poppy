import { useState, useCallback, useRef, useEffect } from 'react'
import { Search, Phone, MessageSquare, Mail, Send, ArrowLeft, Bot, MoreHorizontal, Plus, X, Paperclip, Pencil, Check, RefreshCw } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { MessageBubble } from '@/core/ui/MessageBubble'
import { EmptyState } from '@/core/ui/EmptyState'
import { useConversations, useMessages, type ChannelFilter } from '@/core/hooks/useConversations'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Conversation, Message } from '@/core/types/database'

function isRawIdentifier(name: string | null | undefined): boolean {
  if (!name) return true
  if (name.includes('@lid') || name.includes('@s.whatsapp')) return true
  if (name === 'Unknown') return true
  const digitsOnly = name.replace(/[^0-9]/g, '')
  return digitsOnly.length >= 10 && digitsOnly.length === name.replace(/[+ ()-]/g, '').length
}

function displayName(contact: Conversation['contact']): string {
  if (!contact) return 'Unknown'
  if (contact.name && !isRawIdentifier(contact.name)) return contact.name
  return contact.phone || contact.whatsapp || contact.email || 'Unknown'
}

const CHANNEL_FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'voice', label: 'Calls' },
]

function timeAgo(dateStr: string | null) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
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
  const [showCompose, setShowCompose] = useState(false)
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const { data: conversations, loading, refetch: refetchConversations } = useConversations(channelFilter)
  const { session } = useAuth()

  const selected = conversations.find((c) => c.id === selectedId)

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase()
    const name = c.contact?.name?.toLowerCase() ?? ''
    const preview = c.last_message_preview?.toLowerCase() ?? ''
    const subject = c.subject?.toLowerCase() ?? ''
    const email = c.contact?.email?.toLowerCase() ?? ''
    return name.includes(q) || preview.includes(q) || subject.includes(q) || email.includes(q)
  })

  const handleSend = useCallback(async (conversationId: string, body: string, attachments?: File[]) => {
    const hasFiles = attachments && attachments.length > 0

    if (hasFiles) {
      const formData = new FormData()
      formData.append('conversationId', conversationId)
      formData.append('body', body)
      attachments.forEach((f) => formData.append('attachments', f))

      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('Send failed')
    } else {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ conversationId, body }),
      })
      if (!res.ok) throw new Error('Send failed')
    }
    refetchConversations()
  }, [session?.access_token, refetchConversations])

  if (selected && typeof window !== 'undefined' && window.innerWidth < 1024) {
    return (
      <div className="flex h-full flex-col">
        <ThreadView conversation={selected} reply={reply} setReply={setReply} onBack={() => setSelectedId(null)} onSend={handleSend} session={session} />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className={cn('flex w-full flex-col border-r border-border lg:w-[320px] lg:shrink-0', selected && 'hidden lg:flex')}>
        <div className="flex items-center justify-between px-4 pt-4">
          <h1 className="text-lg font-semibold text-ink">Inbox</h1>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[12px] font-semibold text-brand">
              {conversations.filter((c) => c.unread_count > 0).length} new
            </span>
            <button
              onClick={() => setShowCompose(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-600 transition"
              aria-label="Compose"
            >
              <Plus size={14} />
            </button>
          </div>
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

        <div className="mt-2 flex gap-1 px-4">
          {CHANNEL_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setChannelFilter(f.value); setSelectedId(null) }}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                channelFilter === f.value
                  ? 'bg-brand text-white'
                  : 'bg-elevated text-ink-muted hover:bg-brand/10 hover:text-brand'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-muted">No conversations yet</p>
          ) : (
            filtered.map((conv) => {
              const Icon = CHANNEL_ICON[conv.channel]
              const contactLabel = displayName(conv.contact)
              const hasRealName = conv.contact?.name != null && !isRawIdentifier(conv.contact.name)
              const contactPhone = conv.contact?.phone || conv.contact?.whatsapp
              const contactEmail = conv.contact?.email
              const unread = conv.unread_count > 0
              const isEmail = conv.channel === 'email'
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
                    <Avatar src={conv.contact?.avatar_url ?? undefined} name={contactLabel} size="sm" className="border-0" />
                    {unread && (
                      <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className={cn('truncate text-[13px] font-medium', unread ? 'text-ink' : 'text-ink-muted')}>
                          {contactLabel}
                        </p>
                        <Icon size={12} className={cn('shrink-0', CHANNEL_COLOR[conv.channel])} />
                      </div>
                      <span className="shrink-0 text-[10px] text-ink-subtle">{timeAgo(conv.last_message_at)}</span>
                    </div>

                    {hasRealName && contactPhone && !isEmail && (
                      <p className="truncate text-[10px] text-ink-subtle">{contactPhone}</p>
                    )}

                    {isEmail && contactEmail && (
                      <p className="truncate text-[10px] text-ink-subtle">{contactEmail}</p>
                    )}

                    {isEmail && conv.subject && (
                      <p className={cn('mt-0.5 truncate text-[11px] font-semibold', unread ? 'text-ink' : 'text-ink-muted')}>
                        {conv.subject}
                      </p>
                    )}

                    <p className={cn('mt-0.5 truncate text-[12px]', unread ? 'font-medium text-ink' : 'text-ink-muted')}>
                      {(conv.last_message_preview ?? 'No messages').replace(/\{\{?\d+@(lid|s\.whatsapp\.net)\}?\}?/g, '').trim() || 'No messages'}
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

      {/* Thread view */}
      <div className="hidden flex-1 lg:flex lg:flex-col">
        {selected ? (
          <ThreadView conversation={selected} reply={reply} setReply={setReply} onBack={() => setSelectedId(null)} onSend={handleSend} session={session} desktop />
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

      {/* Compose modal */}
      {showCompose && (
        <ComposeModal onClose={() => setShowCompose(false)} onSent={() => { setShowCompose(false); refetchConversations() }} />
      )}
    </div>
  )
}

function ThreadView({
  conversation,
  reply,
  setReply,
  onBack,
  onSend,
  desktop,
  session,
}: {
  conversation: Conversation
  reply: string
  setReply: (v: string) => void
  onBack: () => void
  onSend: (conversationId: string, body: string, attachments?: File[]) => Promise<void>
  desktop?: boolean
  session: { access_token: string } | null
}) {
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [localName, setLocalName] = useState<string | null>(null)
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null)
  const [editingDraftText, setEditingDraftText] = useState('')
  const [rewritingDraftId, setRewritingDraftId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const Icon = CHANNEL_ICON[conversation.channel]
  const contactName = localName ?? displayName(conversation.contact)
  const hasRealName = (localName != null && !isRawIdentifier(localName)) || (conversation.contact?.name != null && !isRawIdentifier(conversation.contact.name))
  const contactPhone = conversation.contact?.phone || conversation.contact?.whatsapp
  const contactEmail = conversation.contact?.email
  const isEmail = conversation.channel === 'email'
  const { data: messages, loading, refetch: refetchMessages } = useMessages(conversation.id)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [aiHandling, setAiHandling] = useState(conversation.ai_handling)

  useEffect(() => { setLocalName(null); setEditingName(false); setAiHandling(conversation.ai_handling) }, [conversation.id, conversation.ai_handling])

  async function toggleAI() {
    const next = !aiHandling
    setAiHandling(next)
    await supabase.from('conversations').update({ ai_handling: next }).eq('id', conversation.id)
  }

  async function saveContactName() {
    const trimmed = nameInput.trim()
    if (!trimmed || !conversation.contact_id) return
    setEditingName(false)
    setLocalName(trimmed)
    await supabase.from('contacts').update({ name: trimmed }).eq('id', conversation.contact_id)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSendReply() {
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      await onSend(conversation.id, reply.trim(), attachments.length > 0 ? attachments : undefined)
      setReply('')
      setAttachments([])
    } catch {
      // toast could go here
    } finally {
      setSending(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    setAttachments((prev) => [...prev, ...files])
    e.target.value = ''
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function approveDraft(messageId: string) {
    const res = await fetch('/api/messages/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ messageId }),
    })
    if (res.ok) refetchMessages()
  }

  async function discardDraft(messageId: string) {
    await supabase.from('messages').delete().eq('id', messageId)
    refetchMessages()
  }

  async function rewriteDraft(messageId: string) {
    setRewritingDraftId(messageId)
    try {
      const res = await fetch('/api/messages/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ messageId }),
      })
      if (res.ok) refetchMessages()
    } finally {
      setRewritingDraftId(null)
    }
  }

  async function saveEditedDraft(messageId: string) {
    const trimmed = editingDraftText.trim()
    if (!trimmed) return
    await supabase.from('messages').update({ body: trimmed }).eq('id', messageId)
    setEditingDraftId(null)
    refetchMessages()
  }

  function senderLabel(msg: Message): 'ai' | 'customer' | 'user' {
    if (msg.sender === 'contact') return 'customer'
    if (msg.sender === 'ai') return 'ai'
    return 'user'
  }

  // Group messages by date for date dividers
  let lastDate = ''

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          {!desktop && (
            <button onClick={onBack} className="text-brand">
              <ArrowLeft size={18} />
            </button>
          )}
          <Avatar src={conversation.contact?.avatar_url ?? undefined} name={contactName} size="sm" className="border-0" />
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  ref={nameInputRef}
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveContactName(); if (e.key === 'Escape') setEditingName(false) }}
                  placeholder="Enter name..."
                  className="h-6 w-full max-w-[180px] rounded border border-brand bg-white px-2 text-[13px] font-semibold text-ink outline-none focus:ring-2 focus:ring-brand/20"
                />
                <button onClick={saveContactName} className="rounded p-0.5 text-brand hover:bg-brand/10">
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingName(false)} className="rounded p-0.5 text-ink-subtle hover:bg-elevated">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <p className="text-[13px] font-semibold text-ink">{contactName}</p>
                <button
                  onClick={() => { setNameInput(isRawIdentifier(contactName) ? '' : contactName); setEditingName(true) }}
                  className="rounded p-0.5 text-ink-subtle hover:bg-elevated hover:text-ink"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Icon size={11} className={CHANNEL_COLOR[conversation.channel]} />
              {isEmail && contactEmail ? (
                <span className="truncate text-[11px] text-ink-subtle">{contactEmail}</span>
              ) : hasRealName && contactPhone ? (
                <span className="truncate text-[11px] text-ink-subtle">{contactPhone}</span>
              ) : (
                <span className="text-[11px] capitalize text-ink-subtle">{conversation.channel}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleAI}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                aiHandling ? 'bg-brand/10 text-brand' : 'bg-elevated text-ink-muted'
              )}
            >
              <Bot size={12} />
              {aiHandling ? 'AI On' : 'AI Off'}
            </button>
            <button className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        {isEmail && conversation.subject && (
          <p className="mt-1 text-[12px] font-semibold text-ink truncate">{conversation.subject}</p>
        )}
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-1.5 bg-surface/50">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">No messages yet</p>
        ) : (
          messages.map((msg) => {
            const meta = msg.metadata as Record<string, any> | undefined
            const msgDate = formatDate(msg.created_at)
            let showDate = false
            if (msgDate !== lastDate) {
              lastDate = msgDate
              showDate = true
            }

            const isDraft = msg.status === 'draft'

            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-full bg-elevated px-3 py-0.5 text-[10px] font-medium text-ink-subtle">
                      {msgDate}
                    </span>
                  </div>
                )}
                {isDraft && (
                  <div className="flex justify-end">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 mb-1">
                      Draft — review before sending
                    </span>
                  </div>
                )}
                <div className={isDraft ? 'rounded-xl border-2 border-dashed border-amber-300 p-1 w-fit ml-auto' : ''}>
                  {isDraft && editingDraftId === msg.id ? (
                    <div className="rounded-xl bg-brand/90 p-3">
                      <textarea
                        autoFocus
                        value={editingDraftText}
                        onChange={(e) => setEditingDraftText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingDraftId(null) }}
                        className="w-full min-h-[80px] rounded-lg bg-white/10 text-white text-[13px] p-2 resize-none outline-none placeholder:text-white/50"
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={() => setEditingDraftId(null)}
                          className="rounded-md px-3 py-1 text-[11px] font-medium text-white/70 hover:text-white transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEditedDraft(msg.id)}
                          className="rounded-md px-3 py-1 text-[11px] font-medium text-white bg-white/20 hover:bg-white/30 transition flex items-center gap-1"
                        >
                          <Check size={12} /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <MessageBubble
                      sender={senderLabel(msg)}
                      text={msg.body ?? ''}
                      timestamp={msg.created_at}
                      contactLabel={contactName}
                      mediaUrl={msg.media_url}
                      contentType={msg.content_type}
                      metadata={meta ? {
                        has_attachments: meta.has_attachments,
                        attachments: meta.attachments,
                        external_id: meta.external_id,
                        body_html: meta.body_html,
                        reactions: meta.reactions,
                      } : undefined}
                    />
                  )}
                </div>
                {isDraft && editingDraftId !== msg.id && (
                  <div className="flex justify-end gap-2 mt-1">
                    <button
                      onClick={() => discardDraft(msg.id)}
                      className="rounded-md px-3 py-1 text-[11px] font-medium text-ink-muted bg-elevated hover:bg-red-50 hover:text-red-600 transition"
                    >
                      Discard
                    </button>
                    <button
                      onClick={() => rewriteDraft(msg.id)}
                      disabled={rewritingDraftId === msg.id}
                      className="rounded-md p-1.5 text-ink-muted bg-elevated hover:bg-amber-50 hover:text-amber-600 transition disabled:opacity-50"
                      title="Rewrite"
                    >
                      <RefreshCw size={14} className={rewritingDraftId === msg.id ? 'animate-spin' : ''} />
                    </button>
                    <button
                      onClick={() => { setEditingDraftId(msg.id); setEditingDraftText(msg.body ?? '') }}
                      className="rounded-md p-1.5 text-ink-muted bg-elevated hover:bg-blue-50 hover:text-blue-600 transition"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => approveDraft(msg.id)}
                      className="rounded-md px-3 py-1 text-[11px] font-medium text-white bg-brand hover:bg-brand-600 transition"
                    >
                      Approve & Send
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply bar */}
      <div className="shrink-0 border-t border-border bg-white p-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md bg-elevated px-2 py-1 text-[11px] text-ink">
                <Paperclip size={10} className="shrink-0 text-ink-subtle" />
                <span className="max-w-[120px] truncate font-medium">{file.name}</span>
                <span className="text-ink-subtle">({formatSize(file.size)})</span>
                <button onClick={() => removeAttachment(i)} className="ml-0.5 rounded p-0.5 text-ink-subtle hover:bg-white hover:text-ink">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-elevated hover:text-ink"
            aria-label="Attach file"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendReply()
              }
            }}
            placeholder={isEmail ? 'Type an email reply...' : 'Type a reply...'}
            rows={isEmail ? 3 : 1}
            className="min-h-[36px] max-h-[120px] w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            disabled={!reply.trim() || sending}
            onClick={handleSendReply}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {sending ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-subtle">
          Replying via {conversation.channel} · {conversation.ai_handling ? "AI will auto-reply if you don't respond" : 'Manual mode'}
        </p>
      </div>
    </div>
  )
}

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const { session } = useAuth()

  async function handleSend() {
    if (!to.trim() || !body.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/messages/compose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body: body.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Send failed')
      }
      onSent()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">New Email</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To (email address)"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={6}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[13px] font-medium text-ink-muted hover:bg-elevated transition"
          >
            Cancel
          </button>
          <button
            disabled={!to.trim() || !body.trim() || sending}
            onClick={handleSend}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-600 transition disabled:opacity-40"
          >
            {sending ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send size={13} />
            )}
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
