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
  Archive,
  ChevronDown,
  Coins,
  StickyNote,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { MessageBubble } from '@/core/ui/MessageBubble'
import { FilterChips } from '@/core/ui/FilterChips'
import { Switch } from '@/core/ui/Switch'
import { useConversations, useMessages } from '@/core/hooks/useConversations'
import { useQuickReplies, fillTokens, type QuickReply } from '@/core/hooks/useQuickReplies'
import { useTeamMembers, memberLabel } from '@/core/hooks/useTeamMembers'
import { useDeals, usePipelineStages } from '@/core/hooks/usePipeline'
import { useCurrency } from '@/core/hooks/useCurrency'
import { formatMoney, currencySymbol } from '@/core/lib/currency'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Conversation, Message, Deal, PipelineStage } from '@/core/types/database'

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

type AiMode = 'draft' | 'auto' | 'off'
const AI_MODE_LABEL: Record<AiMode, string> = { draft: 'Draft & approve', auto: 'Auto-send', off: 'Off' }

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

// One status taxonomy across the app = the pipeline stage (a chat's status = its deal's stage).
const STAGE_TINT: Record<string, { badge: string; dot: string }> = {
  slate:   { badge: 'bg-slate-100 text-slate-700',   dot: 'bg-slate-400' },
  blue:    { badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  violet:  { badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  amber:   { badge: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
  orange:  { badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  emerald: { badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  red:     { badge: 'bg-red-100 text-red-700',       dot: 'bg-red-500' },
  pink:    { badge: 'bg-pink-100 text-pink-700',     dot: 'bg-pink-500' },
  cyan:    { badge: 'bg-cyan-100 text-cyan-700',     dot: 'bg-cyan-500' },
}
const tintOf = (color: string | undefined) => STAGE_TINT[color ?? 'slate'] ?? STAGE_TINT.slate


function countdownTo(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'due'
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
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
  const currency = useCurrency()

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

  // Global AI reply mode (across the business's channels) — "turn all on/off"
  const [aiMode, setAiMode] = useState<AiMode | null>(null)
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const aiMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!businessId) return
    supabase.from('channels').select('auto_reply_enabled, draft_mode').eq('business_id', businessId).then(({ data }) => {
      if (!data || !data.length) { setAiMode('draft'); return }
      if (!data.some((c: any) => c.auto_reply_enabled)) setAiMode('off')
      else if (data.some((c: any) => c.draft_mode)) setAiMode('draft')
      else setAiMode('auto')
    })
  }, [businessId])
  useEffect(() => {
    if (!aiMenuOpen) return
    function onDoc(e: MouseEvent) { if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) setAiMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aiMenuOpen])
  async function setAllAi(mode: AiMode) {
    setAiMode(mode); setAiMenuOpen(false)
    if (!businessId) return
    const patch = mode === 'off' ? { auto_reply_enabled: false } : { auto_reply_enabled: true, draft_mode: mode === 'draft' }
    await supabase.from('channels').update(patch).eq('business_id', businessId)
  }

  // Card quick-actions (realtime refreshes the list afterwards)
  async function quickArchive(c: Conversation) {
    const next = c.status === 'archived' ? 'open' : 'archived'
    await supabase.from('conversations').update({ status: next }).eq('id', c.id)
  }
  async function quickResolve(c: Conversation) {
    const next = c.status === 'closed' ? 'open' : 'closed'
    await supabase.from('conversations').update({ status: next }).eq('id', c.id)
  }

  const counts: Record<InboxFolder, number> = { inbox: 0, unread: 0, mine: 0, team: 0, archived: 0, closed: 0 }
  for (const c of conversations) {
    for (const f of FOLDER_ORDER) if (inFolder(c, f, uid)) counts[f]++
  }
  const visible = conversations.filter((c) => inFolder(c, folder, uid))

  // Deals linked to chats — show stage label + value on the card
  const { data: deals, refetch: refetchDeals } = useDeals()
  const { data: pipelineStages } = usePipelineStages()
  const stageName = (id: string | null) => pipelineStages.find((s) => s.id === id)?.name ?? 'Lead In'
  const stageColorOf = (id: string | null) => pipelineStages.find((s) => s.id === id)?.color
  const dealByConvId: Record<string, typeof deals[number]> = {}
  const dealByContactId: Record<string, typeof deals[number]> = {}
  for (const d of deals) {
    if (d.conversation_id && (!dealByConvId[d.conversation_id] || d.value > dealByConvId[d.conversation_id].value)) dealByConvId[d.conversation_id] = d
    if (d.contact_id && (!dealByContactId[d.contact_id] || d.value > dealByContactId[d.contact_id].value)) dealByContactId[d.contact_id] = d
  }
  const dealFor = (c: Conversation) => dealByConvId[c.id] ?? (c.contact_id ? dealByContactId[c.contact_id] : undefined)

  // Next pending follow-up per conversation (for the countdown badge on cards)
  const [followupDue, setFollowupDue] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!conversations.length) { setFollowupDue({}); return }
    const ids = conversations.map((c) => c.id)
    supabase.from('scheduled_followups').select('conversation_id, send_at').eq('status', 'pending').in('conversation_id', ids)
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const r of (data ?? []) as { conversation_id: string; send_at: string }[]) {
          if (!map[r.conversation_id] || r.send_at < map[r.conversation_id]) map[r.conversation_id] = r.send_at
        }
        setFollowupDue(map)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations])

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
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-ink-subtle">Elsie replies (all chats)</span>
              <div ref={aiMenuRef} className="relative">
                <button
                  onClick={() => setAiMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11.5px] font-medium text-ink transition hover:bg-elevated"
                >
                  <Sparkles size={12} className="text-violet-600" /> {AI_MODE_LABEL[aiMode ?? 'draft']} <ChevronDown size={12} />
                </button>
                {aiMenuOpen && (
                  <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-border bg-surface py-1 shadow-pop">
                    {(['draft', 'auto', 'off'] as AiMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => void setAllAi(m)}
                        className={cn('flex w-full items-center justify-between px-3 py-2 text-left text-[12px] hover:bg-elevated', aiMode === m ? 'font-semibold text-accent' : 'text-ink')}
                      >
                        <span>
                          {AI_MODE_LABEL[m]}
                          <span className="block text-[10.5px] font-normal text-ink-subtle">
                            {m === 'draft' ? 'Elsie drafts, you approve' : m === 'auto' ? 'Elsie sends automatically' : 'You reply manually'}
                          </span>
                        </span>
                        {aiMode === m && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
                const deal = dealFor(c)
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(c.id) }}
                    className={cn(
                      'group relative flex w-full cursor-pointer items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-elevated/50',
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
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] font-medium text-ink-subtle">via {chLabel}</span>
                        {deal && (
                          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', tintOf(stageColorOf(deal.stage_id)).badge)} title={`Deal: ${deal.title}`}>
                            {stageName(deal.stage_id)} · {formatMoney(deal.value, currency)}
                          </span>
                        )}
                        {followupDue[c.id] && (
                          <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700" title="Next follow-up">
                            <Repeat size={10} /> {countdownTo(followupDue[c.id])}
                          </span>
                        )}
                        {c.unread_count > 0 && (
                          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-whatsapp px-1 text-[10px] font-semibold text-white">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* hover quick-actions */}
                    <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-lg border border-border bg-surface p-0.5 shadow-soft group-hover:flex">
                      <button
                        onClick={(e) => { e.stopPropagation(); void quickResolve(c) }}
                        title={c.status === 'closed' ? 'Reopen' : 'Mark resolved'}
                        className={cn('rounded-md p-1.5 hover:bg-elevated', c.status === 'closed' ? 'text-emerald-600' : 'text-ink-subtle hover:text-emerald-600')}
                      >
                        <CheckCircle2 size={15} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void quickArchive(c) }}
                        title={c.status === 'archived' ? 'Unarchive' : 'Archive'}
                        className={cn('rounded-md p-1.5 hover:bg-elevated', c.status === 'archived' ? 'text-accent' : 'text-ink-subtle hover:text-ink')}
                      >
                        <Archive size={15} />
                      </button>
                    </div>
                  </div>
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
              deal={dealFor(selected) ?? null}
              stages={pipelineStages}
              onDealSaved={refetchDeals}
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
  deal,
  stages,
  onDealSaved,
}: {
  conversation: Conversation
  onBack: () => void
  onArchived: () => void
  session: { access_token: string } | null
  userId: string | null
  deal: Deal | null
  stages: PipelineStage[]
  onDealSaved?: () => void
}) {
  const [composer, setComposer] = useState('')
  const [showQuick, setShowQuick] = useState(false)
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [error, setError] = useState('')
  const [editingDraft, setEditingDraft] = useState(false)
  const [draftEdit, setDraftEdit] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showFollowups, setShowFollowups] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [dealValueOpen, setDealValueOpen] = useState(false)
  const [dealValueInput, setDealValueInput] = useState('')
  const [assignedTo, setAssignedTo] = useState<string | null>(conversation.assigned_to)
  const [assignOpen, setAssignOpen] = useState(false)
  const [aiOn, setAiOn] = useState(conversation.ai_handling !== false)
  const [stageId, setStageId] = useState<string | null>(deal?.stage_id ?? null)
  const menuRef = useRef<HTMLDivElement>(null)
  const assignRef = useRef<HTMLDivElement>(null)
  const { data: teamMembers } = useTeamMembers()
  const dealCurrency = useCurrency()
  const assignable = teamMembers.filter((m) => m.user_id)
  const assignedMember = teamMembers.find((m) => m.user_id === assignedTo) ?? null
  const messagesEndRef = useRef<HTMLDivElement>(null)

  async function toggleAi() {
    const next = !aiOn
    setAiOn(next)
    await supabase.from('conversations').update({ ai_handling: next }).eq('id', conversation.id)
  }
  // Keep the stage picker in sync if the linked deal changes elsewhere
  useEffect(() => { setStageId(deal?.stage_id ?? null) }, [deal?.stage_id])

  // The chat's "status" IS its deal's stage. Changing it moves the deal (or creates one).
  async function changeStage(next: string) {
    setStageId(next)
    if (deal) {
      await supabase.from('deals').update({ stage_id: next, updated_at: new Date().toISOString() }).eq('id', deal.id)
    } else {
      const dn = displayName(conversation)
      await supabase.from('deals').insert({
        business_id: conversation.business_id,
        title: dn && dn !== 'Unknown' ? `Deal — ${dn}` : 'New deal',
        value: 0,
        currency: dealCurrency,
        stage_id: next,
        contact_id: conversation.contact_id,
        conversation_id: conversation.id,
      } as never)
    }
    onDealSaved?.()
  }

  async function saveDealValue() {
    setDealValueOpen(false)
    const n = Number(dealValueInput.replace(/[^0-9.]/g, '')) || 0
    if (deal) {
      await supabase.from('deals').update({ value: n, updated_at: new Date().toISOString() }).eq('id', deal.id)
    } else {
      const dn = displayName(conversation)
      await supabase.from('deals').insert({
        business_id: conversation.business_id,
        title: dn && dn !== 'Unknown' ? `Deal — ${dn}` : 'New deal',
        value: n,
        currency: dealCurrency,
        stage_id: stageId || stages[0]?.id || null,
        contact_id: conversation.contact_id,
        conversation_id: conversation.id,
      } as never)
    }
    onDealSaved?.()
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
  async function archiveConversation() {
    setMenuOpen(false)
    const next = conversation.status === 'archived' ? 'open' : 'archived'
    await supabase.from('conversations').update({ status: next }).eq('id', conversation.id)
    if (next === 'archived') onArchived()
  }

  const { data: messages, loading, refetch: refetchMessages } = useMessages(conversation.id)
  const name = displayName(conversation)

  // Latest message that is a pending AI draft (per old page: status === 'draft').
  const draftMsg = [...messages].reverse().find((m) => m.status === 'draft') ?? null

  // Jump straight to the latest message when a chat opens (re-runs as media/layout settles).
  useEffect(() => {
    if (loading) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    const t1 = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 150)
    const t2 = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, loading])

  // Follow new messages while viewing the thread.
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
      // If a pending AI draft existed, the user just sent their own reply instead — clear it.
      if (draftMsg) await supabase.from('messages').delete().eq('id', draftMsg.id)
      setComposer('')
      refetchMessages()
    } catch {
      setError('Could not send message. Please try again.')
    } finally {
      setSending(false)
    }
  }, [composer, sending, session?.access_token, conversation.id, refetchMessages, draftMsg])

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

  async function saveDraftEdit(messageId: string) {
    setSavingDraft(true)
    await supabase.from('messages').update({ body: draftEdit }).eq('id', messageId)
    setSavingDraft(false)
    setEditingDraft(false)
    refetchMessages()
  }

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
              <button onClick={() => void archiveConversation()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-elevated">
                <Archive size={14} /> {conversation.status === 'archived' ? 'Unarchive' : 'Archive'}
              </button>
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

      {showNotes && (
        <NotesPanel conversation={conversation} contactName={name} onClose={() => setShowNotes(false)} onSaved={onDealSaved} />
      )}

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
        {/* Draft banner — Elsie's pending reply, inline at the end of the thread */}
        {draftMsg && (
        <div className="mt-1 rounded-xl border border-violet-200 border-l-4 border-l-violet-500 bg-violet-50 p-3 shadow-soft">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles size={14} className="text-violet-600" />
            <span className="text-[12px] font-semibold text-violet-700">Elsie drafted a reply</span>
            <span className="ml-auto text-[10.5px] text-violet-500">Review before it sends</span>
          </div>
          {editingDraft ? (
            <>
              <textarea
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                rows={4}
                autoFocus
                className="w-full resize-none rounded-lg border border-violet-300 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              />
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={() => void saveDraftEdit(draftMsg.id)}
                  disabled={savingDraft || !draftEdit.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingDraft ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Save
                </button>
                <button
                  onClick={() => setEditingDraft(false)}
                  disabled={savingDraft}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-elevated disabled:opacity-50"
                >
                  <X size={14} /> Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{draftMsg.body}</p>
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
                  onClick={() => { setDraftEdit(draftMsg.body ?? ''); setEditingDraft(true) }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-elevated"
                >
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </>
          )}
        </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <p className="mx-4 mb-1 text-[12px] text-red-500">{error}</p>
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
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-medium', stageId ? tintOf(stages.find((s) => s.id === stageId)?.color).badge : 'bg-elevated text-ink-muted')}>
            <span className={cn('h-2 w-2 rounded-full', tintOf(stages.find((s) => s.id === stageId)?.color).dot)} />
            <select
              value={stageId ?? ''}
              onChange={(e) => void changeStage(e.target.value)}
              title="Status / pipeline stage"
              className="bg-transparent outline-none"
            >
              {!stageId && <option value="">Set status</option>}
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </span>
          <button
            onClick={() => setShowFollowups((s) => !s)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition',
              showFollowups ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100',
            )}
          >
            <Repeat size={13} /> Follow-up
          </button>
          {dealValueOpen ? (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-300 bg-white px-2 py-1 text-[11.5px] font-medium text-emerald-800">
              {currencySymbol(dealCurrency)}
              <input
                data-testid="deal-value-input"
                autoFocus
                value={dealValueInput}
                onChange={(e) => setDealValueInput(e.target.value)}
                onBlur={() => void saveDealValue()}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveDealValue() }}
                inputMode="decimal"
                placeholder="0"
                className="w-14 bg-transparent text-ink outline-none"
              />
            </span>
          ) : (
            <button
              data-testid="deal-value-trigger"
              onClick={() => { setDealValueInput(deal && deal.value ? String(deal.value) : ''); setDealValueOpen(true) }}
              title="Set deal value"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <Coins size={13} /> {deal && Number(deal.value) > 0 ? formatMoney(deal.value, dealCurrency) : 'Deal value'}
            </button>
          )}
          <button
            data-testid="notes-btn"
            onClick={() => setShowNotes((s) => !s)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition',
              showNotes ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:bg-border',
            )}
          >
            <StickyNote size={13} /> Notes
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

/** Inline note editor for a lead (contacts.notes). Visible in Leads table + pipeline. */
function NotesPanel({ conversation, contactName, onClose, onSaved }: {
  conversation: Conversation
  contactName: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [note, setNote] = useState(conversation.contact?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  async function save() {
    if (!conversation.contact_id) { onClose(); return }
    setSaving(true)
    await supabase.from('contacts').update({ notes: note }).eq('id', conversation.contact_id)
    setSaving(false); setSaved(true); onSaved?.()
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <div className="mx-3 mt-2 rounded-xl border-2 border-amber-300 bg-amber-50/40 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2"><StickyNote size={14} className="text-amber-600" /><span className="text-[12.5px] font-semibold text-amber-800">Note · {contactName}</span></div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink"><X size={14} /></button>
      </div>
      <textarea
        data-testid="notes-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Private note about this lead — shows in Leads (table + pipeline)"
        className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
      />
      <div className="mt-2 flex justify-end">
        <button data-testid="notes-save-btn" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}{saved ? 'Saved' : 'Save note'}
        </button>
      </div>
    </div>
  )
}

interface Sequence { id: string; name: string; steps: { after_hours: number; message: string }[] }
interface Scheduled { id: string; step_index: number; send_at: string; status: string }

const FOLLOWUP_DELAYS: { label: string; mins: number }[] = [
  { label: '5 minutes', mins: 5 },
  { label: '10 minutes', mins: 10 },
  { label: '30 minutes', mins: 30 },
  { label: '1 hour', mins: 60 },
  { label: '3 hours', mins: 180 },
  { label: '6 hours', mins: 360 },
  { label: '12 hours', mins: 720 },
  { label: '1 day', mins: 1440 },
  { label: '2 days', mins: 2880 },
  { label: '3 days', mins: 4320 },
  { label: '5 days', mins: 7200 },
  { label: '1 week', mins: 10080 },
  { label: '2 weeks', mins: 20160 },
  { label: '1 month', mins: 43200 },
]
const snapDelay = (mins: number) => FOLLOWUP_DELAYS.reduce((best, d) => (Math.abs(d.mins - mins) < Math.abs(best.mins - mins) ? d : best), FOLLOWUP_DELAYS[0]).mins
interface EditStep { delayMins: number; message: string }

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
  const [editSteps, setEditSteps] = useState<EditStep[]>([])
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

  // Load the chosen template's steps into the editable list (snap timings to options)
  function loadStepsFromSequence(id: string | null) {
    const seq = sequences.find((s) => s.id === id)
    const steps = seq?.steps?.length ? seq.steps : [{ after_hours: 24, message: 'Hi {name}, just following up — happy to help whenever you are.' }]
    setEditSteps(steps.map((st) => ({ delayMins: snapDelay((Number(st.after_hours) || 24) * 60), message: st.message || '' })))
  }
  useEffect(() => {
    if (!loading) loadStepsFromSequence(sequenceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId, loading])

  async function toggleEnabled(next: boolean) {
    setEnabled(next)
    await supabase.from('conversations').update({ followups_enabled: next }).eq('id', conversation.id)
  }
  async function pickSequence(id: string) {
    setSequenceId(id)
    await supabase.from('conversations').update({ followup_sequence_id: id }).eq('id', conversation.id)
  }
  const setStepDelay = (i: number, mins: number) => setEditSteps((p) => p.map((s, j) => (j === i ? { ...s, delayMins: mins } : s)))
  const setStepMsg = (i: number, message: string) => setEditSteps((p) => p.map((s, j) => (j === i ? { ...s, message } : s)))
  const addStep = () => setEditSteps((p) => [...p, { delayMins: 4320, message: '' }])
  const removeStep = (i: number) => setEditSteps((p) => p.filter((_, j) => j !== i))

  async function scheduleNow() {
    const steps = editSteps.filter((s) => s.message.trim())
    if (!steps.length) return
    setBusy(true)
    if (!enabled) await toggleEnabled(true)
    // Each step fires its delay after the previous one (first = "send if no reply within")
    let t = Date.now()
    const rows = steps.map((st, i) => {
      t += (st.delayMins || 1440) * 60_000
      return { conversation_id: conversation.id, sequence_id: sequenceId, step_index: i, send_at: new Date(t).toISOString(), message: st.message.trim(), status: 'pending' as const }
    })
    await supabase.from('scheduled_followups').update({ status: 'cancelled' }).eq('conversation_id', conversation.id).eq('status', 'pending')
    await supabase.from('scheduled_followups').insert(rows)
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
    <div className="mx-3 mt-2 rounded-xl border-2 border-orange-300 bg-orange-50/50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat size={14} className="text-orange-600" />
          <span className="text-[12.5px] font-semibold text-orange-800">Follow-ups for {contactName}</span>
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
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-muted">Follow-up type</label>
            <select
              value={sequenceId ?? ''}
              onChange={(e) => void pickSequence(e.target.value)}
              className="w-full rounded-lg border border-border bg-page px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-ink-subtle/40"
            >
              {sequences.length === 0 && <option value="">No follow-up types yet — set up Elsie in Knowledge Base</option>}
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-ink-muted">Messages — edit the text & timing, then schedule</label>
            {editSteps.map((st, i) => (
              <div key={i} className="rounded-lg border border-border bg-page p-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                  <Repeat size={11} className="text-orange-500" />
                  {i === 0 ? 'Send if no reply within' : 'Then after'}
                  <select
                    value={st.delayMins}
                    onChange={(e) => setStepDelay(i, Number(e.target.value))}
                    className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-ink outline-none focus:border-orange-400"
                  >
                    {FOLLOWUP_DELAYS.map((d) => <option key={d.mins} value={d.mins}>{d.label}</option>)}
                  </select>
                  {editSteps.length > 1 && (
                    <button onClick={() => removeStep(i)} className="ml-auto rounded p-0.5 text-ink-subtle hover:bg-red-50 hover:text-red-600" title="Remove message"><Trash2 size={12} /></button>
                  )}
                </div>
                <textarea
                  value={st.message}
                  onChange={(e) => setStepMsg(i, e.target.value)}
                  rows={2}
                  placeholder="Message — use {name} for the customer's name"
                  className="w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button onClick={addStep} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11.5px] font-medium text-ink-muted transition hover:border-ink-subtle hover:text-ink">
                <Plus size={12} /> Add message
              </button>
              <button
                onClick={() => void scheduleNow()}
                disabled={busy || !editSteps.some((s) => s.message.trim())}
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Schedule
              </button>
            </div>
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
