import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Trash2, Plus, Pencil } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import EditContactModal from '@/features/crm/components/contacts/EditContactModal';
import { personName, websiteLabel } from '@/features/crm/lib/contactIdentity';
import type { Contact } from '@/features/crm/types';
import type { QueueLead } from '../types';

interface Props {
  queue: QueueLead[];
  campaignId: string | null;
  onRefresh: () => void;
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function QueueManagerPro({ queue, campaignId, onRefresh, onToast }: Props) {
  const { user } = useAuth();
  const [removing, setRemoving] = useState<string | null>(null);
  const [, setAdding] = useState(false);
  const [creatingNew, setCreatingNew] = useState<Contact | null>(null);
  const [visibleCount, setVisibleCount] = useState(25);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver — reveal more queue items on scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && visibleCount < queue.length) {
          setVisibleCount((prev) => Math.min(prev + 25, queue.length));
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, queue.length]);

  const visibleQueue = queue.slice(0, visibleCount);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  useEffect(() => {
    if (!editingContactId) { setEditingContact(null); return; }
    let cancelled = false;
    void (async () => {
      const [contactRes, tagsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contacts' as any) as any)
          .select('id, name, phone, email, owner_agent_id, pipeline_column_id, is_hot, deal_value_pence, custom_fields, created_at, last_contact_at')
          .eq('id', editingContactId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contact_tags' as any) as any)
          .select('tag')
          .eq('contact_id', editingContactId),
      ]);
      if (cancelled) return;
      if (contactRes.error || !contactRes.data) return;
      const d = contactRes.data;
      const tags = ((tagsRes.data ?? []) as { tag: string }[]).map((r) => r.tag);
      setEditingContact({
        id: d.id, name: d.name ?? '', phone: d.phone ?? '',
        email: d.email ?? undefined, ownerAgentId: d.owner_agent_id ?? undefined,
        pipelineColumnId: d.pipeline_column_id ?? undefined, tags,
        isHot: d.is_hot ?? false, dealValuePence: d.deal_value_pence ?? undefined,
        customFields: d.custom_fields ?? {}, createdAt: d.created_at ?? new Date().toISOString(),
        lastContactAt: d.last_contact_at ?? undefined,
      });
    })();
    return () => { cancelled = true; };
  }, [editingContactId]);

  const addToQueue = useCallback(
    async (contactId: string) => {
      if (!campaignId) {
        onToast?.('No campaign selected — cannot add to queue', 'error');
        return;
      }
      setAdding(true);
      const maxPriority = queue.reduce((max, l) => Math.max(max, l.priority), 0);

      // Check if contact already exists in queue (any status — unique constraint)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase.from('wk_dialer_queue' as any) as any)
        .select('id')
        .eq('contact_id', contactId)
        .eq('campaign_id', campaignId)
        .maybeSingle();

      if (existing) {
        // Reset to pending with top priority
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('wk_dialer_queue' as any) as any)
          .update({ status: 'pending', priority: maxPriority + 1 })
          .eq('id', existing.id);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('wk_dialer_queue' as any) as any).insert({
          contact_id: contactId,
          campaign_id: campaignId,
          status: 'pending',
          priority: maxPriority + 1,
          attempts: 0,
          agent_id: user?.id ?? null,
        });
        if (error) {
          onToast?.('Failed to add to queue', 'error');
          setAdding(false);
          return;
        }
      }
      setAdding(false);
      onToast?.('Added — next in queue', 'success');
      onRefresh();
    },
    [campaignId, queue, onRefresh, onToast]
  );

  const removeFromQueue = useCallback(
    async (queueRowId: string) => {
      setRemoving(queueRowId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc('wk_update_queue_status', {
          p_queue_id: queueRowId,
          p_status: 'done',
        });
      } catch { /* ignore */ }
      setRemoving(null);
      onRefresh();
    },
    [onRefresh]
  );

  const movePriority = useCallback(
    async (queueRowId: string, newPriority: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('wk_dialer_queue' as any) as any)
        .update({ priority: newPriority })
        .eq('id', queueRowId);
      onRefresh();
    },
    [onRefresh]
  );

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCreatingNew({
            id: `new-${Date.now()}`, name: '', phone: '', email: undefined,
            tags: [], isHot: false, customFields: {}, createdAt: new Date().toISOString(),
          })}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#3C5A87] text-white hover:bg-[#3C5A87]/90 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add lead
        </button>
        <span className="text-[10px] text-[#9CA3AF]">{queue.length} pending</span>
      </div>

      <div className="space-y-1">
        {visibleQueue.map((lead, i) => (
          <div
            key={lead.queueRowId}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[#F3F3EE]/50 text-xs group"
          >
            <span className="font-mono text-[10px] text-[#9CA3AF] w-4 flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[#1A1A1A] text-[11px] truncate">{lead.name}</div>
              <div className={cn('text-[10px] truncate', lead.ownerName ? 'text-[#6B7280]' : 'text-[#C4302B] italic')}>
                {personName(lead.ownerName)}
              </div>
              <div className={cn('text-[10px] truncate', lead.website ? 'text-[#3C5A87]' : 'text-[#C4302B] italic')}>
                {websiteLabel(lead.website)}
              </div>
              <div className="text-[10px] text-[#9CA3AF] font-mono">{lead.phone}</div>
            </div>
            {lead.attempts > 0 && (
              <span className="text-[10px] text-[#9CA3AF]">×{lead.attempts}</span>
            )}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {i > 0 && (
                <button
                  onClick={() => void movePriority(lead.queueRowId, lead.priority + 1)}
                  className="p-0.5 rounded text-[#6B7280] hover:text-[#1A1A1A] text-[10px]"
                >
                  ↑
                </button>
              )}
              {i < visibleQueue.length - 1 && (
                <button
                  onClick={() => void movePriority(lead.queueRowId, Math.max(0, lead.priority - 1))}
                  className="p-0.5 rounded text-[#6B7280] hover:text-[#1A1A1A] text-[10px]"
                >
                  ↓
                </button>
              )}
              <button
                onClick={() => setEditingContactId(lead.contactId)}
                className="p-0.5 rounded text-[#6B7280] hover:text-[#3C5A87]"
                title="Edit contact"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => void removeFromQueue(lead.queueRowId)}
                disabled={removing === lead.queueRowId}
                className={cn(
                  'p-0.5 rounded text-red-400 hover:text-red-600',
                  removing === lead.queueRowId && 'animate-spin'
                )}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-2" />
        {visibleCount < queue.length && (
          <div className="flex items-center justify-center py-1 text-[10px] text-[#9CA3AF]">
            Showing {visibleCount} of {queue.length}…
          </div>
        )}
      </div>

      {editingContact && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999]">
          <EditContactModal
            contact={editingContact}
            onClose={() => { setEditingContactId(null); setEditingContact(null); }}
            onSave={async (updated) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('wk_contacts' as any) as any)
                .update({
                  name: updated.name || null, phone: updated.phone,
                  email: updated.email || null, pipeline_column_id: updated.pipelineColumnId || null,
                  owner_agent_id: updated.ownerAgentId || null, is_hot: updated.isHot,
                  deal_value_pence: updated.dealValuePence ?? null, custom_fields: updated.customFields,
                }).eq('id', updated.id);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('wk_contact_tags' as any) as any).delete().eq('contact_id', updated.id);
              if (updated.tags.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase.from('wk_contact_tags' as any) as any)
                  .insert(updated.tags.map((t) => ({ contact_id: updated.id, tag: t })));
              }
              setEditingContactId(null);
              setEditingContact(null);
              onRefresh();
            }}
          />
        </div>,
        document.body,
      )}

      {creatingNew && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999]">
          <EditContactModal
            contact={creatingNew}
            onClose={() => setCreatingNew(null)}
            onSave={async (draft) => {
              if (!draft.phone.trim()) {
                onToast?.('Phone number is required', 'error');
                return;
              }
              // Check if contact with this phone already exists
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: existing } = await (supabase.from('wk_contacts' as any) as any)
                .select('id')
                .eq('phone', draft.phone.trim())
                .maybeSingle();

              let contactId: string;
              if (existing) {
                contactId = existing.id;
              } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data, error } = await (supabase.from('wk_contacts' as any) as any)
                  .insert({
                    name: draft.name.trim() || null,
                    phone: draft.phone.trim(),
                    email: draft.email || null,
                    pipeline_column_id: draft.pipelineColumnId || null,
                    is_hot: draft.isHot,
                    custom_fields: draft.customFields,
                  })
                  .select('id')
                  .single();
                if (error || !data) {
                  console.warn('[queue-manager] contact insert failed:', error?.message);
                  onToast?.(error?.message?.includes('phone_uniq')
                    ? 'Phone number already exists'
                    : error?.message ?? 'Could not create contact', 'error');
                  return;
                }
                contactId = data.id;
                if (draft.tags.length > 0) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  await (supabase.from('wk_contact_tags' as any) as any)
                    .insert(draft.tags.map((t) => ({ contact_id: contactId, tag: t })));
                }
              }
              await addToQueue(contactId);
              setCreatingNew(null);
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
