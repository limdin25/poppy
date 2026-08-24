import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Phone, MessageSquare, Mail, Flame, Pencil, Upload, Trash2, Download, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatPence, formatRelativeTime, formatDateTime } from '../data/helpers';
import StageSelector from '../components/shared/StageSelector';
import BulkUploadModal from '../components/contacts/BulkUploadModal';
import ContactSmsModal from '../components/contacts/ContactSmsModal';
import EditContactModal from '../components/contacts/EditContactModal';
import EditableName from '../components/contacts/EditableName';
import ContactIdentity from '../components/shared/ContactIdentity';
import AgentChip from '../components/shared/AgentChip';
import DealTagChip from '../components/shared/DealTagChip';
import CalcChip from '../components/shared/CalcChip';
import { useContactVslPages, lastAutoMove } from '../hooks/useContactVslPages';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { useSmsV2 } from '../store/SmsV2Store';
import { useContactPersistence, isRealContactId } from '../hooks/useContactPersistence';
import { useAgentsToday } from '../hooks/useAgentsToday';
import { useDialerProModal } from '../layout/DialerProModalContext';
import { toE164 } from '@/features/crm/lib/phone';
import { supabase } from '@/integrations/supabase/browser';
import type { Contact } from '../types';

export default function ContactsPage() {
  const { contacts, columns, agents: storeAgents, patchContact, upsertContact, removeContact, pushToast } = useSmsV2();
  const persist = useContactPersistence();
  const { openDialerPro } = useDialerProModal();
  // Prefer real agents (from profiles) for the owner dropdown so saved
  // owner_agent_id is a real UUID, not a mock id like "a-hugo".
  const { agents: realAgents } = useAgentsToday();
  const agents = realAgents.length > 0 ? realAgents : storeAgents;
  // PR 110: search + filters in URL so browser tab switch keeps state.
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const stageFilter = searchParams.get('stage') ?? 'all';
  const ownerFilter = searchParams.get('owner') ?? 'all';
  const setSpParam = (key: string, value: string, fallback: string = '') => {
    const sp = new URLSearchParams(searchParams);
    if (value && value !== fallback) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const setSearch = (v: string) => setSpParam('q', v);
  const setStageFilter = (v: string) => setSpParam('stage', v, 'all');
  const setOwnerFilter = (v: string) => setSpParam('owner', v, 'all');
  const renameContact = async (id: string, name: string) => {
    patchContact(id, { name });
    const res = await persist.patchContact(id, { name });
    if (res !== true) pushToast(`Rename failed: ${res}`, 'error');
    return res;
  };
  const [editing, setEditing] = useState<Contact | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState<Contact | null>(null);
  const [smsTo, setSmsTo] = useState<Contact | null>(null);
  // PR 83: which channel the modal opens with when an icon is clicked.
  // null = picker stays unselected (when clicking the generic Edit/Call buttons).
  const [smsChannel, setSmsChannel] = useState<'sms' | 'whatsapp' | 'email' | null>(null);
  const { firstName: agentFirstName } = useCurrentAgent();

  const startNewContact = () => {
    // Empty draft fed into the existing EditContactModal. Same UX, no
    // separate "New Contact" component needed.
    setCreatingDraft({
      id: `new-${Date.now()}`,
      name: '',
      phone: '',
      email: undefined,
      tags: [],
      isHot: false,
      customFields: {},
      pipelineColumnId: columns[0]?.id,
      createdAt: new Date().toISOString(),
    });
  };

  const saveNewContact = async (draft: Contact) => {
    if (!draft.name.trim() || !draft.phone.trim()) {
      pushToast('Name and phone are required', 'error');
      return;
    }
    const e164 = toE164(draft.phone);
    if (!e164) {
      pushToast('Invalid phone number', 'error');
      return;
    }
    // Drop synthetic mock IDs (e.g. "a-hugo") — createContact will fall back
    // to the current user's auth.uid() when ownerAgentId is missing.
    const ownerAgentId =
      draft.ownerAgentId && isRealContactId(draft.ownerAgentId)
        ? draft.ownerAgentId
        : null;
    const result = await persist.createContact({
      name: draft.name.trim(),
      phone: e164,
      email: draft.email,
      pipelineColumnId: draft.pipelineColumnId ?? null,
      ownerAgentId,
      customFields: draft.customFields,
    });
    if (!result) {
      pushToast('Could not create contact', 'error');
      return;
    }
    upsertContact({ ...draft, id: result.id, phone: e164 });
    setCreatingDraft(null);
    pushToast(
      result.existed
        ? 'Contact with this phone already exists — opened the existing record'
        : 'Contact created',
      result.existed ? 'info' : 'success'
    );
  };

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      if (stageFilter !== 'all' && c.pipelineColumnId !== stageFilter) return false;
      if (ownerFilter !== 'all' && c.ownerAgentId !== ownerFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !c.phone.toLowerCase().includes(q) &&
          !(c.email ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [contacts, search, stageFilter, ownerFilter]);

  // UI pagination — rendering 11k+ <tr> rows locks the main thread, so
  // slice to a page at a time. Search / filters run against the full
  // dataset above, then we slice for display.
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Reset to page 0 whenever filters or the total dataset change.
  useEffect(() => { setPage(0); }, [search, stageFilter, ownerFilter]);
  // Clamp if data shrinks and current page is now out of range.
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);
  const visibleSlice = useMemo(
    () => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filtered, page]
  );

  // Video-funnel facts for the rows actually on screen. Passing all 3,500 ids
  // would be 36 round-trips per render; the visible 100 is one.
  const visibleIds = useMemo(() => visibleSlice.map((c) => c.id), [visibleSlice]);
  const vslByContact = useContactVslPages(visibleIds);

  const setStage = (id: string, col: string) => {
    patchContact(id, { pipelineColumnId: col });
    void persist.moveToColumn(id, col);
  };

  const save = (updated: Contact) => {
    // PR 105 (Hugo 2026-04-28): optimistic local + write-through to
    // wk_contacts (name / email / pipeline_column_id). Was UI-only —
    // saved name / email never persisted across reload.
    const prev = contacts.find((c) => c.id === updated.id);
    upsertContact(updated);
    void persist
      .patchContact(updated.id, {
        name: updated.name,
        email: updated.email ?? null,
        pipeline_column_id: updated.pipelineColumnId ?? null,
      })
      .then((result) => {
        if (result === true) {
          pushToast('Saved ✓', 'success');
        } else {
          if (prev) upsertContact(prev);
          pushToast(result ?? 'Save failed — reverted', 'error');
        }
      });
  };

  // Export the currently filtered list to CSV. Honours active search /
  // stage / owner filters so an operator can export "all hot leads in
  // New Leads" or similar by setting filters first.
  const exportCsv = useCallback(() => {
    const escape = (val: unknown): string => {
      const s = val === null || val === undefined ? '' : String(val);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = [
      'Name',
      'Phone',
      'Email',
      'Stage',
      'Owner',
      'Property address',
      'Property URL',
      'Value (GBP)',
      'Tags',
      'Hot',
      'Last contact',
      'Created',
    ];
    const stageById = new Map(columns.map((c) => [c.id, c.name] as const));
    const ownerById = new Map(agents.map((a) => [a.id, a.name] as const));
    const rows = filtered.map((c) => [
      c.name,
      c.phone,
      c.email ?? '',
      c.pipelineColumnId ? (stageById.get(c.pipelineColumnId) ?? '') : '',
      c.ownerAgentId ? (ownerById.get(c.ownerAgentId) ?? '') : '',
      c.customFields?.property_address ?? '',
      c.customFields?.property_url ?? '',
      c.dealValuePence ? (c.dealValuePence / 100).toFixed(2) : '',
      (c.tags ?? []).join('; '),
      c.isHot ? 'yes' : '',
      c.lastContactAt ?? '',
      c.createdAt ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(escape).join(','))
      .join('\n');
    // Prepend BOM so Excel opens UTF-8 correctly (£, accents).
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `elsie-crm-contacts-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    pushToast(`Exported ${filtered.length} contacts`, 'success');
  }, [filtered, columns, agents, pushToast]);

  const [deleting, setDeleting] = useState<string | null>(null);
  const deleteContact = useCallback(async (c: Contact) => {
    if (!confirm(`Delete "${c.name}" (${c.phone})? This cannot be undone.`)) return;
    setDeleting(c.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('wk_contact_tags' as any) as any).delete().eq('contact_id', c.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('wk_dialer_queue' as any) as any).delete().eq('contact_id', c.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('wk_contacts' as any) as any).delete().eq('id', c.id);
      if (error) throw error;
      removeContact(c.id);
      pushToast('Contact deleted', 'success');
    } catch {
      pushToast('Delete failed', 'error');
    }
    setDeleting(null);
  }, [removeContact, pushToast]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">Contacts</h1>
          <p className="text-[13px] text-[#6B7280]">
            {filtered.length} of {contacts.length} contacts
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 border border-[#E5E7EB] bg-white text-[#1A1A1A] text-[13px] font-medium px-3 py-2 rounded-[10px] hover:bg-[#F3F3EE] disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Export ${filtered.length} contacts as CSV`}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            onClick={() => setBulkOpen(true)}
            className="flex items-center gap-1.5 border border-[#E5E7EB] bg-white text-[#1A1A1A] text-[13px] font-medium px-3 py-2 rounded-[10px] hover:bg-[#F3F3EE]"
          >
            <Upload className="w-3.5 h-3.5" /> Bulk import
          </button>
          <button
            onClick={startNewContact}
            className="bg-[#3C5A87] text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)]"
          >
            + New contact
          </button>
        </div>
      </header>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center gap-2">
          <Search className="w-4 h-4 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email…"
            className="flex-1 text-[13px] bg-transparent border-0 focus:outline-none"
          />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-[12px] px-2 py-1 bg-[#F3F3EE] border border-[#E5E7EB] rounded-[10px]"
          >
            <option value="all">All stages</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="text-[12px] px-2 py-1 bg-[#F3F3EE] border border-[#E5E7EB] rounded-[10px]"
          >
            <option value="all">All owners</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-[#F3F3EE]/50 text-[10px] uppercase tracking-wide text-[#9CA3AF]">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Name</th>
              <th className="text-left px-2 py-2.5 font-semibold">Phone</th>
              <th className="text-left px-2 py-2.5 font-semibold">Stage</th>
              <th className="text-left px-2 py-2.5 font-semibold">Owner</th>
              <th className="text-left px-2 py-2.5 font-semibold">Property address</th>
              <th className="text-left px-2 py-2.5 font-semibold">Property URL</th>
              <th className="text-right px-2 py-2.5 font-semibold">Value</th>
              <th className="text-left px-2 py-2.5 font-semibold">Last contact</th>
              <th className="text-left px-2 py-2.5 font-semibold">Video</th>
              <th className="px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {visibleSlice.map((c) => {
              return (
                <tr key={c.id} className="hover:bg-[#F3F3EE]/30">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/admin/crm/contacts/${c.id}`}
                      className="font-semibold text-[#1A1A1A] hover:text-[#3C5A87] flex items-center gap-1.5"
                    >
                      <EditableName value={c.name} onSave={(n) => renameContact(c.id, n)} className="font-semibold" />
                      {c.isHot && (
                        <Flame
                          className="w-3 h-3 text-[#EF4444]"
                          fill="#EF4444"
                        />
                      )}
                    </Link>
                    {/* contact.name is the COMPANY. This page was the only lead
                        surface not showing the person too. */}
                    <ContactIdentity
                      owner={c.customFields?.owner_name}
                      website={c.customFields?.website}
                      layout="inline"
                      size="sm"
                      className="mt-0.5"
                    />
                    {/* Which deal, on this list too (Hugo, 2026-08-24). A
                        builder here was a bare company name with no house
                        against it, and the Property column beside it reads
                        custom_fields.property_address which a builder does not
                        have. Same chip and same derivation as the inbox. */}
                    <DealTagChip
                      customFields={c.customFields}
                      size="xs"
                      className="mt-0.5"
                      data-testid={`contacts-deal-tag-${c.id}`}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-[#6B7280] tabular-nums">{c.phone}</td>
                  <td className="px-2 py-2.5">
                    <StageSelector
                      value={c.pipelineColumnId}
                      onChange={(col) => setStage(c.id, col)}
                      size="sm"
                    />
                  </td>
                  <td className="px-2 py-2.5 text-[#6B7280]">
                    <AgentChip agentId={c.ownerAgentId} variant="text" size="sm" />
                    <CalcChip calcAt={vslByContact.get(c.id)?.calcAt} count={vslByContact.get(c.id)?.calcCount} />
                  </td>
                  {/* A builder carries the house on builder_property, not on
                      property_address, so this column read a dash next to a
                      chip naming the street. */}
                  <td
                    className="px-2 py-2.5 text-[#6B7280] max-w-[220px] truncate"
                    title={c.customFields?.property_address || c.customFields?.builder_property || ''}
                  >
                    {c.customFields?.property_address || c.customFields?.builder_property || '—'}
                  </td>
                  <td className="px-2 py-2.5 max-w-[200px]">
                    {(() => {
                      const raw = c.customFields?.property_url?.trim();
                      if (!raw) return <span className="text-[#9CA3AF]">—</span>;
                      // Tolerate stored values that lack a protocol so the
                      // anchor opens the real site instead of treating the
                      // value as a relative path under app.heyelsie.com.
                      const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                      const display = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#3C5A87] underline decoration-[#3C5A87]/40 hover:decoration-[#3C5A87] cursor-pointer truncate inline-flex items-center gap-1 max-w-full align-bottom"
                          title={href}
                        >
                          <span className="truncate">{display}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                        </a>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-[#1A1A1A] font-medium">
                    {c.dealValuePence ? formatPence(c.dealValuePence) : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-[11px] text-[#9CA3AF]">
                    {c.lastContactAt ? formatRelativeTime(c.lastContactAt) : '—'}
                  </td>
                  {/* When the agent made the video, when the lead opened it, and
                      when the funnel last moved the card by itself. Relative to
                      read fast, exact stamp on hover. */}
                  <td className="px-2 py-2.5 whitespace-nowrap" data-testid={`contact-video-${c.id}`}>
                    {(() => {
                      const v = vslByContact.get(c.id);
                      if (!v) return <span className="text-[#D1D5DB]">—</span>;
                      const auto = lastAutoMove(v);
                      const line = (icon: string, label: string, iso: string | null, tone = 'text-[#6B7280]') =>
                        iso ? (
                          <div
                            className={`text-[10px] ${tone} tabular-nums`}
                            title={`${label} · ${formatDateTime(iso)}`}
                          >
                            {icon} {label} {formatRelativeTime(iso)}
                          </div>
                        ) : null;
                      return (
                        <div className="space-y-0.5">
                          {line('🎬', 'Created', v.renderRequestedAt ?? v.createdAt)}
                          {line('👁', 'Opened', v.firstOpenedAt, 'text-[#0EA5E9]')}
                          {auto && line('↗', `Auto → ${auto.column}`, auto.at)}
                          {v.renderStatus === 'failed' && (
                            <div className="text-[10px] text-[#B91C1C]">render failed</div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="flex justify-end gap-0.5">
                      <button
                        onClick={() => setEditing(c)}
                        className="p-1.5 hover:bg-[#F3F3EE] rounded text-[#6B7280] hover:text-[#1A1A1A]"
                        title="Edit contact"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openDialerPro(c.id);
                        }}
                        className="p-1.5 hover:bg-[#EEF2F8] rounded text-[#3C5A87]"
                        title={`Call ${c.name}`}
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSmsChannel('sms');
                          setSmsTo(c);
                        }}
                        className="p-1.5 hover:bg-[#EEF2F8] rounded text-[#3C5A87]"
                        title={`SMS ${c.name}`}
                        data-testid={`contacts-row-sms-${c.id}`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                      {/* PR 83: WhatsApp + Email icon shortcuts. Same modal,
                          just opens with the right channel pre-selected. */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSmsChannel('whatsapp');
                          setSmsTo(c);
                        }}
                        className="p-1.5 hover:bg-[#EEF2F8] rounded text-[#25D366]"
                        title={`WhatsApp ${c.name}`}
                        data-testid={`contacts-row-whatsapp-${c.id}`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" strokeWidth={2.4} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSmsChannel('email');
                          setSmsTo(c);
                        }}
                        className="p-1.5 hover:bg-[#DBEAFE] rounded text-[#3B82F6]"
                        title={`Email ${c.name}`}
                        data-testid={`contacts-row-email-${c.id}`}
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void deleteContact(c);
                        }}
                        disabled={deleting === c.id}
                        className="p-1.5 hover:bg-red-50 rounded text-[#9CA3AF] hover:text-red-500"
                        title={`Delete ${c.name}`}
                      >
                        <Trash2 className={`w-3.5 h-3.5 ${deleting === c.id ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[12px] text-[#9CA3AF] italic">
                  No contacts match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[#E5E7EB] bg-[#F3F3EE]/30">
            <span className="text-[11px] text-[#6B7280] tabular-nums">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 text-[11px] px-2 py-1 border border-[#E5E7EB] rounded-[8px] bg-white hover:bg-[#F3F3EE] disabled:opacity-40 disabled:cursor-not-allowed"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-[11px] text-[#6B7280] px-2 tabular-nums">
                Page {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 text-[11px] px-2 py-1 border border-[#E5E7EB] rounded-[8px] bg-white hover:bg-[#F3F3EE] disabled:opacity-40 disabled:cursor-not-allowed"
                title="Next page"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <BulkUploadModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <ContactSmsModal
        contact={smsTo}
        onClose={() => {
          setSmsTo(null);
          setSmsChannel(null);
        }}
        agentFirstName={agentFirstName ?? ''}
        defaultChannel={smsChannel}
      />
      <EditContactModal
        contact={editing}
        agents={agents}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      <EditContactModal
        contact={creatingDraft}
        agents={agents}
        onClose={() => setCreatingDraft(null)}
        onSave={(draft) => void saveNewContact(draft)}
      />
    </div>
  );
}
