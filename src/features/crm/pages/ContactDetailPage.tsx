import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  MessageSquare,
  Flame,
  Play,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { MOCK_CALLS, MOCK_SMS, MOCK_ACTIVITIES, MOCK_TASKS } from '../data/mockCalls';
import {
  formatDuration,
  formatPence,
  formatRelativeTime,
  formatTimeOnly,
  formatDateTime,
} from '../data/helpers';
import StageSelector from '../components/shared/StageSelector';
import ContactAiToggle from '../components/contacts/ContactAiToggle';
import ContactFollowupScheduler from '../components/contacts/ContactFollowupScheduler';
import ContactSmsModal from '../components/contacts/ContactSmsModal';
import EditContactModal from '../components/contacts/EditContactModal';
import EditableName from '../components/contacts/EditableName';
import AgentChip from '../components/shared/AgentChip';
import CalcChip from '../components/shared/CalcChip';
import { useContactFunnelStatus } from '../hooks/useContactFunnelStatus';
import StageMoveChip from '../components/shared/StageMoveChip';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { useSmsV2 } from '../store/SmsV2Store';
import { useContactTimeline } from '../hooks/useContactTimeline';
import { useContactPersistence } from '../hooks/useContactPersistence';
import { useDemoMode } from '../lib/useDemoMode';
import { useDialerProModal } from '../layout/DialerProModalContext';
import type { Contact } from '../types';

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  // NOT store `agents` — nothing in the codebase ever dispatches upsertAgent, so
  // it is permanently []. The Owner field here read from it and therefore said
  // "Unassigned" for all 3,510 leads. AgentChip reads the real directory.
  const { getContact, patchContact, upsertContact, pushToast } = useSmsV2();
  const { openDialerPro } = useDialerProModal();
  const contact = getContact(id ?? '');
  // Same batched hook the inbox uses, with a list of one. useMemo on the id
  // so a re-render never rebuilds the array and re-fires the query.
  const funnelIds = useMemo(() => (id ? [id] : []), [id]);
  const funnel = useContactFunnelStatus(funnelIds).get(id ?? '');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [smsTo, setSmsTo] = useState<Contact | null>(null);
  const { firstName: agentFirstName } = useCurrentAgent();
  const [newTag, setNewTag] = useState('');
  const [newField, setNewField] = useState({ key: '', value: '' });

  const persist = useContactPersistence();
  const timeline = useContactTimeline(contact?.id ?? '', contact?.phone);
  const demoMode = useDemoMode();

  const renameContact = async (name: string) => {
    if (!contact) return false as const;
    patchContact(contact.id, { name });
    const res = await persist.patchContact(contact.id, { name });
    if (res !== true) pushToast(`Rename failed: ${res}`, 'error');
    return res;
  };

  if (!contact) {
    return (
      <div className="p-6">
        <Link to="/admin/crm/contacts" className="text-[13px] text-[#3C5A87] hover:underline">
          ← Back to contacts
        </Link>
        <p className="mt-4 text-[#6B7280]">Contact not found.</p>
      </div>
    );
  }

  // Real wk_calls / wk_sms / wk_activities / wk_tasks rows. Mock fallback
  // is reachable only with ?demo=1 — production always shows truth.
  const calls = timeline.calls.length > 0
    ? timeline.calls
    : demoMode ? MOCK_CALLS.filter((c) => c.contactId === contact.id) : [];
  const sms = timeline.sms.length > 0
    ? timeline.sms
    : demoMode ? MOCK_SMS.filter((m) => m.contactId === contact.id) : [];
  const activities = timeline.activities.length > 0
    ? timeline.activities
    : demoMode ? MOCK_ACTIVITIES.filter((a) => a.contactId === contact.id) : [];
  const tasks = timeline.tasks.length > 0
    ? timeline.tasks
    : demoMode ? MOCK_TASKS.filter((t) => t.contactId === contact.id) : [];

  // Optimistic local + write-through to wk_contacts
  const setStage = (col: string) => {
    patchContact(contact.id, { pipelineColumnId: col });
    void persist.moveToColumn(contact.id, col);
  };

  const addTag = () => {
    if (!newTag.trim()) return;
    const t = newTag.trim();
    const next = [...contact.tags, t];
    patchContact(contact.id, { tags: next });
    void persist.replaceTags(contact.id, next);
    setNewTag('');
  };

  const removeTag = (t: string) => {
    const next = contact.tags.filter((x) => x !== t);
    patchContact(contact.id, { tags: next });
    void persist.replaceTags(contact.id, next);
  };

  const addField = () => {
    if (!newField.key.trim()) return;
    const next = { ...contact.customFields, [newField.key.trim()]: newField.value };
    patchContact(contact.id, { customFields: next });
    void persist.patchContact(contact.id, { custom_fields: next });
    setNewField({ key: '', value: '' });
  };

  const removeField = (k: string) => {
    const cf = { ...contact.customFields };
    delete cf[k];
    patchContact(contact.id, { customFields: cf });
    void persist.patchContact(contact.id, { custom_fields: cf });
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <Link
        to="/admin/crm/contacts"
        className="inline-flex items-center gap-1 text-[12px] text-[#6B7280] hover:text-[#3C5A87]"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Contacts
      </Link>

      <header className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[#3C5A87]/15 text-[#3C5A87] text-[20px] font-bold flex items-center justify-center">
          {contact.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[24px] font-bold text-[#1A1A1A] tracking-tight"><EditableName value={contact.name} onSave={renameContact} className="text-[24px] font-bold" /></h1>
            {contact.isHot && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-[#FEF2F2] text-[#EF4444] px-2 py-0.5 rounded-full">
                <Flame className="w-3 h-3" /> HOT
              </span>
            )}
          </div>
          <div className="text-[13px] text-[#6B7280] tabular-nums">{contact.phone}</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(contact)}
            className="flex items-center gap-1.5 border border-[#E5E7EB] bg-white text-[#1A1A1A] text-[13px] font-medium px-4 py-2 rounded-[10px] hover:bg-[#F3F3EE]"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
          <button
            onClick={() => openDialerPro(contact.id)}
            className="flex items-center gap-1.5 bg-[#3C5A87] text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)]"
          >
            <Phone className="w-4 h-4" /> Call
          </button>
          <button
            onClick={() => setSmsTo(contact)}
            className="flex items-center gap-1.5 border border-[#E5E7EB] bg-white text-[#1A1A1A] text-[13px] font-medium px-4 py-2 rounded-[10px] hover:bg-[#F3F3EE]"
            data-testid="contact-detail-text-button"
          >
            <MessageSquare className="w-4 h-4" /> Text
          </button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {/* Left — about */}
        <aside className="col-span-12 lg:col-span-3 space-y-3">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
                Owner
              </div>
              <AgentChip agentId={contact.ownerAgentId} size="sm" className="text-[13px]" />
              <CalcChip calcAt={funnel?.calcAt} count={funnel?.calcCount} variant="full" />
            </div>
            {contact.email && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
                  Email
                </div>
                <div className="text-[13px] text-[#1A1A1A]">{contact.email}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
                Stage
              </div>
              <StageSelector
                value={contact.pipelineColumnId}
                onChange={setStage}
                size="md"
              />
              <StageMoveChip contact={contact} size="sm" className="mt-1" />
            </div>
            <ContactAiToggle contactId={contact.id} />
            <ContactFollowupScheduler contactId={contact.id} />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
                Tags
              </div>
              <div className="flex gap-1 flex-wrap mt-1">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="group inline-flex items-center gap-0.5 text-[10px] font-medium bg-[#F3F3EE] text-[#6B7280] pl-1.5 pr-1 py-0.5 rounded"
                  >
                    #{t}
                    <button
                      onClick={() => removeTag(t)}
                      className="text-[#9CA3AF] hover:text-[#EF4444] opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1 mt-2">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="Add tag…"
                  className="flex-1 px-2 py-1 text-[11px] border border-[#E5E7EB] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
                />
                <button
                  onClick={addTag}
                  className="px-1.5 text-[#3C5A87] hover:bg-[#EEF2F8] rounded-[8px]"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
              Custom fields
            </div>
            {Object.entries(contact.customFields).map(([k, v]) => (
              <div key={k} className="group flex items-start gap-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#9CA3AF]">{k}</div>
                  <div className="text-[12px] text-[#1A1A1A] truncate">{v}</div>
                </div>
                <button
                  onClick={() => removeField(k)}
                  className="text-[#9CA3AF] hover:text-[#EF4444] opacity-0 group-hover:opacity-100 mt-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="border-t border-[#E5E7EB] pt-2 mt-2 space-y-1">
              <input
                value={newField.key}
                onChange={(e) => setNewField({ ...newField, key: e.target.value })}
                placeholder="Field name"
                className="w-full px-2 py-1 text-[11px] border border-[#E5E7EB] rounded-[8px]"
              />
              <div className="flex gap-1">
                <input
                  value={newField.value}
                  onChange={(e) => setNewField({ ...newField, value: e.target.value })}
                  placeholder="Value"
                  className="flex-1 px-2 py-1 text-[11px] border border-[#E5E7EB] rounded-[8px]"
                />
                <button
                  onClick={addField}
                  className="px-1.5 text-[#3C5A87] hover:bg-[#EEF2F8] rounded-[8px]"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Centre — timeline */}
        <section className="col-span-12 lg:col-span-6 bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E7EB]">
            <h3 className="text-[13px] font-semibold text-[#1A1A1A]">Timeline</h3>
          </div>
          <div className="divide-y divide-[#E5E7EB] max-h-[600px] overflow-y-auto">
            {calls.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="text-[11px] text-[#9CA3AF] tabular-nums">
                  {formatRelativeTime(c.startedAt)} ·{' '}
                  <span className="text-[#6B7280]">
                    {c.direction} {c.status}
                  </span>{' '}
                  · {formatDuration(c.durationSec)} · {formatPence(c.costPence)}
                </div>
                {c.recordingUrl && (
                  <button className="mt-1 text-[11px] flex items-center gap-1 text-[#3C5A87] hover:underline">
                    <Play className="w-3 h-3" /> Play recording
                  </button>
                )}
                {c.aiSummary && (
                  <div className="mt-1.5 text-[12px] text-[#1A1A1A] italic bg-[#EEF2F8]/50 p-2 rounded-lg leading-snug">
                    AI: "{c.aiSummary}"
                  </div>
                )}
              </div>
            ))}
            {sms.map((m) => (
              <div key={m.id} className="px-4 py-3">
                <div className="text-[11px] text-[#9CA3AF] tabular-nums">
                  {formatTimeOnly(m.sentAt)} ·{' '}
                  <span className="text-[#6B7280]">SMS {m.direction}</span>
                </div>
                <div className="mt-1 text-[13px] text-[#1A1A1A]">{m.body}</div>
              </div>
            ))}
            {activities.map((a) => (
              <div key={a.id} className="px-4 py-2 text-[12px]">
                <span className="text-[#6B7280]">• {a.title}</span>
                <span className="text-[10px] text-[#9CA3AF] ml-2">{formatRelativeTime(a.ts)}</span>
              </div>
            ))}
            {/* Video funnel (Hugo 2026-07-26). A fourth block rather than a
                merge: the three lists above use three different time formats
                and each has its own ?demo=1 mock fallback, so merging AND
                adding a source in one change would make a bug in either
                impossible to tell apart. */}
            {timeline.funnel.map((f) => (
              <div key={`fun-${f.id}`} className="px-4 py-2 text-[12px]" data-testid="detail-funnel-event">
                <span className="text-[#3C5A87] font-medium">▶ {f.label}</span>
                <span className="text-[10px] text-[#9CA3AF] ml-2 tabular-nums">
                  {formatDateTime(f.ts)}
                </span>
              </div>
            ))}

            {/* Website funnel. A fifth unmerged block for the same reason the
                other four are unmerged: one source per block means a bug in
                either is obvious rather than blended into the others. */}
            {timeline.site.map((e) => (
              <div key={`site-${e.id}`} className="px-4 py-2 text-[12px]" data-testid="detail-site-event">
                <span className="text-[#166534] font-medium">◆ {e.label}</span>
                <span className="text-[10px] text-[#9CA3AF] ml-2 tabular-nums">
                  {formatDateTime(e.ts)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Right — opportunities + tasks */}
        <aside className="col-span-12 lg:col-span-3 space-y-3">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
              Opportunity
            </div>
            <div className="text-[12px] text-[#6B7280] mt-0.5">
              Value:{' '}
              <span className="font-semibold text-[#3C5A87] tabular-nums">
                {contact.dealValuePence ? formatPence(contact.dealValuePence) : '—'}
              </span>
            </div>
          </div>

          <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E7EB]">
              <h3 className="text-[12px] font-semibold text-[#1A1A1A] uppercase tracking-wide">
                Tasks
              </h3>
            </div>
            <div className="p-3 space-y-2">
              {tasks.length === 0 && (
                <div className="text-[12px] text-[#9CA3AF]">No open tasks.</div>
              )}
              {tasks.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" defaultChecked={t.done} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="text-[#1A1A1A]">{t.title}</div>
                    <div className="text-[10px] text-[#9CA3AF]">
                      due {formatRelativeTime(t.dueAt)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <EditContactModal
        contact={editing}
        onClose={() => setEditing(null)}
        onSave={(updated) => {
          // PR 105: optimistic local + write-through to wk_contacts so
          // edits to name / email / stage survive a reload.
          const prev = getContact(updated.id);
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
        }}
      />
      <ContactSmsModal
        contact={smsTo}
        onClose={() => setSmsTo(null)}
        agentFirstName={agentFirstName ?? ''}
      />
    </div>
  );
}
