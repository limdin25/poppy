import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Voicemail,
  Play,
  Pause,
  Sparkles,
  Search,
  ChevronDown,
  ChevronRight,
  Download,
  MessageSquare,
  ExternalLink,
  CalendarDays,
} from 'lucide-react';
import { format, startOfDay, endOfDay, subDays, startOfYesterday, endOfYesterday } from '@/features/crm/lib/dates';
import { Popover, PopoverContent, PopoverTrigger } from '@/features/crm/ui/popover';
import CallTranscriptModal from '../components/calls/CallTranscriptModal';
import StageSelector from '../components/shared/StageSelector';
import EditContactModal from '../components/contacts/EditContactModal';
import { useAgentsToday } from '../hooks/useAgentsToday';
import { MOCK_CALLS } from '../data/mockCalls';
import { MOCK_CONTACTS } from '../data/mockContacts';
import { MOCK_AGENTS } from '../data/mockAgents';
import { formatDuration, formatPence, formatRelativeTime } from '../data/helpers';
import { cn } from '@/core/lib/cn';
import { useCalls, signCallRecording } from '../hooks/useCalls';
import { useSmsV2 } from '../store/SmsV2Store';
import { useContactPersistence } from '../hooks/useContactPersistence';
import { useActiveCallCtx } from '../components/live-call/ActiveCallContext';
import { useDemoMode } from '../lib/useDemoMode';
import type { CallRecord, Contact } from '../types';

const STATUS_ICON = {
  inbound: <PhoneIncoming className="w-3.5 h-3.5 text-[#3C5A87]" />,
  outbound: <PhoneOutgoing className="w-3.5 h-3.5 text-[#3B82F6]" />,
};

type DurationBucket = 'all' | 'short' | 'medium' | 'long';

export default function CallsPage() {
  // PR 110: filters in URL so browser tab switch + back/forward preserve.
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const duration = (searchParams.get('duration') ?? 'all') as DurationBucket;
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo = searchParams.get('to') ?? '';
  const agentFilter = searchParams.get('agent') ?? '';
  const setSp = (key: string, value: string, fallback: string = '') => {
    const sp = new URLSearchParams(searchParams);
    if (value && value !== fallback) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const setMultiSp = (updates: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    setSearchParams(sp, { replace: true });
  };
  const setSearch = (v: string) => setSp('q', v);
  const setDuration = (v: DurationBucket) => setSp('duration', v, 'all');
  const setAgentFilter = (v: string) => setSp('agent', v);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [transcriptCallId, setTranscriptCallId] = useState<string | null>(null);
  // PR 115: edit-contact modal — opened by clicking a prospect name.
  const [editing, setEditing] = useState<Contact | null>(null);

  const { calls: realCalls, loadingMore, total, hasMore, loadMore } = useCalls();
  const { contacts: realContacts, columns, patchContact, upsertContact, pushToast } = useSmsV2();
  const persist = useContactPersistence();
  const { agents: realAgentsToday } = useAgentsToday();
  const { openCallRoom } = useActiveCallCtx();
  const demoMode = useDemoMode();
  // PR 107: avoid the "unused" warning when columns are only consumed
  // through StageSelector now (no more inline IIFE that read them).
  void columns;

  // In production, always use real data — even if empty. The mock fallback
  // is reachable only with `?demo=1` so internal demos / screenshots still
  // work, but Hugo never sees Sarah Jenkins on a live page.
  const calls = demoMode && realCalls.length === 0 ? MOCK_CALLS : realCalls;
  const contacts =
    demoMode && realContacts.length === 0 ? MOCK_CONTACTS : realContacts;
  // PR 122 (Hugo 2026-04-28): the Agent column and the "All agents"
  // filter dropdown were both bound to a hardcoded `demoMode ? MOCK : []`,
  // so in production the column always rendered "—" and the dropdown
  // only had "All agents" with no options. realAgentsToday is already
  // loaded above (used by EditContactModal) — point at it instead.
  const agents =
    demoMode && realAgentsToday.length === 0 ? MOCK_AGENTS : realAgentsToday;

  // When the user clicks Play on a row with a real recording_path, swap
  // it for a short-lived signed URL.
  useEffect(() => {
    let cancelled = false;
    if (!playing) {
      setSignedUrl(null);
      return;
    }
    const call = calls.find((c) => c.id === playing);
    if (!call?.recordingUrl) return;
    // Already an http(s) URL? Don't re-sign (e.g. mock data).
    if (/^https?:\/\//i.test(call.recordingUrl)) {
      setSignedUrl(call.recordingUrl);
      return;
    }
    void signCallRecording(call.recordingUrl).then((url) => {
      if (!cancelled) setSignedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [playing, calls]);

  // Build a phone→contact index so we can fall back to phone matching
  // when contact_id is missing on a call row.
  const contactByPhone = useMemo(() => {
    const map = new Map<string, typeof contacts[number]>();
    contacts.forEach((c) => {
      if (c.phone) {
        const normalised = c.phone.replace(/\s+/g, '');
        map.set(normalised, c);
        if (!normalised.startsWith('+') && normalised.length >= 10) {
          map.set('+44' + normalised.replace(/^0/, ''), c);
        }
      }
    });
    return map;
  }, [contacts]);

  const findContact = useCallback(
    (call: CallRecord) => {
      if (call.contactId) {
        const byId = contacts.find((x) => x.id === call.contactId);
        if (byId) return byId;
      }
      const phone = call.toE164 || call.fromE164;
      if (phone) return contactByPhone.get(phone.replace(/\s+/g, '')) ?? null;
      return null;
    },
    [contacts, contactByPhone]
  );

  // Group by contact so we can expand to show "previous calls to same person"
  const callsByContact = useMemo(() => {
    const map = new Map<string, CallRecord[]>();
    calls.forEach((c) => {
      if (!map.has(c.contactId)) map.set(c.contactId, []);
      map.get(c.contactId)!.push(c);
    });
    map.forEach((arr) => arr.sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)));
    return map;
  }, [calls]);

  // Filter at the call level → most-recent per contact group
  const dateLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return 'All time';
    if (dateFrom && dateTo && dateFrom === dateTo) return format(new Date(dateFrom + 'T00:00:00'), 'd MMM yyyy');
    if (dateFrom && dateTo) return `${format(new Date(dateFrom + 'T00:00:00'), 'd MMM')} – ${format(new Date(dateTo + 'T00:00:00'), 'd MMM yyyy')}`;
    if (dateFrom) return `From ${format(new Date(dateFrom + 'T00:00:00'), 'd MMM yyyy')}`;
    return `Until ${format(new Date(dateTo + 'T00:00:00'), 'd MMM yyyy')}`;
  }, [dateFrom, dateTo]);

  const filteredCalls = useMemo(() => {
    const fromTs = dateFrom ? startOfDay(new Date(dateFrom + 'T00:00:00')).getTime() : null;
    const toTs = dateTo ? endOfDay(new Date(dateTo + 'T00:00:00')).getTime() : null;
    return calls.filter((c) => {
      const contact = findContact(c);
      if (search) {
        const s = search.toLowerCase();
        const name = contact?.name ?? '';
        const phone = contact?.phone ?? '';
        if (!name.toLowerCase().includes(s) && !phone.toLowerCase().includes(s))
          return false;
      }
      if (agentFilter && c.agentId !== agentFilter) return false;
      if (duration !== 'all') {
        if (duration === 'short' && c.durationSec >= 60) return false;
        if (duration === 'medium' && (c.durationSec < 60 || c.durationSec > 300))
          return false;
        if (duration === 'long' && c.durationSec <= 300) return false;
      }
      if (fromTs || toTs) {
        const callTs = +new Date(c.startedAt);
        if (fromTs && callTs < fromTs) return false;
        if (toTs && callTs > toTs) return false;
      }
      return true;
    });
  }, [calls, contacts, findContact, search, duration, dateFrom, dateTo, agentFilter]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">Call history</h1>
          <p className="text-[13px] text-[#6B7280]">
            {filteredCalls.length} of {total ?? calls.length} calls · click row for previous calls to same prospect
          </p>
        </div>
        <button className="flex items-center gap-1.5 border border-[#E5E7EB] bg-white text-[#1A1A1A] text-[13px] font-medium px-3 py-2 rounded-[10px] hover:bg-[#F3F3EE]">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </header>

      {/* Filter bar */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by prospect name or phone…"
            className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-[#F3F3EE] border-0 rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
          />
        </div>
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <button className={cn(
              'flex items-center gap-1.5 text-[12px] px-2 py-1.5 border rounded-[10px] transition-colors',
              dateFrom || dateTo
                ? 'bg-[#EEF2F8] border-[#3C5A87]/30 text-[#3C5A87] font-medium'
                : 'bg-[#F3F3EE] border-[#E5E7EB] text-[#1A1A1A]'
            )}>
              <CalendarDays className="w-3.5 h-3.5" />
              {dateLabel}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0" sideOffset={8}>
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Today', from: format(new Date(), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
                  { label: 'Yesterday', from: format(startOfYesterday(), 'yyyy-MM-dd'), to: format(endOfYesterday(), 'yyyy-MM-dd') },
                  { label: 'Last 7 days', from: format(subDays(new Date(), 6), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
                  { label: 'Last 30 days', from: format(subDays(new Date(), 29), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setMultiSp({ from: preset.from, to: preset.to });
                      setDatePickerOpen(false);
                    }}
                    className={cn(
                      'px-2 py-1 text-[11px] font-medium rounded-[8px] transition-colors',
                      dateFrom === preset.from && dateTo === preset.to
                        ? 'bg-[#3C5A87] text-white'
                        : 'bg-[#F3F3EE] text-[#1A1A1A] hover:bg-[#E5E7EB]'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => {
                      setMultiSp({ from: '', to: '' });
                      setDatePickerOpen(false);
                    }}
                    className="px-2 py-1 text-[11px] font-medium text-[#EF4444] hover:bg-[#FEF2F2] rounded-[8px] transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex gap-2 items-center text-[11px] text-[#6B7280]">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-[#1A1A1A]">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(e) => setSp('from', e.target.value)}
                    className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
                  />
                </div>
                <span className="mt-5">–</span>
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-[#1A1A1A]">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(e) => setSp('to', e.target.value)}
                    className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value as DurationBucket)}
          className="text-[12px] px-2 py-1.5 bg-[#F3F3EE] border border-[#E5E7EB] rounded-[10px]"
        >
          <option value="all">Any length</option>
          <option value="short">Short (&lt;1m)</option>
          <option value="medium">Medium (1–5m)</option>
          <option value="long">Long (&gt;5m)</option>
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="text-[12px] px-2 py-1.5 bg-[#F3F3EE] border border-[#E5E7EB] rounded-[10px]"
        >
          <option value="">All agents</option>
          {agents.filter((a) => !a.isAdmin).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {(search || duration !== 'all' || dateFrom || dateTo || agentFilter) && (
          <button
            onClick={() => {
              setMultiSp({ q: '', duration: '', from: '', to: '', agent: '' });
            }}
            className="text-[11px] text-[#3C5A87] hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-[#F3F3EE]/50 text-[10px] uppercase tracking-wide text-[#9CA3AF]">
            <tr>
              <th className="text-left px-2 py-2.5 w-6"></th>
              <th className="text-left px-2 py-2.5 font-semibold">Direction</th>
              <th className="text-left px-2 py-2.5 font-semibold">Prospect</th>
              <th className="text-left px-2 py-2.5 font-semibold">Agent</th>
              <th className="text-left px-2 py-2.5 font-semibold">Status</th>
              <th className="text-left px-2 py-2.5 font-semibold">Stage</th>
              <th className="text-right px-2 py-2.5 font-semibold">Duration</th>
              <th className="text-right px-2 py-2.5 font-semibold">Cost</th>
              <th className="text-left px-2 py-2.5 font-semibold">Date · Time</th>
              <th className="px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {filteredCalls.map((c) => {
              const contact = findContact(c);
              const agent = agents.find((x) => x.id === c.agentId);
              const previousCalls = (callsByContact.get(c.contactId) ?? []).filter(
                (x) => x.id !== c.id
              );
              const isExpanded = expandedContactId === c.contactId;
              const isPlaying = playing === c.id;
              return (
                <>
                  <tr
                    key={c.id}
                    className={cn(
                      'hover:bg-[#F3F3EE]/30',
                      isExpanded && 'bg-[#EEF2F8]/40'
                    )}
                  >
                    <td className="px-2 py-2.5">
                      {previousCalls.length > 0 ? (
                        <button
                          onClick={() =>
                            setExpandedContactId(isExpanded ? null : c.contactId)
                          }
                          className="text-[#9CA3AF] hover:text-[#3C5A87]"
                          title={`${previousCalls.length} previous call${previousCalls.length === 1 ? '' : 's'} to same prospect`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-2 py-2.5">
                      {c.status === 'missed' ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-[#EF4444]" />
                      ) : c.status === 'voicemail' ? (
                        <Voicemail className="w-3.5 h-3.5 text-[#9CA3AF]" />
                      ) : (
                        STATUS_ICON[c.direction]
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {/* PR 115 (Hugo 2026-04-28): clickable prospect
                          name → opens EditContactModal so the agent
                          can edit anything from Call history. */}
                      {contact ? (
                        <button
                          onClick={() => setEditing(contact)}
                          className="font-semibold text-[#1A1A1A] hover:text-[#3C5A87] hover:underline text-left"
                          title="Click to edit contact"
                        >
                          {contact.name ?? '—'}
                        </button>
                      ) : (
                        <div className="font-semibold text-[#1A1A1A]">—</div>
                      )}
                      <div className="text-[10px] text-[#9CA3AF] tabular-nums">
                        {contact?.phone}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-[#6B7280]">{agent?.name ?? '—'}</td>
                    <td className="px-2 py-2.5">
                      <span className="text-[11px] font-medium capitalize text-[#6B7280]">
                        {c.status}
                      </span>
                    </td>
                    {/* PR 36: stage badge per call row.
                        PR 107 (Hugo 2026-04-28): inline StageSelector so
                        the agent can move the lead between stages from
                        the calls list without opening the contact. */}
                    <td className="px-2 py-2.5">
                      {contact ? (
                        <StageSelector
                          value={contact.pipelineColumnId}
                          size="xs"
                          onChange={(newId) => {
                            const prev = contact.pipelineColumnId;
                            patchContact(contact.id, { pipelineColumnId: newId });
                            void persist.moveToColumn(contact.id, newId).then((ok) => {
                              if (ok) {
                                pushToast('Stage updated', 'success');
                              } else {
                                patchContact(contact.id, { pipelineColumnId: prev });
                                pushToast('Stage update failed — reverted', 'error');
                              }
                            });
                          }}
                        />
                      ) : (
                        <span className="text-[10px] text-[#9CA3AF]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {c.durationSec > 0 ? formatDuration(c.durationSec) : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {formatPence(c.costPence)}
                    </td>
                    <td className="px-2 py-2.5 text-[11px] text-[#9CA3AF] tabular-nums">
                      {new Date(c.startedAt).toLocaleString('en-GB', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {c.recordingUrl && (
                          <button
                            onClick={() => setPlaying(isPlaying ? null : c.id)}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#3C5A87] bg-[#EEF2F8] hover:bg-[#3C5A87] hover:text-white rounded-[8px] transition-colors"
                            title="Play recording"
                          >
                            {isPlaying ? (
                              <>
                                <Pause className="w-3 h-3" /> Pause
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3" /> Play
                              </>
                            )}
                          </button>
                        )}
                        {c.aiSummary && (
                          <button
                            className="p-1.5 hover:bg-[#EEF2F8] rounded text-[#3C5A87]"
                            title={c.aiSummary}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setTranscriptCallId(c.id)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#6B7280] bg-[#F3F3EE] hover:bg-[#1A1A1A] hover:text-white rounded-[8px] transition-colors"
                          title="View transcript (Hugo 2026-04-26)"
                        >
                          <MessageSquare className="w-3 h-3" /> Transcript
                        </button>
                        {/* PR 107 (Hugo 2026-04-28): "Open call room"
                            now opens the live call-room preview for the
                            contact (script + coach + glossary + SMS),
                            not the historic /crm/calls/:id page. The
                            past-call screen is still reachable via the
                            transcript modal + the route itself. */}
                        <button
                          onClick={() => openCallRoom(c.contactId)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#3C5A87] hover:bg-[#3C5A87] hover:text-white rounded-[8px] transition-colors"
                          title="Open the live call-room preview for this contact"
                        >
                          <ExternalLink className="w-3 h-3" /> Open call room
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline player — real audio element with signed URL */}
                  {isPlaying && c.recordingUrl && (
                    <tr key={`${c.id}-player`}>
                      <td colSpan={10} className="px-4 py-3 bg-[#EEF2F8]/40">
                        {signedUrl ? (
                          <div className="flex items-center gap-3">
                            <audio
                              src={signedUrl}
                              controls
                              autoPlay
                              className="flex-1 h-9"
                              data-testid="recording-audio"
                            />
                            <a
                              href={signedUrl}
                              download
                              className="text-[11px] text-[#3C5A87] hover:underline"
                            >
                              Download
                            </a>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 text-[12px] text-[#6B7280]">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#3C5A87] animate-pulse" />
                            Loading recording…
                          </div>
                        )}
                        {c.aiSummary && (
                          <div className="mt-2 text-[12px] text-[#1A1A1A] italic bg-white rounded-lg p-2 border border-[#E5E7EB]">
                            <span className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mr-2">
                              AI summary
                            </span>
                            "{c.aiSummary}"
                          </div>
                        )}
                      </td>
                    </tr>
                  )}

                  {/* Expanded — previous calls to same prospect */}
                  {isExpanded && (
                    <tr key={`${c.id}-expand`}>
                      <td colSpan={10} className="px-4 py-3 bg-[#F3F3EE]/40">
                        <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
                          Previous calls to {contact?.name} ({previousCalls.length})
                        </div>
                        <div className="space-y-1.5">
                          {previousCalls.map((p) => {
                            const pAgent = agents.find((x) => x.id === p.agentId);
                            return (
                              <div
                                key={p.id}
                                className="flex items-center gap-2 text-[12px] py-1.5 px-2 bg-white rounded-lg border border-[#E5E7EB]"
                              >
                                {p.status === 'missed' ? (
                                  <PhoneMissed className="w-3 h-3 text-[#EF4444]" />
                                ) : (
                                  STATUS_ICON[p.direction]
                                )}
                                <span className="text-[#6B7280] capitalize">
                                  {p.direction} {p.status}
                                </span>
                                <span className="text-[#9CA3AF] text-[11px]">
                                  · {pAgent?.name}
                                </span>
                                <span className="text-[#9CA3AF] text-[11px]">
                                  · {formatRelativeTime(p.startedAt)}
                                </span>
                                <span className="ml-auto tabular-nums text-[11px]">
                                  {p.durationSec > 0 ? formatDuration(p.durationSec) : '—'}
                                </span>
                                {p.recordingUrl && (() => {
                                  const isPPlaying = playing === p.id;
                                  return (
                                    <button
                                      onClick={() => setPlaying(isPPlaying ? null : p.id)}
                                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#3C5A87] bg-[#EEF2F8] hover:bg-[#3C5A87] hover:text-white rounded-[8px] transition-colors"
                                      title="Play recording"
                                    >
                                      {isPPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                    </button>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filteredCalls.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[#9CA3AF]">
                  No calls match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 text-[13px] font-medium text-[#3C5A87] bg-[#EEF2F8] hover:bg-[#3C5A87] hover:text-white rounded-[10px] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : `Load more calls (${calls.length} of ${total ?? '?'})`}
          </button>
        </div>
      )}

      {transcriptCallId && (() => {
        const tCall = calls.find((c) => c.id === transcriptCallId);
        const tContact = tCall ? findContact(tCall) : null;
        const callerLabel = tContact?.name?.trim().split(/\s+/)[0] ?? 'Caller';
        return (
          <CallTranscriptModal
            callId={transcriptCallId}
            callerLabel={callerLabel}
            onClose={() => setTranscriptCallId(null)}
          />
        );
      })()}
      {/* PR 115: edit contact directly from Call history. Same modal +
          persist pattern used elsewhere. */}
      <EditContactModal
        contact={editing}
        agents={realAgentsToday}
        onClose={() => setEditing(null)}
        onSave={async (updated) => {
          const previous = contacts.find((c) => c.id === updated.id);
          upsertContact(updated);
          setEditing(null);
          const result = await persist.patchContact(updated.id, {
            name: updated.name,
            email: updated.email,
            pipeline_column_id: updated.pipelineColumnId,
          });
          if (result === true) {
            pushToast('Contact saved', 'success');
          } else {
            if (previous) upsertContact(previous);
            pushToast(result, 'error');
          }
        }}
      />
    </div>
  );
}
