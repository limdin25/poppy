import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, MoreHorizontal, Trash2, Loader2, GripVertical, Repeat, MessageCircle, StickyNote, Phone } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { usePipelineStages, useDeals } from '@/core/hooks/usePipeline'
import { useCurrency } from '@/core/hooks/useCurrency'
import { formatMoney } from '@/core/lib/currency'
import { DealModal } from '@/core/ui/DealModal'
import type { Deal, PipelineStage } from '@/core/types/database'

/**
 * Deal pipeline — colourful, editable stages (rename / recolour / add / delete)
 * with draggable deal cards showing title + value. Replaces the old contacts
 * kanban as the board view of the Leads page.
 */

type StageColor = { dot: string; soft: string; text: string; bar: string }

const STAGE_COLORS: Record<string, StageColor> = {
  slate:   { dot: 'bg-slate-400',   soft: 'bg-slate-50',   text: 'text-slate-700',   bar: 'border-t-slate-400' },
  blue:    { dot: 'bg-blue-500',    soft: 'bg-blue-50',    text: 'text-blue-700',    bar: 'border-t-blue-500' },
  violet:  { dot: 'bg-violet-500',  soft: 'bg-violet-50',  text: 'text-violet-700',  bar: 'border-t-violet-500' },
  amber:   { dot: 'bg-amber-500',   soft: 'bg-amber-50',   text: 'text-amber-700',   bar: 'border-t-amber-500' },
  orange:  { dot: 'bg-orange-500',  soft: 'bg-orange-50',  text: 'text-orange-700',  bar: 'border-t-orange-500' },
  emerald: { dot: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700', bar: 'border-t-emerald-500' },
  red:     { dot: 'bg-red-500',     soft: 'bg-red-50',     text: 'text-red-700',     bar: 'border-t-red-500' },
  pink:    { dot: 'bg-pink-500',    soft: 'bg-pink-50',    text: 'text-pink-700',    bar: 'border-t-pink-500' },
  cyan:    { dot: 'bg-cyan-500',    soft: 'bg-cyan-50',    text: 'text-cyan-700',    bar: 'border-t-cyan-500' },
}
const COLOR_KEYS = Object.keys(STAGE_COLORS)
const colorOf = (c: string): StageColor => STAGE_COLORS[c] ?? STAGE_COLORS.slate

function countdownTo(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'due'
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

function dealContactName(d: Deal): string {
  const c = d.contact
  if (!c) return ''
  return c.name || c.phone || c.whatsapp || c.email || ''
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  contacted: { label: 'Contacted', cls: 'bg-blue-100 text-blue-700' },
  qualified: { label: 'Qualified', cls: 'bg-amber-100 text-amber-700' },
  won: { label: 'Won', cls: 'bg-emerald-100 text-emerald-700' },
  lost: { label: 'Lost', cls: 'bg-red-100 text-red-700' },
}

export function DealPipeline() {
  const { businessId } = useAuth()
  const navigate = useNavigate()
  const openChat = (d: Deal) => {
    if (d.contact_id) navigate(`/inbox?contact=${d.contact_id}`)
  }
  const { data: stages, refetch: refetchStages } = usePipelineStages()
  const { data: deals, loading, refetch: refetchDeals } = useDeals()

  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [addingStage, setAddingStage] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editDeal, setEditDeal] = useState<Deal | null>(null)
  const [prefillStage, setPrefillStage] = useState<string | null>(null)

  // Next pending follow-up per linked conversation (countdown on deal cards)
  const [followupDue, setFollowupDue] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = deals.map((d) => d.conversation_id).filter(Boolean) as string[]
    if (!ids.length) { setFollowupDue({}); return }
    supabase.from('scheduled_followups').select('conversation_id, send_at').eq('status', 'pending').in('conversation_id', ids)
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const r of (data ?? []) as { conversation_id: string; send_at: string }[]) {
          if (!map[r.conversation_id] || r.send_at < map[r.conversation_id]) map[r.conversation_id] = r.send_at
        }
        setFollowupDue(map)
      })
  }, [deals])

  async function moveDeal(dealId: string, toStageId: string) {
    setDragId(null)
    setOverCol(null)
    const deal = deals.find((d) => d.id === dealId)
    if (!deal || deal.stage_id === toStageId) return
    await supabase.from('deals').update({ stage_id: toStageId, updated_at: new Date().toISOString() }).eq('id', dealId)
    refetchDeals()
  }

  async function addStage() {
    if (!businessId) return
    setAddingStage(true)
    const order = (stages[stages.length - 1]?.sort_order ?? -1) + 1
    const color = COLOR_KEYS[stages.length % COLOR_KEYS.length]
    await supabase.from('pipeline_stages').insert({ business_id: businessId, name: 'New stage', color, sort_order: order } as never)
    setAddingStage(false)
    refetchStages()
  }

  async function renameStage(id: string, name: string) {
    await supabase.from('pipeline_stages').update({ name }).eq('id', id)
    refetchStages()
  }
  async function recolorStage(id: string, color: string) {
    await supabase.from('pipeline_stages').update({ color }).eq('id', id)
    refetchStages()
  }
  async function deleteStage(id: string) {
    if (!window.confirm('Delete this stage? Any deals in it will become unstaged.')) return
    await supabase.from('pipeline_stages').delete().eq('id', id)
    refetchStages()
    refetchDeals()
  }

  function openAddDeal(stageId: string) {
    setEditDeal(null)
    setPrefillStage(stageId)
    setModalOpen(true)
  }
  function openEditDeal(d: Deal) {
    setPrefillStage(null)
    setEditDeal(d)
    setModalOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-surface py-20 shadow-soft">
        <Loader2 size={22} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            deals={deals.filter((d) => d.stage_id === stage.id)}
            dragId={dragId}
            isOver={overCol === stage.id}
            onCardDragStart={setDragId}
            onCardDragEnd={() => { setDragId(null); setOverCol(null) }}
            onColDragOver={() => setOverCol(stage.id)}
            onColDragLeave={() => setOverCol((c) => (c === stage.id ? null : c))}
            onDrop={() => dragId && moveDeal(dragId, stage.id)}
            onRename={(name) => void renameStage(stage.id, name)}
            onRecolor={(color) => void recolorStage(stage.id, color)}
            onDelete={() => void deleteStage(stage.id)}
            onAddDeal={() => openAddDeal(stage.id)}
            onCardClick={openEditDeal}
            onOpenChat={openChat}
            followupDue={followupDue}
          />
        ))}

        <div className="w-[260px] shrink-0">
          <button
            onClick={() => void addStage()}
            disabled={addingStage}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-[12.5px] font-medium text-ink-muted transition hover:border-ink-subtle hover:text-ink disabled:opacity-50"
          >
            {addingStage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />} Add stage
          </button>
        </div>
      </div>

      <DealModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={refetchDeals}
        deal={editDeal}
        prefill={prefillStage ? { stageId: prefillStage } : undefined}
      />
    </>
  )
}

function StageColumn({
  stage, deals, dragId, isOver,
  onCardDragStart, onCardDragEnd, onColDragOver, onColDragLeave, onDrop,
  onRename, onRecolor, onDelete, onAddDeal, onCardClick, onOpenChat, followupDue,
}: {
  stage: PipelineStage
  deals: Deal[]
  dragId: string | null
  isOver: boolean
  onCardDragStart: (id: string) => void
  onCardDragEnd: () => void
  onColDragOver: () => void
  onColDragLeave: () => void
  onDrop: () => void
  onRename: (name: string) => void
  onRecolor: (color: string) => void
  onDelete: () => void
  onAddDeal: () => void
  onCardClick: (d: Deal) => void
  onOpenChat: (d: Deal) => void
  followupDue: Record<string, string>
}) {
  const currency = useCurrency()
  const c = colorOf(stage.color)
  const total = deals.reduce((s, d) => s + Number(d.value || 0), 0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      {/* Header */}
      <div className={cn('mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2', c.soft)}>
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', c.dot)} />
        <input
          defaultValue={stage.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== stage.name) onRename(v) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={cn('min-w-0 flex-1 rounded bg-transparent px-1 text-[12px] font-semibold uppercase tracking-wide outline-none focus:bg-white', c.text)}
        />
        <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-muted">{deals.length}</span>
        <div ref={menuRef} className="relative shrink-0">
          <button onClick={() => setMenuOpen((o) => !o)} className="rounded p-0.5 text-ink-muted hover:bg-white/70" title="Stage settings">
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-border bg-surface p-2 shadow-pop">
              <p className="px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Colour</p>
              <div className="flex flex-wrap gap-1.5 px-1 pb-2">
                {COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => { onRecolor(k); setMenuOpen(false) }}
                    className={cn('h-5 w-5 rounded-full ring-2 ring-offset-1', colorOf(k).dot, stage.color === k ? 'ring-ink/40' : 'ring-transparent')}
                    title={k}
                  />
                ))}
              </div>
              <button onClick={() => { setMenuOpen(false); onDelete() }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-red-50">
                <Trash2 size={13} /> Delete stage
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      <div
        onDragOver={(e) => { e.preventDefault(); onColDragOver() }}
        onDragLeave={onColDragLeave}
        onDrop={(e) => { e.preventDefault(); onDrop() }}
        className={cn(
          'flex flex-1 flex-col gap-2 rounded-2xl border border-t-2 p-2 transition-colors',
          c.bar,
          isOver ? 'border-x-accent/40 border-b-accent/40 bg-accent/[0.03]' : 'border-x-border border-b-border bg-page',
        )}
      >
        {deals.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-subtle">Drop a deal here</p>
        ) : (
          deals.map((d) => {
            const contactName = dealContactName(d)
            return (
              <div
                key={d.id}
                draggable
                onDragStart={() => onCardDragStart(d.id)}
                onDragEnd={onCardDragEnd}
                onClick={() => onCardClick(d)}
                className={cn(
                  'group cursor-pointer rounded-xl border border-border bg-surface p-3 shadow-soft transition hover:border-ink-subtle/40',
                  dragId === d.id && 'opacity-50',
                )}
              >
                <div className="flex items-start gap-1.5">
                  <GripVertical size={13} className="mt-0.5 shrink-0 text-ink-subtle opacity-0 transition group-hover:opacity-100" />
                  <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-ink">{d.title}</p>
                  {d.contact?.phone && (
                    <a
                      href={`tel:${d.contact.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      title={`Call ${d.contact.phone}`}
                      className="shrink-0 rounded-md p-1 text-ink-subtle opacity-0 transition hover:bg-elevated hover:text-accent group-hover:opacity-100"
                    >
                      <Phone size={13} />
                    </a>
                  )}
                  {d.contact_id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenChat(d) }}
                      title="Open chat"
                      className="shrink-0 rounded-md p-1 text-ink-subtle opacity-0 transition hover:bg-elevated hover:text-accent group-hover:opacity-100"
                    >
                      <MessageCircle size={13} />
                    </button>
                  )}
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', c.soft, c.text)}>{formatMoney(d.value, currency)}</span>
                </div>
                {d.description && (
                  <p className="mt-1 line-clamp-2 pl-[18px] text-[11.5px] leading-snug text-ink-muted">{d.description}</p>
                )}
                {d.contact?.notes && (
                  <p className="mt-1 flex items-start gap-1 pl-[18px] text-[11px] leading-snug text-amber-700">
                    <StickyNote size={11} className="mt-0.5 shrink-0" /> <span className="line-clamp-2">{d.contact.notes}</span>
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 pl-[18px]">
                  <span className="truncate text-[11.5px] text-ink-subtle">{contactName || 'No contact linked'}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {d.conversation_id && followupDue[d.conversation_id] && (
                      <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-orange-700" title="Next follow-up">
                        <Repeat size={9} /> {countdownTo(followupDue[d.conversation_id])}
                      </span>
                    )}
                    {d.contact?.status && STATUS_BADGE[d.contact.status] && (
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold', STATUS_BADGE[d.contact.status].cls)}>
                        {STATUS_BADGE[d.contact.status].label}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )
          })
        )}

        <button
          onClick={onAddDeal}
          className="mt-0.5 flex items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1.5 text-[12px] font-medium text-ink-muted transition hover:border-ink-subtle hover:bg-surface hover:text-ink"
        >
          <Plus size={13} /> Add deal
        </button>
      </div>

      {/* Total */}
      <div className="mt-1.5 px-1 text-[11px] font-medium text-ink-subtle">
        {deals.length} deal{deals.length === 1 ? '' : 's'} · {formatMoney(total, currency)}
      </div>
    </div>
  )
}
