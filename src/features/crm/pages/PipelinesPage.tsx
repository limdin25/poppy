import { useEffect, useMemo, useState } from 'react';
import { Bell, Flame, GripVertical, Pencil, MessageSquare, Mail, Phone } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { formatPence, formatRelativeTime } from '../data/helpers';
import EditContactModal from '../components/contacts/EditContactModal';
import EditableName from '../components/contacts/EditableName';
import ContactSmsModal from '../components/contacts/ContactSmsModal';
import { useSmsV2 } from '../store/SmsV2Store';
import { useContactPersistence } from '../hooks/useContactPersistence';
import { useContactChannelStatus } from '../hooks/useContactSmsStatus';
import { useFollowups } from '../hooks/useFollowups';
import { useDialerProModal } from '../layout/DialerProModalContext';
import { rowToContact, CONTACT_COLUMNS } from '../hooks/useHydrateContacts';
import { supabase } from '@/integrations/supabase/browser';
import { usePipelines } from '../hooks/usePipelines';
import type { Contact } from '../types';
import ContactIdentity from '../components/shared/ContactIdentity';
import AgentChip from '../components/shared/AgentChip';
import CalcChip from '../components/shared/CalcChip';
import { useContactFunnelStatus } from '../hooks/useContactFunnelStatus';
import StageMoveChip from '../components/shared/StageMoveChip';

const PIPELINE_LS_KEY = 'crm_pipelines_selected_id';

export default function PipelinesPage() {
  const { contacts, columns, upsertContact, patchContact, pushToast } = useSmsV2();
  // One batched query for the whole board, not one per card.
  const funnelIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const funnelByContact = useContactFunnelStatus(funnelIds);
  const persist = useContactPersistence();

  // Load pipelines via shared hook (TanStack Query cache). Prevents the
  // "Loading…" hang Hugo reported on 2026-05-22 — previously this page
  // ran its own one-shot supabase fetch with no retry / cache, which
  // sometimes failed silently after tab navigation and never recovered.
  const { pipelines } = usePipelines();
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);

  // Resolve the active id once pipelines arrive (or fall back if the
  // stored choice was removed from wk_pipelines).
  useEffect(() => {
    if (pipelines.length === 0) return;
    if (activePipelineId && pipelines.some((p) => p.id === activePipelineId)) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(PIPELINE_LS_KEY) : null;
    const match = stored && pipelines.find((p) => p.id === stored) ? stored : pipelines[0].id;
    setActivePipelineId(match);
  }, [pipelines, activePipelineId]);

  const onPickPipeline = (id: string) => {
    setActivePipelineId(id);
    try { localStorage.setItem(PIPELINE_LS_KEY, id); } catch { /* ignore */ }
  };

  // Only show columns belonging to the active pipeline. Falls back to
  // ALL columns if pipelines haven't loaded yet (transient empty render).
  const visibleColumns = useMemo(() => {
    if (!activePipelineId) return columns;
    return columns.filter((c) => c.pipelineId === activePipelineId);
  }, [columns, activePipelineId]);

  const activePipelineName =
    pipelines.find((p) => p.id === activePipelineId)?.name ?? 'Pipelines';
  const renameContact = async (id: string, name: string) => {
    patchContact(id, { name });
    const res = await persist.patchContact(id, { name });
    if (res !== true) pushToast(`Rename failed: ${res}`, 'error');
    return res;
  };
  const [editing, setEditing] = useState<Contact | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [smsTo, setSmsTo] = useState<Contact | null>(null);
  const [smsChannel, setSmsChannel] = useState<'sms' | 'whatsapp' | 'email' | null>(null);
  const { openDialerPro } = useDialerProModal();

  // PR 20 + PR 107: per-channel "last sent" badge for each pipeline
  // card. Hook returns Map<contactId, { sms, whatsapp, email }> from
  // wk_sms_messages outbound rows.
  const contactIds = useMemo(
    () => contacts.map((c) => c.id).filter(Boolean),
    [contacts]
  );
  const channelStatus = useContactChannelStatus(contactIds);

  // PR 107: per-card follow-up countdown. Single page-level setNow
  // interval so we don't run a timer per card.
  const { items: followups } = useFollowups();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // Map contactId → soonest pending/snoozed follow-up.
  const followupByContact = useMemo(() => {
    const map = new Map<string, (typeof followups)[number]>();
    const sorted = [...followups].sort(
      (a, b) => +new Date(a.due_at) - +new Date(b.due_at)
    );
    for (const f of sorted) {
      if (!map.has(f.contact_id)) map.set(f.contact_id, f);
    }
    return map;
  }, [followups]);

  // Hydrate contacts that have a pipeline stage but may have been
  // excluded from the global store's 10k-row cap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [contactsRes, tagsRes] = await Promise.all([
        (supabase.from('wk_contacts' as any) as any)
          .select(CONTACT_COLUMNS)
          .not('pipeline_column_id', 'is', null),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contact_tags' as any) as any).select('contact_id, tag'),
      ]);
      if (cancelled) return;
      const rows = contactsRes.data ?? [];
      const tagMap = new Map<string, string[]>();
      for (const t of (tagsRes.data ?? []) as { contact_id: string; tag: string }[]) {
        const arr = tagMap.get(t.contact_id);
        if (arr) arr.push(t.tag);
        else tagMap.set(t.contact_id, [t.tag]);
      }
      for (const row of rows) {
        upsertContact(rowToContact(row, tagMap.get(row.id) ?? []));
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (updated: Contact) => {
    const prev = contacts.find((c) => c.id === updated.id);
    upsertContact(updated);
    void persist.patchContact(updated.id, {
      name: updated.name,
      phone: updated.phone,
      email: updated.email ?? null,
      pipeline_column_id: updated.pipelineColumnId ?? null,
      owner_agent_id: updated.ownerAgentId ?? null,
      deal_value_pence: updated.dealValuePence ?? null,
      is_hot: updated.isHot,
      custom_fields: updated.customFields,
    }).then((result) => {
      if (result === true) {
        pushToast('Saved ✓', 'success');
      } else {
        if (prev) upsertContact(prev);
        pushToast(result ?? 'Save failed', 'error');
      }
    });
  };

  const onDragStart = (e: React.DragEvent, contactId: string) => {
    setDraggingId(contactId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', contactId);
  };

  const onDragOverCol = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColId !== colId) setDragOverColId(colId);
  };

  const onDropCol = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const contactId = e.dataTransfer.getData('text/plain') || draggingId;
    if (contactId) {
      // Optimistic local move — UI updates immediately.
      const previousColumnId = contacts.find((c) => c.id === contactId)?.pipelineColumnId;
      patchContact(contactId, { pipelineColumnId: colId });
      // Persist write-through. Mock IDs (contact-X) become no-op true.
      void persist.moveToColumn(contactId, colId).then((ok) => {
        if (!ok) {
          // Rollback on failure so the UI doesn't lie about persisted state.
          patchContact(contactId, { pipelineColumnId: previousColumnId });
          pushToast('Move failed — restored previous column', 'error');
        }
      });
    }
    setDraggingId(null);
    setDragOverColId(null);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverColId(null);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">Pipelines</h1>
          <p className="text-[13px] text-[#6B7280]">
            {activePipelineName} · click any card to edit · columns are live outcome buttons
          </p>
        </div>
        <select
          value={activePipelineId ?? ''}
          onChange={(e) => onPickPipeline(e.target.value)}
          className="text-[12px] px-3 py-2 bg-white border border-[#E5E7EB] rounded-[10px]"
        >
          {pipelines.length === 0 && <option value="">Loading…</option>}
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {visibleColumns.map((col) => {
          const cards = contacts.filter((c) => c.pipelineColumnId === col.id);
          const totalValue = cards.reduce((s, c) => s + (c.dealValuePence ?? 0), 0);
          return (
            <div
              key={col.id}
              onDragOver={(e) => onDragOverCol(e, col.id)}
              onDrop={(e) => onDropCol(e, col.id)}
              onDragLeave={() => setDragOverColId((prev) => (prev === col.id ? null : prev))}
              className={cn(
                'w-[280px] flex-shrink-0 rounded-2xl border flex flex-col max-h-[75vh] transition-colors',
                dragOverColId === col.id
                  ? 'bg-[#EEF2F8] border-[#3C5A87]/40'
                  : 'bg-[#F3F3EE]/50 border-[#E5E7EB]'
              )}
            >
              <div
                className="px-3 py-2.5 border-b border-[#E5E7EB] flex items-center gap-2 rounded-t-2xl"
                style={{ background: `${col.colour}10` }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: col.colour }}
                />
                <span
                  className="text-[12px] font-semibold uppercase tracking-wide"
                  style={{ color: col.colour }}
                >
                  {col.name}
                </span>
                <span className="ml-auto text-[11px] text-[#6B7280] tabular-nums">
                  {cards.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {cards.map((c) => (
                  <button
                    key={c.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, c.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => setEditing(c)}
                    className={cn(
                      'group w-full text-left bg-white border border-[#E5E7EB] rounded-xl p-2.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-[#3C5A87]/40 transition-all cursor-grab active:cursor-grabbing',
                      draggingId === c.id && 'opacity-40'
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="w-3 h-3 text-[#9CA3AF] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-[#1A1A1A] flex items-center gap-1 truncate">
                          <EditableName value={c.name} onSave={(n) => renameContact(c.id, n)} className="text-[13px] font-semibold" />
                          {c.isHot && (
                            <Flame
                              className="w-3 h-3 text-[#EF4444] flex-shrink-0"
                              fill="#EF4444"
                            />
                          )}
                          <Pencil className="w-2.5 h-2.5 text-[#9CA3AF] opacity-0 group-hover:opacity-100 ml-auto" />
                        </div>
                        <ContactIdentity
                          owner={c.customFields?.owner_name}
                          website={c.customFields?.website}
                          layout="stack"
                          size="xs"
                          className="mt-0.5"
                        />
                        <div className="flex items-center gap-2 mt-0.5 min-w-0">
                          <span className="text-[10px] text-[#6B7280] tabular-nums flex-shrink-0">
                            {c.phone}
                          </span>
                          <CalcChip calcAt={funnelByContact.get(c.id)?.calcAt} count={funnelByContact.get(c.id)?.calcCount} />
                          <AgentChip agentId={c.ownerAgentId} size="xs" className="ml-auto" />
                        </div>
                        {/* Hugo 2026-07-27: the board must always say where this
                            card last moved and who moved it — including the
                            moves the video funnel makes on its own. */}
                        <StageMoveChip contact={c} size="xs" className="mt-1" />
                        {c.dealValuePence && (
                          <div className="text-[11px] font-semibold text-[#3C5A87] tabular-nums mt-1">
                            {formatPence(c.dealValuePence)}
                          </div>
                        )}
                        {c.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {c.tags.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="text-[9px] font-medium bg-[#F3F3EE] text-[#6B7280] px-1.5 py-0.5 rounded"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                        {(() => {
                          const cs = channelStatus.get(c.id);
                          if (!cs) return null;
                          if (!cs.sms && !cs.whatsapp && !cs.email) return null;
                          return (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {cs.sms && (
                                <span
                                  className="inline-flex items-center gap-1 text-[9px] font-medium bg-[#3C5A87]/10 text-[#3C5A87] px-1.5 py-0.5 rounded"
                                  title={cs.sms.bodyPreview}
                                >
                                  <Phone className="w-2.5 h-2.5" />
                                  SMS · {formatRelativeTime(cs.sms.lastSentAt)}
                                </span>
                              )}
                              {cs.whatsapp && (
                                <span
                                  className="inline-flex items-center gap-1 text-[9px] font-medium bg-[#25D366]/10 text-[#1E8C4F] px-1.5 py-0.5 rounded"
                                  title={cs.whatsapp.bodyPreview}
                                >
                                  <MessageSquare className="w-2.5 h-2.5" />
                                  WA · {formatRelativeTime(cs.whatsapp.lastSentAt)}
                                </span>
                              )}
                              {cs.email && (
                                <span
                                  className="inline-flex items-center gap-1 text-[9px] font-medium bg-[#3B82F6]/10 text-[#1D4ED8] px-1.5 py-0.5 rounded"
                                  title={cs.email.bodyPreview}
                                >
                                  <Mail className="w-2.5 h-2.5" />
                                  Email · {formatRelativeTime(cs.email.lastSentAt)}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {(() => {
                          // PR 107: follow-up countdown badge.
                          const f = followupByContact.get(c.id);
                          if (!f) return null;
                          const due = new Date(f.due_at).getTime();
                          const ms = due - now;
                          const tone =
                            ms <= 0
                              ? 'overdue'
                              : ms <= 60 * 60 * 1000
                                ? 'soon'
                                : 'future';
                          const cls =
                            tone === 'overdue'
                              ? 'bg-[#FEF2F2] text-[#DC2626]'
                              : tone === 'soon'
                                ? 'bg-[#FFF7ED] text-[#C2410C] animate-pulse'
                                : 'bg-[#F3F3EE] text-[#6B7280]';
                          const label =
                            tone === 'overdue'
                              ? `OVERDUE ${humanizeAgo(-ms)}`
                              : tone === 'soon'
                                ? `Due in ${humanizeIn(ms)}`
                                : `Follow-up in ${humanizeIn(ms)}`;
                          return (
                            <div
                              className={cn(
                                'mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded',
                                cls
                              )}
                              title={f.note ?? undefined}
                            >
                              <Bell className="w-2.5 h-2.5" /> {label}
                            </div>
                          );
                        })()}
                        {/* Action buttons — visible on hover */}
                        <div
                          className="flex gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); openDialerPro(c.id, { pipelineColumnId: col.id }); }}
                            className="p-1 rounded hover:bg-[#EEF2F8] text-[#3C5A87]"
                            title="Call"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSmsChannel('sms'); setSmsTo(c); }}
                            className="p-1 rounded hover:bg-[#EEF2F8] text-[#3C5A87]"
                            title="SMS"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSmsChannel('whatsapp'); setSmsTo(c); }}
                            className="p-1 rounded hover:bg-[#EEF2F8] text-[#25D366]"
                            title="WhatsApp"
                          >
                            <MessageSquare className="w-3.5 h-3.5" strokeWidth={2.4} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSmsChannel('email'); setSmsTo(c); }}
                            className="p-1 rounded hover:bg-[#DBEAFE] text-[#3B82F6]"
                            title="Email"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {cards.length === 0 && (
                  <div className="text-[11px] text-[#9CA3AF] text-center py-4 italic">
                    Empty column
                  </div>
                )}
              </div>
              {totalValue > 0 && (
                <div className="px-3 py-2 border-t border-[#E5E7EB] text-[11px] text-[#6B7280] flex justify-between">
                  <span>Total</span>
                  <span className="font-semibold text-[#1A1A1A] tabular-nums">
                    {formatPence(totalValue)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <EditContactModal
        contact={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />

      {smsTo && (
        <ContactSmsModal
          contact={smsTo}
          onClose={() => { setSmsTo(null); setSmsChannel(null); }}
          defaultChannel={smsChannel}
        />
      )}
    </div>
  );
}

// PR 107: humanise positive (in N) / negative (N ago) deltas in ms.
function humanizeIn(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function humanizeAgo(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
