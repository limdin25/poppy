import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Send,
  ArrowLeft,
  Sparkles,
  Check,
  RefreshCw,
  Pencil,
  Zap,
  UserPlus,
  MoreHorizontal,
  Plus,
  Loader2,
  X,
  Repeat,
  Ban,
  CheckCircle2,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { MessageBubble } from '@/core/ui/MessageBubble'
import { FilterChips } from '@/core/ui/FilterChips'
import { Switch } from '@/core/ui/Switch'
import { useConversations, useMessages } from '@/core/hooks/useConversations'
import { useQuickReplies, fillTokens, type QuickReply } from '@/core/hooks/useQuickReplies'
import { useTeamMembers, memberLabel } from '@/core/hooks/useTeamMembers'
import { DealModal } from '@/core/ui/DealModal'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Conversation, Message } from '@/core/types/database'

/**
 * Inbox — Elsie's "drafts a reply → you approve → it sends" flow.
 *   chat list   → useConversations(channelFilter)
 *   thread      → useMessages(conversationId)
 *   draft       → /api/messages/approve + /api/messages/rewrite
 *   composer    → /api/messages/send  (+ quick-reply insert)
 */

function isRawIdentifier(name: string | null | undefined): boolean {
  if (!name) return true
  if (name.includes('@lid') || name.includes('@s.whatsapp')) return true
  if (name === 'Unknown') return true
  const digitsOnly = name.replace(/[^0-9]/g, '')
  return digitsOnly.length >= 10 && digitsOnly.length === name.replace(/[+ ()-]/g, '').length
}

function displayName(conv: Conversation): string {
  if (conv.is_group && conv.group_name) return conv.group_name
  const contact = conv.contact
  if (!contact) return 'Unknown'
  if (contact.name && !isRawIdentifier(contact.name)) return contact.name
  return contact.phone || contact.whatsapp || contact.email || 'Unknown'
}

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

function cleanPreview(text: string | null | undefined): string {
  return (text ?? '').replace(/\{\{?\d+@(lid|s\.whatsapp\.net)\}?\}?/g, '').trim() || 'No messages'
}

function senderLabel(msg: Message): 'ai' | 'customer' | 'user' {
  if (msg.sender === 'contact') return 'customer'
  if (msg.sender === 'ai') return 'ai'
  return 'user'
}

export type InboxFolder = 'inbox' | 'unread' | 'mine' | 'team' | 'archived' | 'closed'

const FOLDER_LABELS: Record<InboxFolder, string> = {
  inbox: 'Inbox',
  unread: 'Unread',
  mine: 'Assigned to me',
  team: 'Assigned to team',
  archived: 'Archived',
  closed: 'Closed',
}

const FOLDER_ORDER: InboxFolder[] = ['inbox', 'unread', 'mine', 'team', 'archived', 'closed']

function inFolder(c: Conversation, folder: InboxFolder, uid: string | null): boolean {
  switch (folder) {
    case 'inbox':
      return c.status === 'open' || c.status === 'needs_handoff'
    case 'unread':
      return (c.unread_count ?? 0) > 0 && c.status !== 'archived'
    case 'mine':
      return !!uid && c.assigned_to === uid
    case 'team':
      return !!c.assigned_to && c.assigned_to !== uid
    case 'archived':
      return c.status === 'archived'
    case 'closed':
      return c.status === 'closed'
  }
}

function chLabelOf(channel: Conversation['channel']): string {
  return channel === 'whatsapp' ? 'WhatsApp'
    : channel === 'email' ? 'Email'
    : channel === 'sms' ? 'SMS'
    : channel === 'voice' ? 'Call'
    : 'Instagram'
}

type LeadLifecycle = 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
const STATUS_KEYS: LeadLifecycle[] = ['new', 'contacted', 'qualified', 'won', 'lost']
const STATUS_CFG: Record<LeadLifecycle, { label: string; badge: string; dot: string }> = {
  new:       { label: 'New',       badge: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400' },
  contacted: { label: 'Contacted', badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  qualified: { label: 'Qualified', badge: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
  won:       { label: 'Won',       badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  lost:      { label: 'Lost',      badge: 'bg-red-100 text-red-700',       dot: 'bg-red-500' },
}
function statusOf(c: Conversation): LeadLifecycle {
  const s = c.contact?.status ?? 'new'
  return (STATUS_KEYS as string[]).includes(s) ? (s as LeadLifecycle) : 'new'
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+|\./)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || '?'
  )
}

export default function InboxPage() {
  const [folder, setFolder] = useState<InboxFolder>('inbox')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: conversations, loading } = useConversations('all')
  const { session, user, businessId } = useAuth()
  const uid = user?.id ?? null

  // Add-lead modal (create a new contact from the inbox)
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [leadName, setLeadName] = useState('')
  const [leadPhone, setLeadPhone] = useState('')
  const [leadBusy, setLeadBusy] = useState(false)
  const [leadErr, setLeadErr] = useState<string | null>(null)
  const [leadMsg, setLeadMsg] = useState<string | null>(null)

  async function createLead() {
    if (!leadName.trim() && !leadPhone.trim()) { setLeadErr('Add a name or phone number.'); return }
    if (!businessId) { setLeadErr('No business found.'); return }
    setLeadBusy(true); setLeadErr(null)
    const { error } = await supabase.from('contacts').insert({
      business_id: businessId,
      name: leadName.trim() || null,
      phone: leadPhone.trim() || null,
      whatsapp: leadPhone.trim() || null,
      status: 'new',
    } as never)
    setLeadBusy(false)
    if (error) { setLeadErr(error.message); return }
    setLeadName(''); setLeadPhone('')
    setLeadMsg('Lead added — find them under Leads.')
  }

  const counts: Record<InboxFolder, number> = { inbox: 0, unread: 0, mine: 0, team: 0, archived: 0, closed: 0 }
  for (const c of conversations) {
    for (const f of FOLDER_ORDER) if (inFolder(c, f, uid)) counts[f]++
  }
  const visible = conversations.filter((c) => inFolder(c, folder, uid))

  // Deep-link from Leads "View Chat": ?contact=<id> → open that contact's chat.
  useEffect(() => {
    const contactId = searchParams.get('contact')
    if (!contactId || !conversations.length) return
    const match = conversations.find((c) => c.contact_id === contactId)
    if (match) setSelectedId(match.id)
    searchParams.delete('contact')
    setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, searchParams])

  const selected = conversations.find((c) => c.id === selectedId) ?? null

  return (
    <div className="h-full p-4 sm:p-6">
      <div className="flex h-full overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        {/* Left: chat list */}
        <aside
          className={cn(
            'flex w-full shrink-0 flex-col border-r border-border bg-surface lg:w-[360px]',
            selected && 'hidden lg:flex'
          )}
        >
          <div className="space-y-3 border-b border-border px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold tracking-tight text-ink">{FOLDER_LABELS[folder]}</h2>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                  {visible.length}
                </span>
                <button
                  onClick={() => { setAddLeadOpen(true); setLeadErr(null); setLeadMsg(null) }}
                  title="Add a new lead"
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-[12px] font-semibold text-white transition hover:opacity-90"
                >
                  <Plus size={14} /> New
                </button>
              </div>
            </div>
            <FilterChips
              options={FOLDER_ORDER.map((f) => ({ value: f, label: FOLDER_LABELS[f], count: counts[f] }))}
              value={folder}
              onChange={(v) => { setFolder(v as InboxFolder); setSelectedId(null) }}
            />
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-ink-muted">No conversations here</p>
            ) : (
              visible.map((c) => {
                const name = displayName(c)
                const chLabel = chLabelOf(c.channel)
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-elevated/50',
                      c.id === selectedId && 'bg-elevated/60'
                    )}
                  >
                    <Avatar src={c.contact?.avatar_url ?? undefined} name={name} channel={c.channel} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13.5px] font-medium text-ink">{name}</p>
                        <span className="shrink-0 text-[11px] text-ink-subtle">{timeAgo(c.last_message_at)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-muted">
                        {cleanPreview(c.last_message_preview)}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10.5px] font-medium text-ink-subtle">via {chLabel}</span>
                        {c.contact?.status && c.contact.status !== 'new' && (
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold', STATUS_CFG[statusOf(c)].badge)}>
                            {STATUS_CFG[statusOf(c)].label}
                          </span>
                        )}
                        {c.unread_count > 0 && (
                          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-whatsapp px-1 text-[10px] font-semibold text-white">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Right: thread */}
        <section className={cn('flex min-w-0 flex-1 flex-col bg-page', !selected && 'hidden lg:flex')}>
          {selected ? (
            <ThreadView
              key={selected.id}
              conversation={selected}
              onBack={() => setSelectedId(null)}
              onArchived={() => setSelectedId(null)}
              session={session}
              userId={user?.id ?? null}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="text-[15px] text-ink-muted">Select a conversation to start chatting</p>
            </div>
          )}
        </section>
      </div>

      <Dialog open={addLeadOpen} onClose={() => !leadBusy && setAddLeadOpen(false)} width="sm">
        <DialogHeader>Add a new lead</DialogHeader>
        <DialogBody className="space-y-3">
          {leadMsg ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">{leadMsg}</div>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Name</label>
            <input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="e.g. Jane Smith" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Phone (WhatsApp)</label>
            <input value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder="+44…" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>
          {leadErr && <p className="text-[12.5px] text-red-600">{leadErr}</p>}
        </DialogBody>
        <DialogFooter>
          <button onClick={() => setAddLeadOpen(false)} disabled={leadBusy} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-elevated disabled:opacity-40">Close</button>
          <button onClick={() => void createLead()} disabled={leadBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {leadBusy && <Loader2 size={14} className="animate-spin" />}{leadBusy ? 'Adding…' : 'Add lead'}
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function ThreadView({
  conversation,
  onBack,
  onArchived,
  session,
  userId,
}: {
  conversation: Conversation
  onBack: () => void
  onArchived: () => void
  session: { access_token: string } | null
  userId: string | null
}) {
  const [composer, setComposer] = useState('')
  const [showQuick, setShowQuick] = useState(false)
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [showFollowups, setShowFollowups] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [assignedTo, setAssignedTo] = useState<string | null>(conversation.assigned_to)
  const [assignOpen, setAssignOpen] = useState(false)
  const [aiOn, setAiOn] = useState(conversation.ai_handling !== false)
  const [status, setStatus] = useState<LeadLifecycle>(statusOf(conversation))
  const menuRef = useRef<HTMLDivElement>(null)
  const assignRef = useRef<HTMLDivElement>(null)
  const { data: teamMembers } = useTeamMembers()
  const assignable = teamMembers.filter((m) => m.user_id)
  const assignedMember = teamMembers.find((m) => m.user_id === assignedTo) ?? null
  const messagesEndRef = useRef<HTMLDivElement>(null)

  async function toggleAi() {
    const next = !aiOn
    setAiOn(next)
    await supabase.from('conversations').update({ ai_handling: next }).eq('id', conversation.id)
  }
  async function changeStatus(next: LeadLifecycle) {
    setStatus(next)
    if (conversation.contact_id) {
      await supabase.from('contacts').update({ status: next }).eq('id', conversation.contact_id)
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  useEffect(() => {
    if (!assignOpen) return
    function onDoc(e: MouseEvent) { if (assignRef.current && !assignRef.current.contains(e.target as Node)) setAssignOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [assignOpen])

  async function assignTo(memberUserId: string | null) {
    setAssignOpen(false)
    setAssignedTo(memberUserId)
    await supabase.from('conversations').update({ assigned_to: memberUserId }).eq('id', conversation.id)
  }
  async function markSpam() {
    setMenuOpen(false)
    await supabase.from('conversations').update({ is_spam: true }).eq('id', conversation.id)
    onArchived()
  }
  async function resolveConversation() {
    setMenuOpen(false)
    await supabase.from('conversations').update({ status: 'closed' }).eq('id', conversation.id)
    onArchived()
  }
  async function reopenConversation() {
    setMenuOpen(false)
    await supabase.from('conversations').update({ status: 'open' }).eq('id', conversation.id)
  }

  const { data: messages, loading, refetch: refetchMessages } = useMessages(conversation.id)
  const name = displayName(conversation)

  // Latest message that is a pending AI draft (per old page: status === 'draft').
  const draftMsg = [...messages].reverse().find((m) => m.status === 'draft') ?? null

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = useCallback(async () => {
    const body = composer.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ conversationId: conversation.id, body }),
      })
      if (!res.ok) throw new Error('Send failed')
      setComposer('')
      refetchMessages()
    } catch {
      setError('Could not send message. Please try again.')
    } finally {
      setSending(false)
    }
  }, [composer, sending, session?.access_token, conversation.id, refetchMessages])

  const approveDraft = useCallback(async (messageId: string) => {
    setApproving(true)
    setError('')
    try {
      const res = await fetch('/api/messages/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ messageId }),
      })
      if (!res.ok) throw new Error('Approve failed')
      refetchMessages()
    } catch {
      setError('Could not send the draft. Please try again.')
    } finally {
      setApproving(false)
    }
  }, [session?.access_token, refetchMessages])

  const rewriteDraft = useCallback(async (messageId: string) => {
    setRewriting(true)
    setError('')
    try {
      const res = await fetch('/api/messages/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ messageId }),
      })
      if (!res.ok) throw new Error('Rewrite failed')
      refetchMessages()
    } catch {
      setError('Could not rewrite the draft. Please try again.')
    } finally {
      setRewriting(false)
    }
  }, [session?.access_token, refetchMessages])

  return (
    <>
      {/* Thread header */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1 text-ink-muted hover:bg-elevated lg:hidden">
          <ArrowLeft size={18} />
        </button>
        <Avatar src={conversation.contact?.avatar_url ?? undefined} name={name} channel={conversation.channel} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
          <p className="text-[11.5px] text-ink-subtle">
            via {chLabelOf(conversation.channel)}{conversation.status === 'needs_handoff' ? ' · needs handoff' : ''}
          </p>
        </div>
        <button
          onClick={() => setDealOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
          title="Add a deal from this conversation"
        >
          <Plus size={15} /> <span className="hidden sm:inline">Deal</span>
        </button>
        <div ref={assignRef} className="relative">
          <button
            onClick={() => setAssignOpen((o) => !o)}
            className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition hover:bg-elevated', assignedMember ? 'text-accent' : 'text-ink-muted')}
            title="Assign conversation"
          >
            {assignedMember ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 text-[9px] font-semibold text-brand-700">
                {initialsOf(memberLabel(assignedMember))}
              </span>
            ) : (
              <UserPlus size={17} />
            )}
            <span className="hidden max-w-[90px] truncate sm:inline">{assignedMember ? memberLabel(assignedMember) : 'Assign'}</span>
          </button>
          {assignOpen && (
            <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop">
              <button onClick={() => void assignTo(null)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-elevated">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-ink-subtle"><X size={11} /></span>
                Unassigned
              </button>
              {assignable.map((m) => (
                <button
                  key={m.id}
                  onClick={() => void assignTo(m.user_id)}
                  className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-elevated', assignedTo === m.user_id ? 'text-accent' : 'text-ink')}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 text-[9px] font-semibold text-brand-700">
                    {initialsOf(memberLabel(m))}
                  </span>
                  <span className="flex-1 truncate">{memberLabel(m)}{m.user_id === userId ? ' (you)' : ''}</span>
                  {assignedTo === m.user_id && <Check size={13} />}
                </button>
              ))}
              {assignable.length === 0 && (
                <p className="px-3 py-2 text-[12px] text-ink-subtle">Invite teammates in Account → Team</p>
              )}
            </div>
          )}
        </div>
        <div ref={menuRef} className="relative">
          <button onClick={() => setMenuOpen((o) => !o)} className="rounded-lg p-2 text-ink-muted hover:bg-elevated" title="More">
            <MoreHorizontal size={17} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop">
              {conversation.status === 'closed' ? (
                <button onClick={() => void reopenConversation()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-elevated">
                  <RotateCcw size={14} /> Reopen
                </button>
              ) : (
                <button onClick={() => void resolveConversation()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-elevated">
                  <CheckCircle2 size={14} /> Mark resolved
                </button>
              )}
              <button onClick={() => void markSpam()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-red-600 hover:bg-red-50">
                <Ban size={14} /> Mark as spam
              </button>
            </div>
          )}
        </div>
      </header>

      {showFollowups && (
        <FollowupsPanel conversation={conversation} contactName={name} onClose={() => setShowFollowups(false)} />
      )}

      <DealModal
        open={dealOpen}
        onClose={() => setDealOpen(false)}
        prefill={{
          contactId: conversation.contact_id,
          conversationId: conversation.id,
          title: name && name !== 'Unknown' ? `Deal — ${name}` : '',
        }}
      />

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin px-4 py-5">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink-muted">No messages yet</p>
        ) : (
          messages
            .filter((m) => m.status !== 'draft')
            .map((m) => (
              <MessageBubble
                key={m.id}
                sender={senderLabel(m)}
                text={m.body ?? ''}
                timestamp={m.created_at}
                contactLabel={conversation.is_group && m.sender_name ? m.sender_name : name}
                mediaUrl={m.media_url}
                contentType={m.content_type}
                metadata={
                  m.metadata
                    ? {
                        has_attachments: (m.metadata as any).has_attachments,
                        attachments: (m.metadata as any).attachments,
                        external_id: (m.metadata as any).external_id,
                        body_html: (m.metadata as any).body_html,
                        reactions: (m.metadata as any).reactions,
                      }
                    : undefined
                }
              />
            ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <p className="mx-4 mb-1 text-[12px] text-red-500">{error}</p>
      )}

      {/* Draft banner — Elsie's pending reply (differentiator) */}
      {draftMsg && (
        <div className="mx-4 mb-2 rounded-xl border border-violet-200 border-l-4 border-l-violet-500 bg-violet-50 p-3 shadow-soft">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles size={14} className="text-violet-600" />
            <span className="text-[12px] font-semibold text-violet-700">Elsie drafted a reply</span>
            <span className="ml-auto text-[10.5px] text-violet-500">Review before it sends</span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink">{draftMsg.body}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              onClick={() => approveDraft(draftMsg.id)}
              disabled={approving || rewriting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {approving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Approve & send
            </button>
            <button
              onClick={() => rewriteDraft(draftMsg.id)}
              disabled={approving || rewriting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-elevated disabled:opacity-50"
            >
              <RefreshCw size={14} className={rewriting ? 'animate-spin' : ''} /> Rewrite
            </button>
            <button
              onClick={() => setComposer(draftMsg.body ?? '')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-elevated"
            >
              <Pencil size={14} /> Edit
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="relative border-t border-border bg-surface px-4 py-3">
        {showQuick && (
          <QuickReplyPicker
            contactName={name}
            onInsert={(text) => {
              setComposer(text)
              setShowQuick(false)
            }}
            onClose={() => setShowQuick(false)}
          />
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void toggleAi()}
            title={aiOn ? 'Elsie auto-replies to this chat — click to pause the AI' : 'AI is paused — click to let Elsie auto-reply'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition',
              aiOn ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-elevated text-ink-muted hover:bg-border',
            )}
          >
            <Sparkles size={13} /> AI {aiOn ? 'on' : 'off'}
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-[11.5px] font-medium text-ink-muted">
            <span className={cn('h-2 w-2 rounded-full', STATUS_CFG[status].dot)} />
            <select
              value={status}
              onChange={(e) => void changeStatus(e.target.value as LeadLifecycle)}
              title="Lead status"
              className="bg-transparent text-ink outline-none"
            >
              {STATUS_KEYS.map((s) => <option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
            </select>
          </span>
          <button
            onClick={() => setShowFollowups((s) => !s)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition',
              showFollowups ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:bg-border',
            )}
          >
            <Repeat size={13} /> Follow-up
          </button>
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={() => setShowQuick((s) => !s)}
            title="Insert quick reply"
            className={cn(
              'mb-0.5 rounded-lg p-2 text-ink-muted hover:bg-elevated',
              showQuick && 'bg-elevated text-ink'
            )}
          >
            <Zap size={18} />
          </button>
          <textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            placeholder="Type a message…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-border bg-page px-3 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/40"
          />
          <button
            disabled={!composer.trim() || sending}
            onClick={handleSend}
            className="mb-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {sending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send size={17} />
            )}
          </button>
        </div>
      </div>
    </>
  )
}

interface Sequence { id: string; name: string; steps: unknown[] }
interface Scheduled { id: string; step_index: number; send_at: string; status: string }

/**
 * Per-conversation follow-up scheduling. Toggle follow-ups on/off, pick a
 * sequence, schedule the next step now, see what's queued, and cancel pending
 * ones. Backed by followup_sequences + scheduled_followups (sent by cron).
 */
function FollowupsPanel({
  conversation,
  contactName,
  onClose,
}: {
  conversation: Conversation
  contactName: string
  onClose: () => void
}) {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [scheduled, setScheduled] = useState<Scheduled[]>([])
  const [enabled, setEnabled] = useState(!!conversation.followups_enabled)
  const [sequenceId, setSequenceId] = useState<string | null>(conversation.followup_sequence_id)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadScheduled = useCallback(async () => {
    const { data } = await supabase
      .from('scheduled_followups')
      .select('id, step_index, send_at, status')
      .eq('conversation_id', conversation.id)
      .order('send_at', { ascending: true })
    setScheduled((data as Scheduled[]) ?? [])
  }, [conversation.id])

  useEffect(() => {
    let active = true
    ;(async () => {
      const [{ data: seqs }] = await Promise.all([
        supabase.from('followup_sequences').select('id, name, steps').eq('business_id', conversation.business_id).order('created_at'),
        loadScheduled(),
      ])
      if (!active) return
      const list = (seqs as Sequence[]) ?? []
      setSequences(list)
      if (!sequenceId && list[0]) setSequenceId(list[0].id)
      setLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.business_id])

  async function toggleEnabled(next: boolean) {
    setEnabled(next)
    await supabase.from('conversations').update({ followups_enabled: next }).eq('id', conversation.id)
  }
  async function pickSequence(id: string) {
    setSequenceId(id)
    await supabase.from('conversations').update({ followup_sequence_id: id }).eq('id', conversation.id)
  }
  async function scheduleNow() {
    if (!sequenceId) return
    setBusy(true)
    const pendingCount = scheduled.filter((s) => s.status === 'pending').length
    await supabase.from('scheduled_followups').insert({
      conversation_id: conversation.id,
      sequence_id: sequenceId,
      step_index: pendingCount,
      send_at: new Date().toISOString(),
      status: 'pending',
    })
    await loadScheduled()
    setBusy(false)
  }
  async function cancelPending() {
    setBusy(true)
    await supabase.from('scheduled_followups').update({ status: 'cancelled' }).eq('conversation_id', conversation.id).eq('status', 'pending')
    await loadScheduled()
    setBusy(false)
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const pendingCount = scheduled.filter((s) => s.status === 'pending').length

  return (
    <div className="border-b border-border bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat size={14} className="text-ink-muted" />
          <span className="text-[12.5px] font-semibold text-ink">Follow-ups for {contactName}</span>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink"><X size={14} /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-ink-muted" /></div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-muted">Auto follow-ups for this chat</span>
            <Switch checked={enabled} onChange={(n) => void toggleEnabled(n)} />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sequenceId ?? ''}
              onChange={(e) => void pickSequence(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-page px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-ink-subtle/40"
            >
              {sequences.length === 0 && <option value="">No sequences</option>}
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              onClick={() => void scheduleNow()}
              disabled={busy || !sequenceId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Schedule now
            </button>
          </div>

          {scheduled.length > 0 ? (
            <ul className="space-y-1">
              {scheduled.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg bg-page px-2.5 py-1.5 text-[12px]">
                  <span className="text-ink-muted">Step {s.step_index + 1} · {fmt(s.send_at)}</span>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10.5px] font-medium',
                    s.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : s.status === 'cancelled' ? 'bg-elevated text-ink-subtle' : 'bg-amber-50 text-amber-700')}>
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-ink-subtle">Nothing scheduled yet.</p>
          )}

          {pendingCount > 0 && (
            <button onClick={() => void cancelPending()} disabled={busy} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-red-600 hover:underline disabled:opacity-50">
              <Trash2 size={12} /> Cancel {pendingCount} pending
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Composer quick-reply picker. Reads/writes real quick_replies (business-scoped)
 * via useQuickReplies — the same store as the Templates page. Selecting a reply
 * inserts its body with {name} filled in. Inline form lets you add/edit a reply
 * without leaving the Inbox.
 */
function QuickReplyPicker({
  contactName,
  onInsert,
  onClose,
}: {
  contactName: string
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const { data: replies, loading, create, update } = useQuickReplies()
  // null = list view; otherwise the inline form draft (id null = new).
  const [editing, setEditing] = useState<{ id: string | null; title: string; body: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function saveDraft() {
    if (!editing || saving) return
    const title = editing.title.trim()
    const body = editing.body.trim()
    if (!title || !body) return
    setSaving(true)
    if (editing.id) await update(editing.id, title, body)
    else await create(title, body)
    setSaving(false)
    setEditing(null)
  }

  return (
    <div className="absolute bottom-full left-4 z-10 mb-2 w-80 rounded-xl border border-border bg-surface p-1.5 shadow-pop">
      {editing ? (
        <div className="space-y-2 p-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {editing.id ? 'Edit reply' : 'New reply'}
            </p>
            <button
              onClick={() => setEditing(null)}
              className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink"
              title="Back"
            >
              <X size={14} />
            </button>
          </div>
          <input
            value={editing.title}
            onChange={(e) => setEditing((d) => (d ? { ...d, title: e.target.value } : d))}
            placeholder="Title"
            autoFocus
            className="h-9 w-full rounded-lg border border-border bg-page px-2.5 text-[12.5px] text-ink outline-none focus:border-ink-subtle/40"
          />
          <textarea
            value={editing.body}
            onChange={(e) => setEditing((d) => (d ? { ...d, body: e.target.value } : d))}
            rows={3}
            placeholder="Message. Use {name} for the customer's name."
            className="w-full resize-none rounded-lg border border-border bg-page px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-ink-subtle/40"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              onClick={saveDraft}
              disabled={saving || !editing.title.trim() || !editing.body.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle">Quick replies</p>
            <button
              onClick={() => setEditing({ id: null, title: '', body: '' })}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-elevated"
            >
              <Plus size={12} /> New
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={16} className="animate-spin text-ink-muted" />
              </div>
            ) : replies.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12px] text-ink-muted">
                No quick replies yet. Tap “New” to add one.
              </p>
            ) : (
              replies.map((q: QuickReply) => (
                <div key={q.id} className="group/qr relative flex items-start">
                  <button
                    onClick={() => onInsert(fillTokens(q.body, contactName))}
                    className="block min-w-0 flex-1 rounded-lg px-2 py-1.5 pr-8 text-left hover:bg-elevated"
                  >
                    <p className="text-[12.5px] font-medium text-ink">{q.title}</p>
                    <p className="truncate text-[11.5px] text-ink-muted">{q.body}</p>
                  </button>
                  <button
                    onClick={() => setEditing({ id: q.id, title: q.title, body: q.body })}
                    className="absolute right-1.5 top-1.5 rounded-md p-1 text-ink-subtle opacity-0 transition hover:bg-surface hover:text-ink group-hover/qr:opacity-100"
                    title={`Edit ${q.title}`}
                    aria-label={`Edit ${q.title}`}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 block w-full rounded-lg px-2 py-1.5 text-center text-[11px] font-medium text-ink-subtle hover:bg-elevated"
          >
            Close
          </button>
        </>
      )}
    </div>
  )
}
