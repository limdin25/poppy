import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactDOM from 'react-dom';
import {
  Phone, PhoneOff, Mic, MicOff, Pause as PauseIcon, Play, Square,
  SkipForward, Flame, Maximize2, Minus,
  MessageSquare, FileText, PhoneForwarded, Hash, Circle,
  ChevronDown, Voicemail, Pencil} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useImpersonatedAgentId } from '@/features/crm/lib/ViewAsContext';
import { supabase } from '@/integrations/supabase/browser';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/features/crm/ui/resizable';
import { useDialerCampaigns } from '@/features/crm/caller-pad/hooks/useDialerCampaigns';
import { usePipelineColumns } from '@/features/crm/caller-pad/hooks/usePipelineColumns';
import type { PipelineColumnRow } from '@/features/crm/caller-pad/hooks/usePipelineColumns';
import { useSpendLimit } from '@/features/crm/caller-pad/hooks/useSpendLimit';
import { useKillSwitch } from '@/features/crm/caller-pad/hooks/useKillSwitch';
import type { Campaign } from '@/features/crm/caller-pad/types';

import DialerScriptPane, { type ScriptKey } from '@/features/crm/components/live-call/DialerScriptPane';
import { scriptForCall } from '@/features/crm/lib/scriptForCall';
import DialerRightTabs from '@/features/crm/components/live-call/DialerRightTabs';
import ContactMetaCompact from '@/features/crm/components/live-call/ContactMetaCompact';
import CallTimeline from '@/features/crm/components/live-call/CallTimeline';
import EditContactModal from '@/features/crm/components/contacts/EditContactModal';
import type { Contact } from '@/features/crm/types';

import { useQueryClient } from '@tanstack/react-query';
import { useCurrentAgent } from '@/features/crm/hooks/useCurrentAgent';
import { useSmsV2 } from '@/features/crm/store/SmsV2Store';
import { useContactPersistence } from '@/features/crm/hooks/useContactPersistence';
import EditableName from '@/features/crm/components/contacts/EditableName';
import { useDialerMachine } from './useDialerMachine';
import { useQueuePro } from './useQueuePro';
import type { QueueLead } from './types';
import CallHistoryPro from './history/CallHistoryPro';
import QueueManagerPro from './history/QueueManagerPro';
import DtmfKeypad from './controls/DtmfKeypad';
import ContactIdentity from '../components/shared/ContactIdentity';
import AgentChip from '../components/shared/AgentChip';
import CalcChip from '../components/shared/CalcChip';
import { useContactFunnelStatus } from '../hooks/useContactFunnelStatus';

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function DialerProPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const autoCallContactId = searchParams.get('call');
  // Captured once: onAutoCallConsumed clears the query string, which would
  // otherwise swap the script back to cold mid-call.
  const [scriptKey] = useState<ScriptKey>(() =>
    searchParams.get('script') === 'vsl_close' ? 'vsl_close' : 'cold_call');
  return (
    <DialerProContent
      autoCallContactId={autoCallContactId}
      scriptKey={scriptKey}
      onAutoCallConsumed={() => setSearchParams({}, { replace: true })}
    />
  );
}

interface DialerProContentProps {
  autoCallContactId?: string | null;
  pipelineColumnId?: string | null;
  /** Which script the middle column reads. Defaults to the cold-call script,
   *  so every caller that does not pass it is unchanged. */
  scriptKey?: ScriptKey;
  onAutoCallConsumed?: () => void;
}

export function DialerProContent({ autoCallContactId, pipelineColumnId, scriptKey = 'cold_call', onAutoCallConsumed }: DialerProContentProps) {
  const { user, isAdmin } = useAuth();
  const impId = useImpersonatedAgentId();
  const userId = user?.id ?? null;
  const { firstName: agentFirstName } = useCurrentAgent();
  const { patchContact: storePatch } = useSmsV2();
  const persistApi = useContactPersistence();

  // Toasts
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; type: string }>>([]);
  // Debug log — keeps last 12 toasts so the ?debug=1 overlay can show
  // the sequence of events when something goes wrong intermittently.
  const [debugLog, setDebugLog] = useState<Array<{ t: number; msg: string; type: string }>>([]);
  const onToast = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev.slice(-4), { id, msg, type }]);
    setDebugLog((prev) => [...prev.slice(-11), { t: id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const renameContact = useCallback(async (id: string, name: string) => {
    storePatch(id, { name });
    const res = await persistApi.patchContact(id, { name });
    if (res !== true) onToast(`Rename failed: ${res}`, 'error');
    return res;
  }, [storePatch, persistApi, onToast]);

  // Campaign — honour ?campaign=<id> in the URL (used by /tinder/pipeline
  // "Push to CRM dialer" deep links); fall back to first available campaign.
  //
  // useSearchParams is read again here (not just in DialerProPage) because
  // DialerProContent doesn't receive the param object as a prop. Calling
  // useSearchParams twice in the same tree is safe — it subscribes to the
  // same router context.
  const [contentSearchParams] = useSearchParams();
  // "See as: <agent>" — the dialer is per-campaign and campaigns map to agents
  // via wk_campaign_agents, so scoping the CAMPAIGN LIST scopes the whole dialer
  // (queue + KPIs follow the selected campaign). Impersonating → the agent's
  // campaigns; a plain admin → all; a real agent → their own.
  const { campaigns } = useDialerCampaigns({
    scopedToAgentId: impId ?? (isAdmin ? null : userId),
    includeInactive: true,
  });
  const requestedCampaignId = contentSearchParams.get('campaign');
  const [activeCampaignId, setActiveCampaignId] = useState<string>('');
  useEffect(() => {
    if (campaigns.length === 0) return;
    // 1. URL ?campaign=… wins if it matches a real campaign
    if (requestedCampaignId && campaigns.some((c) => c.id === requestedCampaignId) && activeCampaignId !== requestedCampaignId) {
      setActiveCampaignId(requestedCampaignId);
      return;
    }
    // 2. Otherwise auto-select the first campaign when none is set
    if (!campaigns.some((c) => c.id === activeCampaignId)) {
      setActiveCampaignId(campaigns[0].id);
    }
  }, [campaigns, activeCampaignId, requestedCampaignId]);
  const camp: Campaign | null = useMemo(
    () => campaigns.find((c) => c.id === activeCampaignId) ?? campaigns[0] ?? null,
    [campaigns, activeCampaignId],
  );

  // Pipeline columns for disposition (wired to /crm/pipelines)
  const { columns: outcomeColumns, loading: outcomeColumnsLoading } = usePipelineColumns(camp?.pipelineId ?? null);
  const spend = useSpendLimit();
  const ks = useKillSwitch();

  // Which lead the video funnel opened this room to close. Declared before the
  // machine because dialLead asks about it at dial time. Captured in a ref
  // because clearAutoCall nulls the prop the moment the dial fires.
  const closeCallContactIdRef = useRef<string | null>(autoCallContactId ?? null);

  // State machine
  const machine = useDialerMachine({
    userId,
    campaignId: camp?.id ?? null,
    pipelineId: camp?.pipelineId ?? null,
    // Same pure rule the on-screen pane uses, asked about the lead being
    // dialled. That is what keeps the coach and the screen from disagreeing.
    scriptKeyForLead: useCallback(
      (contactId: string) => scriptForCall({
        openedWith: scriptKey,
        openedForContactId: closeCallContactIdRef.current,
        currentLeadContactId: contactId,
      }),
      [scriptKey],
    ),
    onToast,
  });
  const { state, deviceReady, reconnecting, reconnectDevice } = machine;

  // Drop VM eligibility — mirrors canDropVoicemail (api/lib/voicemail-drop.ts,
  // the vitest-pinned canonical; api/lib isn't importable from the app
  // project). Greyed until: connected + campaign has a recording + campaign
  // toggle on + not already dropped on this call.
  const canDropVm =
    state.phase === 'connected' &&
    Boolean(camp?.voicemailRecordingUrl) &&
    Boolean(camp?.voicemailDropEnabled) &&
    !state.voicemailDropped &&
    !machine.dropping;
  const dropVmHint = !camp?.voicemailRecordingUrl
    ? 'No voicemail recording uploaded for this campaign (Settings → campaign → Leads)'
    : !camp?.voicemailDropEnabled
      ? 'Voicemail drop is switched off for this campaign'
      : state.voicemailDropped
        ? 'Voicemail already dropped on this call'
        : 'Play the campaign voicemail into this call and move on';

  // Refresh call history when a call wraps up or outcome is saved
  const queryClient = useQueryClient();
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (state.phase === 'wrap_up' || (prev === 'wrap_up' && state.phase === 'idle') || (prev === 'wrap_up' && state.phase === 'paused')) {
      void queryClient.invalidateQueries({ queryKey: ['dialer-pro-call-history'] });
    }
  }, [state.phase, queryClient]);

  // Queue
  const { queue, refresh: refreshQueue, removeLocal: removeFromQueue } = useQueuePro(camp?.id ?? null);

  // Auto-dial: when ?call=<contactId> is in the URL, look up the contact
  // and start calling them as soon as the device is ready.
  const autoCallFired = useRef(false);
  useEffect(() => {
    if (!autoCallContactId || !deviceReady || !camp || autoCallFired.current) return;
    if (state.phase !== 'idle' && state.phase !== 'paused') return;
    autoCallFired.current = true;
    onAutoCallConsumed?.();

    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: c } = await (supabase.from('wk_contacts' as any) as any)
        .select('id, name, phone, pipeline_column_id')
        .eq('id', autoCallContactId)
        .maybeSingle();
      if (!c?.phone) { onToast('Contact not found or has no phone number', 'error'); return; }

      // Check if contact is already in the pending queue
      let queueLead = queue.find((q) => q.contactId === autoCallContactId);
      if (!queueLead) {
        // Check if they exist in queue with a non-pending status (done/missed)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingRow } = await (supabase.from('wk_dialer_queue' as any) as any)
          .select('id')
          .eq('contact_id', autoCallContactId)
          .eq('campaign_id', camp.id)
          .maybeSingle();

        let queueRowId: string;
        if (existingRow) {
          // Reset existing row to pending with top priority
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('wk_dialer_queue' as any) as any)
            .update({ status: 'pending', priority: 9999 })
            .eq('id', existingRow.id);
          queueRowId = existingRow.id;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: row, error: insertErr } = await (supabase.from('wk_dialer_queue' as any) as any)
            .insert({
              contact_id: autoCallContactId,
              campaign_id: camp.id,
              status: 'pending',
              priority: 9999,
              attempts: 0,
              agent_id: userId,
            })
            .select('id')
            .single();
          if (insertErr || !row) {
            console.warn('[dialer-pro] auto-call queue insert failed:', insertErr?.message);
            onToast(insertErr?.message ?? 'Could not add contact to queue', 'error');
            return;
          }
          queueRowId = row.id;
        }
        queueLead = {
          id: c.id,
          contactId: c.id,
          phone: c.phone,
          name: c.name ?? c.phone,
          priority: 9999,
          attempts: 0,
          scheduledFor: null,
          status: 'pending',
          campaignId: camp.id,
          pipelineColumnId: c.pipeline_column_id ?? null,
          queueRowId,
        };
        refreshQueue();
      }
      void machine.dialLead(queueLead);
    })();
  }, [autoCallContactId, deviceReady, camp, state.phase, queue, machine, onToast, refreshQueue, onAutoCallConsumed]);

  // Redial straight from the call history — mirrors the ?call= auto-dial path:
  // ensure the contact has a pending queue row, then hand it to the machine.
  const handleRedial = useCallback(async (contactId: string) => {
    if (!camp) { onToast('Pick a campaign first', 'error'); return; }
    if (!deviceReady) { onToast('Phone still connecting — try again in a second', 'error'); return; }
    if (state.phase !== 'idle' && state.phase !== 'paused') { onToast('Finish the current call first', 'error'); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: c } = await (supabase.from('wk_contacts' as any) as any)
      .select('id, name, phone, pipeline_column_id')
      .eq('id', contactId)
      .maybeSingle();
    if (!c?.phone) { onToast('Contact has no phone number', 'error'); return; }

    let queueLead = queue.find((q) => q.contactId === contactId);
    if (!queueLead) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingRow } = await (supabase.from('wk_dialer_queue' as any) as any)
        .select('id')
        .eq('contact_id', contactId)
        .eq('campaign_id', camp.id)
        .maybeSingle();
      let queueRowId: string;
      if (existingRow) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('wk_dialer_queue' as any) as any)
          .update({ status: 'pending', priority: 9999 })
          .eq('id', existingRow.id);
        queueRowId = existingRow.id;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: row, error: insertErr } = await (supabase.from('wk_dialer_queue' as any) as any)
          .insert({ contact_id: contactId, campaign_id: camp.id, status: 'pending', priority: 9999, attempts: 0, agent_id: userId })
          .select('id')
          .single();
        if (insertErr || !row) { onToast(insertErr?.message ?? 'Could not queue the redial', 'error'); return; }
        queueRowId = row.id;
      }
      queueLead = {
        id: c.id,
        contactId: c.id,
        phone: c.phone,
        name: c.name ?? c.phone,
        priority: 9999,
        attempts: 0,
        scheduledFor: null,
        status: 'pending',
        campaignId: camp.id,
        pipelineColumnId: c.pipeline_column_id ?? null,
        queueRowId,
      };
      refreshQueue();
    }
    void machine.dialLead(queueLead);
  }, [camp, deviceReady, state.phase, queue, machine, onToast, refreshQueue, userId]);

  // Contact for the call room columns — during a call use currentLead,
  // when idle fall back to the next lead in queue so COL 1 (SMS/WA/Email)
  // is always populated and ready to send.
  const activeContactId = state.currentLead?.contactId
    ?? (autoCallContactId && !autoCallFired.current ? autoCallContactId : null)
    ?? queue[0]?.contactId
    ?? null;
  const [contact, setContact] = useState<Contact | null>(null);

  // The close script belongs to the ONE lead the video funnel opened this room
  // for. "Next call" / "Dial next" then pull the next lead off the normal cold
  // queue, and without this the agent would still be looking at "I could see
  // you'd watched it" while a cold plumber picks up.
  const paneScriptKey = scriptForCall({
    openedWith: scriptKey,
    openedForContactId: closeCallContactIdRef.current,
    currentLeadContactId: state.currentLead?.contactId ?? null,
  });

  // The lead on the phone, through the same batched hook every other surface
  // uses, with a list of one.
  const funnelIds = useMemo(() => (contact?.id ? [contact.id] : []), [contact?.id]);
  const funnel = useContactFunnelStatus(funnelIds).get(contact?.id ?? '');
  useEffect(() => {
    if (!activeContactId) { setContact(null); return; }
    let cancelled = false;
    void (async () => {
      const [contactRes, tagsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contacts' as any) as any)
          .select('id, name, phone, email, owner_agent_id, pipeline_column_id, is_hot, deal_value_pence, custom_fields, created_at, last_contact_at')
          .eq('id', activeContactId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contact_tags' as any) as any)
          .select('tag')
          .eq('contact_id', activeContactId),
      ]);
      if (cancelled) return;
      if (contactRes.error || !contactRes.data) return;
      const d = contactRes.data;
      const tags = ((tagsRes.data ?? []) as { tag: string }[]).map((r) => r.tag);
      setContact({
        id: d.id, name: d.name ?? '', phone: d.phone ?? '',
        email: d.email ?? undefined, ownerAgentId: d.owner_agent_id ?? undefined,
        pipelineColumnId: d.pipeline_column_id ?? undefined, tags,
        isHot: d.is_hot ?? false, dealValuePence: d.deal_value_pence ?? undefined,
        customFields: d.custom_fields ?? {}, createdAt: d.created_at ?? new Date().toISOString(),
        lastContactAt: d.last_contact_at ?? undefined,
      });
    })();
    return () => { cancelled = true; };
  }, [activeContactId]);

  // Edit contact modal
  const [editing, setEditing] = useState<Contact | null>(null);

  const openEditContactById = useCallback(async (contactId: string) => {
    const [contactRes, tagsRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('wk_contacts' as any) as any)
        .select('id, name, phone, email, owner_agent_id, pipeline_column_id, is_hot, deal_value_pence, custom_fields, created_at, last_contact_at')
        .eq('id', contactId)
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('wk_contact_tags' as any) as any)
        .select('tag')
        .eq('contact_id', contactId),
    ]);
    if (contactRes.error || !contactRes.data) return;
    const d = contactRes.data;
    const tags = ((tagsRes.data ?? []) as { tag: string }[]).map((r) => r.tag);
    setEditing({
      id: d.id, name: d.name ?? '', phone: d.phone ?? '',
      email: d.email ?? undefined, ownerAgentId: d.owner_agent_id ?? undefined,
      pipelineColumnId: d.pipeline_column_id ?? undefined, tags,
      isHot: d.is_hot ?? false, dealValuePence: d.deal_value_pence ?? undefined,
      customFields: d.custom_fields ?? {}, createdAt: d.created_at ?? new Date().toISOString(),
      lastContactAt: d.last_contact_at ?? undefined,
    });
  }, []);

  // Suggest a disposition based on how the call ended — pre-selects
  // the button in the wrap-up card but never auto-applies it.
  const suggestedOutcomeId = useMemo(() => {
    if (state.phase !== 'wrap_up') return null;
    if (state.endReason === 'cancel' || state.endReason === 'reject' || state.endReason === 'error') {
      const col = outcomeColumns.find(
        (c) => c.name.toLowerCase().includes('no pickup') || c.name.toLowerCase() === 'no answer',
      );
      if (col) return col.id;
    }
    if (state.endReason === 'hangup' && state.durationSec !== null && state.durationSec > 0 && state.durationSec < 10) {
      const col = outcomeColumns.find((c) => c.name.toLowerCase().includes('voicemail'));
      if (col) return col.id;
    }
    // Fall back to the contact's current stage so the agent sees where
    // the lead is in the pipeline before picking a new disposition.
    const currentColId = contact?.pipelineColumnId ?? pipelineColumnId ?? null;
    if (currentColId && outcomeColumns.some((c) => c.id === currentColId)) {
      return currentColId;
    }
    return null;
  }, [state.phase, state.endReason, state.durationSec, outcomeColumns, contact?.pipelineColumnId, pipelineColumnId]);

  // Start dialer. 2026-05-22 (Hugo): when deviceReady is false (phone
  // dropped silently), attempt reconnect inline instead of bouncing
  // the user off a disabled button — that was the recurring "Start
  // Dialer doesn't work, hard refresh fixes it" symptom.
  const startDialer = useCallback(async () => {
    if (!camp) { onToast('Pick a campaign first', 'error'); return; }
    if (!deviceReady) {
      onToast('Phone is reconnecting — please wait…', 'info');
      const ok = await reconnectDevice();
      if (!ok) return;
    }
    if (spend.isLimitReached) { onToast('Daily spend limit reached', 'error'); return; }
    if (ks.allDialers) { onToast('All dialers paused (kill switch)', 'error'); return; }
    const next = await machine.pickNextLead(queue);
    if (!next) { onToast('No leads in queue', 'info'); return; }
    void machine.dialLead(next);
  }, [camp, deviceReady, reconnectDevice, spend.isLimitReached, ks.allDialers, machine, queue, onToast]);

  // Live call timer
  const [liveDuration, setLiveDuration] = useState(0);
  useEffect(() => {
    if (!state.startedAt || state.phase !== 'connected') { setLiveDuration(0); return; }
    const tick = () => setLiveDuration(Math.floor((Date.now() - state.startedAt!) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [state.startedAt, state.phase]);

  // Queue/History split ratio (percentage for queue width)
  const [queuePct, setQueuePct] = useState(50);
  const splitDragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isLive = state.phase === 'dialing' || state.phase === 'ringing' || state.phase === 'connected';

  // ─── Floating card: drag + minimize ────────────────────────────────
  const CARD_W = 380;
  const [cardPos, setCardPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem('dialer_pro_card_pos_v2');
      if (raw) { const p = JSON.parse(raw); if (typeof p?.x === 'number') return p; }
    } catch { /* ignore */ }
    return { x: Math.max(0, Math.floor((window.innerWidth - CARD_W) / 2)), y: 80 };
  });
  useEffect(() => { try { localStorage.setItem('dialer_pro_card_pos_v2', JSON.stringify(cardPos)); } catch { /* ignore */ } }, [cardPos]);

  const [historyCount, setHistoryCount] = useState(0);
  const [minimized, setMinimized] = useState(false);
  // 2026-05-22 (Hugo): toggle for the keypad popover inside the floating
  // GHL call card. The 4-column live-call layout shows the keypad
  // inline; this is the compact-card equivalent.
  const [keypadOpen, setKeypadOpen] = useState(false);
  useEffect(() => {
    if (state.phase === 'dialing') setMinimized(false);
  }, [state.phase]);
  const dragRef = useRef<{ offX: number; offY: number; moved: boolean } | null>(null);

  const onDragStart = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { offX: e.clientX - cardPos.x, offY: e.clientY - cardPos.y, moved: false };
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - (cardPos.x + dragRef.current.offX);
    const dy = e.clientY - (cardPos.y + dragRef.current.offY);
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
    setCardPos({
      x: Math.min(Math.max(e.clientX - dragRef.current.offX, 0), Math.max(0, window.innerWidth - CARD_W)),
      y: Math.min(Math.max(e.clientY - dragRef.current.offY, 56), Math.max(0, window.innerHeight - 80)),
    });
  };
  const onDragEnd = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      dragRef.current = null;
    }
  };

  // ─── Wrap-up action handlers ───────────────────────────────────────
  const saveNotesToContact = useCallback(async (contactId: string, notes: string) => {
    if (!notes.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_contacts' as any) as any)
      .select('custom_fields')
      .eq('id', contactId)
      .maybeSingle();
    const existing = (data?.custom_fields as Record<string, string>) ?? {};
    const prev = existing.notes ?? '';
    const stamp = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    const updated = prev ? `${notes.trim()} [${stamp}]\n${prev}` : `${notes.trim()} [${stamp}]`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('wk_contacts' as any) as any)
      .update({ custom_fields: { ...existing, notes: updated } })
      .eq('id', contactId);
  }, []);

  // When opened from a pipeline column, fetch contacts in that column
  // so "Next call" advances through the same column AND the queue list
  // shows them properly (wk_dialer_queue may not have these rows).
  const columnContactsRef = useRef<string[]>([]);
  const columnIndexRef = useRef(0);
  const [columnLeads, setColumnLeads] = useState<QueueLead[]>([]);
  useEffect(() => {
    if (!pipelineColumnId) { columnContactsRef.current = []; setColumnLeads([]); return; }
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let colQ = (supabase.from('wk_contacts' as any) as any)
        .select('id, name, phone, pipeline_column_id, custom_fields')
        .eq('pipeline_column_id', pipelineColumnId)
        .order('created_at', { ascending: true });
      if (impId) colQ = colQ.eq('owner_agent_id', impId);
      const { data } = await colQ;
      const rows = (data ?? []) as { id: string; name: string | null; phone: string | null; pipeline_column_id: string | null; custom_fields: Record<string, string> | null }[];
      columnContactsRef.current = rows.map((r) => r.id);
      const leads: QueueLead[] = rows
        .filter((r) => r.phone)
        .map((r) => ({
          id: r.id,
          contactId: r.id,
          phone: r.phone!,
          name: r.name ?? r.phone!,
          ownerName: (r.custom_fields?.owner_name || '').trim() || null,
          website: (r.custom_fields?.website || '').trim() || null,
          priority: 0,
          attempts: 0,
          scheduledFor: null,
          status: 'pending' as const,
          campaignId: camp?.id ?? '',
          pipelineColumnId: r.pipeline_column_id ?? null,
          queueRowId: r.id,
        }));
      setColumnLeads(leads);
      if (autoCallContactId) {
        const idx = columnContactsRef.current.indexOf(autoCallContactId);
        columnIndexRef.current = idx >= 0 ? idx : 0;
      }
    })();
  }, [pipelineColumnId, autoCallContactId, camp?.id, impId]);

  const dialColumnContact = useCallback(async (contactId: string) => {
    if (!camp) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: c } = await (supabase.from('wk_contacts' as any) as any)
      .select('id, name, phone, pipeline_column_id')
      .eq('id', contactId)
      .maybeSingle();
    if (!c?.phone) { onToast('Contact has no phone number', 'error'); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRow } = await (supabase.from('wk_dialer_queue' as any) as any)
      .select('id')
      .eq('contact_id', contactId)
      .eq('campaign_id', camp.id)
      .maybeSingle();
    let queueRowId: string;
    if (existingRow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('wk_dialer_queue' as any) as any)
        .update({ status: 'pending', priority: 9999 })
        .eq('id', existingRow.id);
      queueRowId = existingRow.id;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error: insertErr } = await (supabase.from('wk_dialer_queue' as any) as any)
        .insert({ contact_id: contactId, campaign_id: camp.id, status: 'pending', priority: 9999, attempts: 0, agent_id: userId })
        .select('id').single();
      if (insertErr || !row) { onToast('Could not add contact to queue', 'error'); return; }
      queueRowId = row.id;
    }
    const lead: QueueLead = {
      id: c.id, contactId: c.id, phone: c.phone, name: c.name ?? c.phone,
      priority: 9999, attempts: 0, scheduledFor: null, status: 'pending',
      campaignId: camp.id, pipelineColumnId: c.pipeline_column_id ?? null, queueRowId,
    };
    refreshQueue();
    void machine.dialLead(lead);
  }, [camp, machine, onToast, refreshQueue]);

  const handleWrapUpNext = useCallback(async (colId: string | null, notes: string) => {
    const lead = state.currentLead;
    if (colId) {
      await machine.applyOutcome(colId, notes.trim() || undefined);
    } else {
      machine.skip();
    }
    if (lead) {
      void saveNotesToContact(lead.contactId, notes);
      removeFromQueue(lead.contactId);
    }
    if (state.pauseAfterCall) {
      setTimeout(() => machine.pause(), 200);
      return;
    }
    setTimeout(async () => {
      if (pipelineColumnId && columnContactsRef.current.length > 0) {
        columnIndexRef.current += 1;
        if (columnIndexRef.current < columnContactsRef.current.length) {
          void dialColumnContact(columnContactsRef.current[columnIndexRef.current]);
        } else {
          onToast('End of column — no more leads', 'info');
        }
        return;
      }
      const next = await machine.pickNextLead(queue);
      if (next) void machine.dialLead(next);
      else onToast('Queue empty', 'info');
    }, 200);
  }, [machine, queue, onToast, state.currentLead, state.pauseAfterCall, saveNotesToContact, removeFromQueue, pipelineColumnId, dialColumnContact]);

  const handleWrapUpRedial = useCallback(async (colId: string | null, notes: string) => {
    const lead = state.currentLead;
    if (colId) {
      await machine.applyOutcome(colId, notes.trim() || undefined);
    } else {
      machine.skip();
    }
    if (lead) {
      void saveNotesToContact(lead.contactId, notes);
      setTimeout(() => void machine.dialLead(lead), 200);
    }
  }, [machine, state.currentLead, saveNotesToContact]);

  const handleWrapUpPause = useCallback(async (colId: string | null, notes: string) => {
    const lead = state.currentLead;
    if (colId) {
      await machine.applyOutcome(colId, notes.trim() || undefined);
    } else {
      machine.skip();
    }
    if (lead) {
      void saveNotesToContact(lead.contactId, notes);
      removeFromQueue(lead.contactId);
    }
    setTimeout(() => machine.pause(), 200);
  }, [machine, state.currentLead, saveNotesToContact, removeFromQueue]);

  // Hugo 2026-05-28: fire as soon as a Custom Disposition column is
  // clicked, BEFORE "Next call". Saves the outcome via the same
  // wk-outcome-apply edge function applyOutcome uses, but does NOT
  // dispatch OUTCOME_DONE — the state machine stays in wrap_up so the
  // VA can keep editing notes / change disposition before advancing.
  const handleApplyOutcomeNow = useCallback(async (colId: string, notes: string) => {
    const lead = state.currentLead;
    if (!lead || !state.currentCallId) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.functions as any).invoke('wk-outcome-apply', {
        body: {
          call_id: state.currentCallId,
          contact_id: lead.contactId,
          column_id: colId,
          agent_note: notes?.trim() || null,
        },
      });
      if (error) {
        onToast(`Outcome failed: ${error.message}`, 'error');
        return;
      }
      onToast('Outcome saved', 'success');
    } catch (e) {
      onToast(`Outcome failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [state.currentLead, state.currentCallId, onToast]);

  return (
    <div className="relative h-full flex flex-col bg-[#F3F3EE]">
      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed top-16 right-4 z-[250] space-y-1">
          {toasts.map((t) => (
            <div key={t.id} className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium shadow-md',
              t.type === 'error' && 'bg-red-50 text-red-700 border border-red-200',
              t.type === 'success' && 'bg-[#EEF2F8] text-[#3C5A87] border border-[#3C5A87]/20',
              t.type === 'info' && 'bg-white text-[#6B7280] border border-[#E5E7EB]',
            )}>{t.msg}</div>
          ))}
        </div>
      )}

      {/* ─── BACKGROUND: 4-column call room (always mounted, sticky) ─── */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="dialer-pro-call-layout-v4"
          className="h-full"
        >
          {/* COL 1 — Contact + SMS / WhatsApp (always visible) */}
          <ResizablePanel defaultSize={22} minSize={16} className="bg-white border-r border-[#E5E7EB] flex flex-col overflow-hidden">
            {contact ? (
              <>
                <div className="px-4 py-3 border-b border-[#E5E7EB]">
                  <div className="flex items-center gap-2">
                    <div className="text-[16px] font-bold text-[#1A1A1A]"><EditableName value={contact.name} onSave={(n) => renameContact(contact.id, n)} className="text-[16px] font-bold" /></div>
                    {contact.isHot && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                        <Flame className="w-3 h-3" /> HOT
                      </span>
                    )}
                    {/* Hugo 2026-07-27: edit the lead from here — name, the
                        person's name, email, phone — without leaving the call. */}
                    <button
                      onClick={() => setEditing(contact)}
                      data-testid="dialer-edit-contact"
                      title="Edit this lead — name, person, email, phone"
                      className="ml-auto p-1 rounded text-[#6B7280] hover:text-[#3C5A87] hover:bg-[#EEF2F8] flex-shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Owner name + website beside the company name, everywhere
                      (Hugo 2026-07-26) — explicit "not available" when missing. */}
                  <ContactIdentity
                    owner={contact.customFields?.owner_name}
                    website={contact.customFields?.website}
                    layout="stack"
                    size="sm"
                    className="mt-0.5 space-y-0.5"
                  />
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[12px] text-[#6B7280] tabular-nums">{contact.phone}</span>
                    <CalcChip calcAt={funnel?.calcAt} count={funnel?.calcCount} />
                    <AgentChip agentId={contact.ownerAgentId} size="xs" className="ml-auto" />
                  </div>
                  {!isLive && !state.currentLead && (
                    <div className="text-[10px] text-[#9CA3AF] mt-1">Next in queue</div>
                  )}
                  <div className="mt-2"><ContactMetaCompact contact={contact} /></div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[12px]">
                  {/* Keypad moved to a button on the dialer card; the SMS /
                      WhatsApp / Email send box moved to the Messages tab on
                      the right. COL 1 is now the contact context + timeline. */}
                  <CallTimeline callId={state.currentCallId} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                <MessageSquare className="w-8 h-8 text-[#E5E7EB]" />
                <div className="text-sm font-medium text-[#9CA3AF]">Contact details</div>
                <div className="text-xs text-[#9CA3AF]">No leads in queue</div>
              </div>
            )}
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* COL 2 — Sales script: editable (admin), lean, read live. */}
          <ResizablePanel defaultSize={48} minSize={26} className="border-r border-[#E5E7EB] overflow-hidden">
            {/* key= forces a clean remount on a script switch. Without it the
                pane's srcDoc changes while its captured template/docReady state
                is still the old script's, and the onLoad it depends on may
                already have fired — leaving the previous script (or a blank
                pane) on screen at the exact moment it matters. */}
            <DialerScriptPane key={paneScriptKey} contact={contact} scriptKey={paneScriptKey} />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* COL 3 — Right tabs: Calculator (default) / Objections / Messages.
              The Messages tab is the send box on top + history below, following
              the same contact as COL 1 (live call → currentLead, else next in
              queue). */}
          <ResizablePanel defaultSize={30} minSize={16} className="overflow-hidden">
            <DialerRightTabs
              contactId={activeContactId ?? undefined}
              contactName={contact?.name}
              contactPhone={contact?.phone}
              contactEmail={contact?.email}
              ownerName={contact?.customFields?.owner_name}
              agentFirstName={agentFirstName}
              campaignId={camp?.id ?? null}
              pipelineId={camp?.pipelineId ?? null}
              currentCallId={state.currentCallId}
              callConnected={state.phase === 'connected'}
              liveDurationSec={liveDuration}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* ─── FLOATING CARD + Queue/History (always visible, draggable) ─── */}
      <div className="fixed z-[210] select-text" style={{ left: cardPos.x, top: cardPos.y, width: CARD_W }}>
        {/* Idle card — same card shape as Outgoing Call, with Start button instead of End Call */}
        {!(isLive || state.phase === 'wrap_up') && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.18)] overflow-hidden">
            {/* Header — draggable */}
            <div
              onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#F3F3EE] border-b border-[#E5E7EB] cursor-grab active:cursor-grabbing"
            >
              <Phone className="w-4 h-4 text-[#3C5A87]" />
              <span className="text-[12px] font-semibold text-[#6B7280]">
                {state.phase === 'paused' ? 'Paused' : 'Power Dialer'}
              </span>
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setKeypadOpen((v) => !v)}
                title="Open keypad"
                className={cn('p-1 rounded-md transition-colors',
                  keypadOpen ? 'bg-[#3C5A87] text-white' : 'text-[#6B7280] hover:bg-white/70')}>
                <Hash className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-[#9CA3AF] truncate ml-auto">{agentFirstName}</span>
            </div>

            {/* Keypad popover — opened from the header button. DTMF only fires
                once a call is connected; here it shows greyed as a preview. */}
            {keypadOpen && (
              <div className="px-3 py-2 border-b border-[#E5E7EB] bg-[#F3F3EE]/40">
                <DtmfKeypad
                  enabled={state.phase === 'connected'}
                  onDigit={machine.sendDigit}
                  callId={state.currentCallId}
                  size="compact"
                />
              </div>
            )}

            {/* Avatar area */}
            <div className="flex flex-col items-center py-5 px-4">
              <div className="w-20 h-20 rounded-full bg-[#E5E7EB] flex items-center justify-center text-[#9CA3AF] text-[28px] font-bold mb-3">
                <Phone className="w-8 h-8" />
              </div>
              <div className="text-[14px] font-medium text-[#6B7280]">
                {queue.length > 0 ? `${queue.length} leads in queue` : 'Queue empty'}
              </div>
              {queue[0] && (
                <div className="text-[12px] text-[#9CA3AF] mt-1">
                  Next: {queue[0].name}
                </div>
              )}
              {/* Campaign selector */}
              {campaigns.length > 1 && (
                <select value={activeCampaignId} onChange={(e) => setActiveCampaignId(e.target.value)}
                  className="mt-2 text-[11px] border border-[#E5E7EB] rounded-lg px-2 py-1 bg-white text-[#6B7280]">
                  {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              )}
            </div>

            {/* Phone status banner — fully automatic recovery, agent
                rarely sees this. Reconnecting state shows during normal
                self-heal; manual Reconnect button only appears after the
                auto-loop has been retrying for a while (true outage). */}
            {!deviceReady && (
              <div className="px-3 pb-2">
                <div className="bg-[#F3F3EE] border border-[#E5E7EB] rounded-xl px-3 py-2 flex items-center gap-2 text-[12px]">
                  <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[#F59E0B] animate-pulse" />
                  <span className="flex-1 text-[#6B7280]">
                    Reconnecting phone…
                  </span>
                  {!reconnecting && (
                    <button onClick={() => void reconnectDevice()}
                      className="text-[11px] font-semibold text-[#3C5A87] hover:bg-[#EEF2F8] px-2 py-1 rounded-md">
                      Retry now
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Start / Resume / Dial next button.
                2026-05-22 (Hugo): button no longer disables on !deviceReady —
                startDialer() now triggers an inline reconnect when the phone
                is down, so the agent doesn't get the "button greyed out and
                I don't know why" failure mode. Spend/kill-switch/empty-queue
                still disable as before. */}
            <div className="px-3 pb-3">
              {state.phase === 'paused' ? (
                <div className="flex gap-2">
                  <button onClick={() => { machine.resume(); void startDialer(); }} disabled={spend.isLimitReached || ks.allDialers || reconnecting}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#3C5A87] hover:bg-[#3C5A87]/90 text-white text-[14px] font-semibold py-3 rounded-xl transition-colors shadow-[0_4px_12px_rgba(30,154,128,0.35)] disabled:opacity-50">
                    <Play className="w-4 h-4" /> Resume
                  </button>
                  <button onClick={() => void machine.stop()}
                    className="flex items-center justify-center gap-2 border border-[#FECACA] text-[#B91C1C] text-[14px] font-semibold py-3 px-4 rounded-xl hover:bg-[#FEF2F2]">
                    <Square className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button onClick={() => void startDialer()} disabled={spend.isLimitReached || ks.allDialers || !camp || queue.length === 0 || reconnecting}
                  className="w-full flex items-center justify-center gap-2 bg-[#3C5A87] hover:bg-[#3C5A87]/90 text-white text-[14px] font-semibold py-3 rounded-xl transition-colors shadow-[0_4px_12px_rgba(30,154,128,0.35)] disabled:opacity-50 disabled:cursor-not-allowed">
                  <Phone className="w-4 h-4" /> {state.sessionStarted ? 'Dial next' : 'Start dialer'}
                </button>
              )}
              {/* Live session voicemail-drop tally (resets when the session stops) */}
              {state.sessionDrops > 0 && (
                <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[#6B7280]">
                  <Voicemail className="w-3.5 h-3.5 text-[#3C5A87]" strokeWidth={1.8} />
                  <span className="tabular-nums font-semibold text-[#1A1A1A]">{state.sessionDrops}</span>
                  voicemail{state.sessionDrops === 1 ? '' : 's'} dropped this session
                </div>
              )}
            </div>
          </div>
        )}
        {/* Call card — only when live or wrap-up */}
        {(isLive || state.phase === 'wrap_up') && state.currentLead && (
          minimized ? (
            /* ── Minimized bar: name + timer + quick controls ── */
            <div
              onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl shadow-[0_12px_28px_rgba(0,0,0,0.15)] cursor-grab active:cursor-grabbing"
            >
              <span className="w-2 h-2 rounded-full bg-[#B91C1C] flex-shrink-0" />
              <span className="text-[12px] font-semibold text-[#1A1A1A] truncate flex-1">
                {state.currentLead.name}
              </span>
              {state.phase === 'connected' && (
                <span className="text-[11px] font-mono text-[#6B7280] tabular-nums flex-shrink-0">
                  {formatDuration(liveDuration)}
                </span>
              )}
              {isLive && (
                <button onPointerDown={(e) => e.stopPropagation()} onClick={machine.muteToggle}
                  className={cn('px-2 py-0.5 rounded-md text-[10px] font-medium flex-shrink-0',
                    state.isMuted ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#F3F3EE] text-[#6B7280] hover:bg-[#E5E7EB]')}>
                  {state.isMuted ? 'Unmute' : 'Mute'}
                </button>
              )}
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setMinimized(false)}
                className="p-1 rounded-md hover:bg-[#F3F3EE] text-[#6B7280] flex-shrink-0">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : isLive ? (
            /* ── Card A: Outgoing Call ── */
            <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.18)] overflow-hidden">
              {/* Header — draggable */}
              <div
                onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#F3F3EE] border-b border-[#E5E7EB] cursor-grab active:cursor-grabbing"
              >
                <Phone className="w-4 h-4 text-[#3C5A87]" />
                <span className="text-[12px] font-semibold text-[#6B7280]">
                  {state.phase === 'connected' ? 'Connected' : 'Outgoing Call'}
                </span>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setKeypadOpen((v) => !v)}
                  title="Open keypad"
                  className={cn('p-1 rounded-md transition-colors',
                    keypadOpen ? 'bg-[#3C5A87] text-white' : 'text-[#6B7280] hover:bg-white/70')}>
                  <Hash className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-[#9CA3AF] truncate ml-auto">{agentFirstName}</span>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setMinimized(true)}
                  className="p-0.5 rounded hover:bg-white/60 text-[#6B7280]">
                  <Minus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Avatar + lead info + timer */}
              <div className="flex flex-col items-center py-5 px-4">
                <div className="w-20 h-20 rounded-full bg-[#3C5A87] flex items-center justify-center text-white text-[28px] font-bold mb-3">
                  {(state.currentLead.name ?? '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="text-[15px] font-semibold text-[#1A1A1A] truncate max-w-full">{state.currentLead.name}</div>
                <div className="text-[13px] text-[#6B7280] tabular-nums mt-0.5">{state.currentLead.phone}</div>
                {contact?.customFields?.property_address && (
                  <div className="text-[11px] text-[#6B7280] mt-1.5 truncate max-w-full px-2 text-center" title={contact.customFields.property_address}>
                    📍 {contact.customFields.property_address}
                  </div>
                )}
                {contact?.customFields?.property_url && (() => {
                  const raw = contact.customFields.property_url.trim();
                  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                  const label = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-[#3C5A87] underline decoration-[#3C5A87]/40 hover:decoration-[#3C5A87] cursor-pointer mt-0.5 truncate max-w-full px-2 text-center inline-block"
                      title={href}
                    >
                      {label}
                    </a>
                  );
                })()}
                <div className="text-[18px] font-semibold text-[#1A1A1A] tabular-nums mt-2">
                  {state.phase === 'connected' ? formatDuration(liveDuration) : (
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              </div>

              {/* 2x4 action buttons — GHL layout */}
              <div className="px-3 pb-2 space-y-1.5">
                {/* Row 1: Message | Notes | Drop VM | Warm Transfer */}
                <div className="grid grid-cols-4 gap-1.5">
                  <button onClick={() => setMinimized(true)}
                    className="flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A] transition-colors">
                    <MessageSquare className="w-4 h-4" strokeWidth={1.8} />
                    Message
                  </button>
                  <button onClick={() => setMinimized(true)}
                    className="flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A] transition-colors">
                    <FileText className="w-4 h-4" strokeWidth={1.8} />
                    Notes
                  </button>
                  <button
                    onClick={() => void machine.dropVoicemail()}
                    disabled={!canDropVm}
                    title={dropVmHint}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium transition-colors',
                      !canDropVm
                        ? 'text-[#9CA3AF] cursor-not-allowed'
                        : 'text-[#3C5A87] hover:bg-[#EEF2F8] hover:text-[#3C5A87]',
                    )}
                  >
                    <Voicemail className="w-4 h-4" strokeWidth={1.8} />
                    Drop VM
                  </button>
                  <button disabled
                    className="flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium text-[#9CA3AF] cursor-not-allowed transition-colors">
                    <PhoneForwarded className="w-4 h-4" strokeWidth={1.8} />
                    Warm
                  </button>
                </div>
                {/* Row 2: Hold | Mute | Scripts | Dial (DTMF pad) */}
                <div className="grid grid-cols-4 gap-1.5">
                  <button onClick={machine.holdToggle}
                    className={cn('flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium transition-colors',
                      state.isOnHold ? 'bg-[#FEF3C7] text-[#92400E]' : 'text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A]',
                    )}>
                    <PauseIcon className="w-4 h-4" strokeWidth={1.8} />
                    Hold
                  </button>
                  <button onClick={machine.muteToggle}
                    className={cn('flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium transition-colors',
                      state.isMuted ? 'bg-[#FEF3C7] text-[#92400E]' : 'text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A]',
                    )}>
                    {state.isMuted ? <MicOff className="w-4 h-4" strokeWidth={1.8} /> : <Mic className="w-4 h-4" strokeWidth={1.8} />}
                    Mute
                  </button>
                  <button onClick={() => setMinimized(true)}
                    className="flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A] transition-colors">
                    <FileText className="w-4 h-4" strokeWidth={1.8} />
                    Scripts
                  </button>
                  <button
                    onClick={() => setKeypadOpen((v) => !v)}
                    disabled={state.phase !== 'connected'}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium transition-colors',
                      state.phase !== 'connected'
                        ? 'text-[#9CA3AF] cursor-not-allowed'
                        : keypadOpen
                          ? 'bg-[#3C5A87] text-white'
                          : 'text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A]',
                    )}
                    title="Open IVR keypad"
                  >
                    <Hash className="w-4 h-4" strokeWidth={1.8} />
                    Dial
                  </button>
                </div>
              </div>

              {/* IVR keypad — collapses inline when toggled on. Sends
                  DTMF tones over the active call via Call.sendDigits. */}
              {keypadOpen && state.phase === 'connected' && (
                <div className="px-3 pb-2">
                  <DtmfKeypad
                    enabled
                    onDigit={machine.sendDigit}
                    callId={state.currentCallId}
                    size="compact"
                  />
                </div>
              )}

              {/* End Call button */}
              <div className="px-3 pb-3">
                <button onClick={() => void machine.hangUp()}
                  className="w-full flex items-center justify-center gap-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[14px] font-semibold py-3 rounded-xl transition-colors">
                  <PhoneOff className="w-4 h-4" /> End Call
                </button>
              </div>
            </div>
          ) : (
            /* ── Card B: Call Summary / Wrap-up ── */
            <WrapUpCard
              lead={state.currentLead}
              endReason={state.endReason}
              durationSec={state.durationSec}
              columns={outcomeColumns}
              columnsLoading={outcomeColumnsLoading}
              campaignPipelineId={camp?.pipelineId ?? null}
              suggestedId={suggestedOutcomeId}
              applying={machine.applying}
              onNext={handleWrapUpNext}
              onApply={handleApplyOutcomeNow}
              onSkip={machine.skip}
              onRedial={handleWrapUpRedial}
              onPause={handleWrapUpPause}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onMinimize={() => setMinimized(true)}
            />
          )
        )}

        {/* ─── Queue + History: side-by-side, resizable ─── */}
        <div
          ref={splitContainerRef}
          className="flex bg-white border border-[#E5E7EB] border-t-0 rounded-b-2xl shadow-[0_12px_28px_rgba(0,0,0,0.1)] overflow-hidden"
        >
          {/* Queue column */}
          <div className="flex flex-col overflow-hidden" style={{ width: `${queuePct}%` }}>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[#E5E7EB]/60 bg-[#F3F3EE]/50">
              <span className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide">Queue</span>
              <span className="text-[10px] text-[#9CA3AF]">
                ({pipelineColumnId ? columnLeads.length : queue.length})
              </span>
              {pipelineColumnId && (
                <span className="text-[9px] bg-[#EEF2F8] text-[#3C5A87] px-1.5 py-0.5 rounded-full font-medium">
                  {outcomeColumns.find((c) => c.id === pipelineColumnId)?.name ?? 'Column'}
                </span>
              )}
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              <QueueManagerPro
                queue={pipelineColumnId ? columnLeads : queue}
                campaignId={camp?.id ?? null}
                onRefresh={refreshQueue}
                onToast={onToast}
              />
            </div>
          </div>
          {/* Resize handle */}
          <div
            className="w-1 bg-[#E5E7EB] hover:bg-[#3C5A87]/40 cursor-col-resize flex-shrink-0 transition-colors"
            onPointerDown={(e) => {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              splitDragRef.current = { startX: e.clientX, startPct: queuePct };
            }}
            onPointerMove={(e) => {
              if (!splitDragRef.current || !splitContainerRef.current) return;
              const containerW = splitContainerRef.current.offsetWidth;
              const dx = e.clientX - splitDragRef.current.startX;
              const newPct = splitDragRef.current.startPct + (dx / containerW) * 100;
              setQueuePct(Math.min(80, Math.max(20, newPct)));
            }}
            onPointerUp={(e) => {
              try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
              splitDragRef.current = null;
            }}
            onPointerCancel={(e) => {
              try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
              splitDragRef.current = null;
            }}
          />
          {/* History column */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[#E5E7EB]/60 bg-[#F3F3EE]/50">
              <span className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide">History</span>
              <span className="text-[10px] text-[#9CA3AF]">({historyCount})</span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              <CallHistoryPro onCountChange={setHistoryCount} onEditContact={openEditContactById} onRedial={handleRedial} />
            </div>
          </div>
        </div>
      </div>

      {/* Edit contact modal */}
      {editing && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999]">
          <EditContactModal
            contact={editing}
            onClose={() => setEditing(null)}
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
              setEditing(null);
              setContact(updated);
            }}
          />
        </div>,
        document.body,
      )}

      <DialerDebugOverlay
        phase={state.phase}
        deviceReady={deviceReady}
        sessionStarted={state.sessionStarted}
        currentLeadName={state.currentLead?.name ?? null}
        currentCallId={state.currentCallId}
        endReason={state.endReason}
        error={state.error}
        queueLen={queue.length}
        campaignName={camp?.name ?? null}
        userId={userId}
        spendBlocked={spend.isLimitReached}
        killSwitchOn={ks.allDialers}
        log={debugLog}
      />
    </div>
  );
}

// ─── DialerDebugOverlay ─────────────────────────────────────────────
// Visible only when the URL has ?debug=1. Shows live machine state and
// a rolling log of the last 12 toasts so agents can screenshot what's
// happening when the dialer behaves unexpectedly.

interface DialerDebugOverlayProps {
  phase: string;
  deviceReady: boolean;
  sessionStarted: boolean;
  currentLeadName: string | null;
  currentCallId: string | null;
  endReason: string | null;
  error: string | null;
  queueLen: number;
  campaignName: string | null;
  userId: string | null;
  spendBlocked: boolean;
  killSwitchOn: boolean;
  log: Array<{ t: number; msg: string; type: string }>;
}

function DialerDebugOverlay(props: DialerDebugOverlayProps) {
  const [enabled, setEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setEnabled(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);
  if (!enabled) return null;

  const ts = (n: number) => new Date(n).toLocaleTimeString();
  const copyAll = () => {
    const lines = [
      `phase=${props.phase}`,
      `deviceReady=${props.deviceReady}`,
      `sessionStarted=${props.sessionStarted}`,
      `currentLead=${props.currentLeadName ?? '-'}`,
      `currentCallId=${props.currentCallId ?? '-'}`,
      `endReason=${props.endReason ?? '-'}`,
      `error=${props.error ?? '-'}`,
      `queue=${props.queueLen}`,
      `camp=${props.campaignName ?? '-'}`,
      `user=${props.userId ?? '-'}`,
      `spendBlocked=${props.spendBlocked}`,
      `killSwitch=${props.killSwitchOn}`,
      '--- log ---',
      ...props.log.map((l) => `${ts(l.t)} [${l.type}] ${l.msg}`),
    ].join('\n');
    void navigator.clipboard?.writeText(lines).catch(() => { /* ignore */ });
  };

  return (
    <div
      className="fixed bottom-2 left-2 z-[300] bg-black/85 text-white text-[10px] font-mono p-2 rounded-lg max-w-[320px] border border-white/20 shadow-xl"
      data-testid="dialer-debug-overlay"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold text-[#3C5A87]">DIALER DEBUG</span>
        <button
          onClick={copyAll}
          className="ml-auto px-1.5 py-0.5 bg-white/10 rounded hover:bg-white/20"
          title="Copy debug snapshot"
        >copy</button>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="px-1.5 py-0.5 bg-white/10 rounded hover:bg-white/20"
        >{collapsed ? '▾' : '▴'}</button>
      </div>
      {!collapsed && (
        <>
          <div className="space-y-0.5">
            <div>phase: <span className="text-[#D8E1EE]">{props.phase}</span></div>
            <div>deviceReady: <span className={props.deviceReady ? 'text-[#D8E1EE]' : 'text-[#F87171]'}>{String(props.deviceReady)}</span></div>
            <div>sessionStarted: {String(props.sessionStarted)}</div>
            <div>currentLead: {props.currentLeadName ?? '-'}</div>
            <div className="truncate">currentCallId: {props.currentCallId ?? '-'}</div>
            <div>endReason: {props.endReason ?? '-'}</div>
            {props.error && <div className="text-[#F87171] break-words">error: {props.error}</div>}
            <div>queue: {props.queueLen}</div>
            <div className="truncate">camp: {props.campaignName ?? '-'}</div>
            <div className="truncate">user: {props.userId ?? '-'}</div>
            {(props.spendBlocked || props.killSwitchOn) && (
              <div className="text-[#FBBF24]">
                {props.spendBlocked && 'spend-blocked '}
                {props.killSwitchOn && 'kill-switch'}
              </div>
            )}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-white/15">
            <div className="text-white/60 mb-0.5">log (last {props.log.length})</div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {props.log.length === 0 && <div className="text-white/40">no events yet</div>}
              {props.log.slice().reverse().map((l) => (
                <div key={l.t} className={cn(
                  'leading-tight',
                  l.type === 'error' && 'text-[#F87171]',
                  l.type === 'success' && 'text-[#D8E1EE]',
                  l.type === 'info' && 'text-white/80',
                )}>
                  {ts(l.t)} {l.msg}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── WrapUpCard ─────────────────────────────────────────────────────
// Dispositions from wk_pipeline_columns (wired to /crm/pipelines).
// Does NOT write to Supabase directly — passes column_id (UUID) to
// parent, which calls machine.applyOutcome → wk-outcome-apply edge fn.

interface WrapUpCardProps {
  lead: QueueLead;
  endReason: string | null;
  durationSec: number | null;
  columns: PipelineColumnRow[];
  /** True while usePipelineColumns is still fetching. Lets us show a
   *  spinner instead of the "No pipeline linked" hint during the
   *  brief window between call-ended and columns-resolved. */
  columnsLoading?: boolean;
  /** Resolved pipeline_id for the campaign. Used to disambiguate the
   *  empty-state copy: null → "Link a pipeline"; set but no columns →
   *  "Pipeline has no columns". */
  campaignPipelineId?: string | null;
  suggestedId: string | null;
  applying: boolean;
  onNext: (columnId: string | null, notes: string) => void;
  /** Hugo 2026-05-28: fired the moment the VA clicks a Custom Disposition
   *  button. Saves the outcome immediately so the VA gets feedback even
   *  if they never click "Next call". The state machine stays in wrap_up
   *  so they can keep editing notes / change column / etc. */
  onApply?: (columnId: string, notes: string) => void | Promise<void>;
  onSkip: () => void;
  onRedial: (columnId: string | null, notes: string) => void;
  onPause: (columnId: string | null, notes: string) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (e: React.PointerEvent) => void;
  onMinimize: () => void;
}

function WrapUpCard({ lead, endReason, durationSec, columns, columnsLoading = false, campaignPipelineId = null, suggestedId, applying, onNext, onApply, onSkip, onRedial, onPause, onDragStart, onDragMove, onDragEnd, onMinimize }: WrapUpCardProps) {
  const [pickedId, setPickedId] = useState<string | null>(suggestedId);
  const [notes, setNotes] = useState('');
  const [showMore, setShowMore] = useState(false);

  const VISIBLE_COUNT = 6;
  const visibleCols = columns.slice(0, VISIBLE_COUNT);
  const moreCols = columns.slice(VISIBLE_COUNT);

  const formatMin = (sec: number | null) => {
    if (sec === null || sec <= 0) return '00 Min 00 Sec';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')} Min ${String(s).padStart(2, '0')} Sec`;
  };

  const renderButton = (col: PipelineColumnRow) => {
    const isPicked = pickedId === col.id;
    return (
      <button
        key={col.id}
        onClick={() => {
          const nextPicked = isPicked ? null : col.id;
          setPickedId(nextPicked);
          // Save the outcome immediately on selection (Hugo 2026-05-28).
          // The "Next call" button is still the canonical advance — this
          // is an early write-through so picking a column persists right
          // away. Re-clicking the same column deselects locally; we don't
          // unwrite the saved outcome (the server keeps the latest pick).
          if (nextPicked && onApply) {
            void onApply(nextPicked, notes);
          }
        }}
        disabled={applying}
        className={cn(
          'flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-medium text-left transition-all',
          isPicked
            ? 'bg-[#1A1A1A] text-white'
            : pickedId !== null
              ? 'bg-[#F3F3EE] text-[#9CA3AF]'
              : 'bg-[#F3F3EE] text-[#1A1A1A] hover:bg-[#E5E7EB]',
        )}>
        <span className="truncate">{col.name}</span>
        <Circle className={cn('w-4 h-4 flex-shrink-0', isPicked ? 'text-white fill-white' : 'text-[#9CA3AF]')} strokeWidth={isPicked ? 0 : 1.5} />
      </button>
    );
  };

  return (
      <div className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.18)] border border-[#E5E7EB] overflow-hidden max-h-[calc(100vh-80px)] overflow-y-auto w-full">
        {/* Header — draggable */}
        <div
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
          className="flex items-center gap-2 px-4 py-3 border-b border-[#E5E7EB]/60 cursor-grab active:cursor-grabbing"
        >
          <Phone className="text-[#3C5A87] w-5 h-5" />
          <span className="font-semibold text-[#1A1A1A]">Call Summary</span>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={onMinimize}
            className="ml-auto p-0.5 rounded hover:bg-[#F3F3EE] text-[#6B7280]">
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Lead info + badges + duration */}
        <div className="px-4 py-3 border-b border-[#E5E7EB]/60">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#1A1A1A] truncate">{lead.name}</span>
            <span className="text-[#9CA3AF] text-sm tabular-nums">{lead.phone}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="flex items-center gap-1 text-[#B91C1C] text-[12px]">
              <PhoneOff className="w-3.5 h-3.5" /> Call Ended
            </span>
            {endReason && (
              <span className="text-[#6B7280] text-[11px] bg-[#F3F3EE] rounded-full px-2 py-0.5">
                {endReason === 'hangup' ? 'Hangup' : endReason === 'vm_drop' ? 'Voicemail dropped' : endReason === 'cancel' || endReason === 'reject' ? 'No-answer' : endReason}
              </span>
            )}
          </div>
          <div className="text-center mt-2">
            <span className="inline-block bg-[#F3F3EE] text-[#6B7280] text-[13px] font-medium px-4 py-1 rounded-full">
              {formatMin(durationSec)}
            </span>
          </div>
        </div>

        {/* Skip (no disposition) */}
        <div className="px-4 pt-3 pb-1">
          <button onClick={onSkip} disabled={applying}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[#6B7280] hover:text-[#1A1A1A] disabled:opacity-50">
            <SkipForward className="w-3.5 h-3.5" /> Skip (no disposition)
          </button>
        </div>

        {/* Disposition grid — from pipeline columns (wk_pipeline_columns) */}
        <div className="px-4 py-2">
          <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">Custom Disposition</p>
          {columns.length === 0 ? (
            columnsLoading ? (
              <div className="text-[12px] text-[#6B7280] bg-[#F3F3EE] rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-[#3C5A87] border-t-transparent animate-spin" />
                Loading pipeline stages…
              </div>
            ) : !campaignPipelineId ? (
              <div className="text-[12px] text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] rounded-lg px-3 py-2 leading-relaxed">
                No pipeline linked to this campaign. Open{' '}
                <span className="font-semibold">Settings → Overview</span> for
                this campaign and pick a pipeline so outcomes route correctly.
              </div>
            ) : (
              <div className="text-[12px] text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] rounded-lg px-3 py-2 leading-relaxed">
                The linked pipeline has no columns yet. Open{' '}
                <span className="font-semibold">Settings → Pipelines</span> and
                add stages so outcomes can be saved.
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {visibleCols.map(renderButton)}
              </div>

              {/* More Dispositions — inline expand */}
              {moreCols.length > 0 && (
                <>
                  <button onClick={() => setShowMore(!showMore)}
                    className="flex items-center gap-1.5 mt-2 text-[12px] font-medium text-[#6B7280] hover:text-[#1A1A1A]">
                    <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showMore && 'rotate-180')} />
                    {showMore ? 'Less' : 'More Dispositions'}
                  </button>
                  {showMore && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {moreCols.map(renderButton)}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Notes textarea */}
        <div className="px-4 pb-3">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)\u2026"
            className="w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
            rows={2} />
        </div>

        {/* Action buttons: Redial | Next -> | Pause */}
        <div className="flex gap-2 px-4 pb-4">
          <button onClick={() => onRedial(pickedId, notes)} disabled={applying}
            className="flex items-center gap-1.5 border border-[#FECACA] rounded-lg px-4 py-2 text-[13px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-50">
            <Phone className="w-4 h-4" /> Redial
          </button>
          <button onClick={() => onNext(pickedId, notes)} disabled={applying}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#3C5A87] text-white rounded-lg px-4 py-2 text-[13px] font-semibold hover:bg-[#3C5A87]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)] disabled:opacity-50">
            Next call &rarr;
          </button>
          <button onClick={() => onPause(pickedId, notes)} disabled={applying}
            className="border border-[#FECACA] text-[#B91C1C] rounded-lg px-3 py-2 hover:bg-[#FEF2F2] disabled:opacity-50">
            <PauseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
  );
}
