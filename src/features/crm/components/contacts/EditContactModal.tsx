import { useMemo, useState, useEffect } from 'react';
import { X, Plus, Trash2, Bell } from 'lucide-react';
import type { Agent, Contact } from '../../types';
import { MOCK_AGENTS } from '../../data/mockAgents';
import { ACTIVE_PIPELINE } from '../../data/mockPipelines';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useFollowups } from '../../hooks/useFollowups';

interface Props {
  contact: Contact | null;
  onClose: () => void;
  onSave: (c: Contact) => void;
  /**
   * Real agents from useAgentsToday() etc. When provided, replaces
   * MOCK_AGENTS in the owner dropdown so the saved owner_agent_id is
   * a real profiles.id (UUID), not a synthetic mock id like "a-hugo".
   */
  agents?: Agent[];
}

export default function EditContactModal({ contact, onClose, onSave, agents }: Props) {
  // Real agents when provided, mock fallback so dev/Storybook still works.
  const ownerOptions = agents && agents.length > 0 ? agents : MOCK_AGENTS;
  // PR 83 (Hugo 2026-04-27): pipeline stages from the DB-hydrated store
  // so the UUID stage IDs we save on contact edit actually match real
  // wk_pipeline_columns.id (mock IDs were silently dropped on save).
  const { columns: storeCols } = useSmsV2();
  const pipelineColumns = useMemo(
    () => (storeCols.length > 0 ? storeCols : ACTIVE_PIPELINE.columns),
    [storeCols]
  );
  const [draft, setDraft] = useState<Contact | null>(contact);
  const [newField, setNewField] = useState({ key: '', value: '' });
  const [newTag, setNewTag] = useState('');

  // PR 110 (Hugo 2026-04-28): edit follow-up time inline. Shows the next
  // PENDING follow-up for this contact; saving the modal also reschedules
  // the follow-up if the agent changed it.
  const { items: allFollowups, reschedule, create: createFollowup } = useFollowups();
  const nextFollowup = useMemo(
    () =>
      contact
        ? allFollowups
            .filter((f) => f.contact_id === contact.id && f.status === 'pending')
            .sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at))[0] ?? null
        : null,
    [allFollowups, contact]
  );
  const [followupDueLocal, setFollowupDueLocal] = useState('');
  const [savingFollowup, setSavingFollowup] = useState(false);

  // Sync draft whenever the modal opens for a new contact (or closes)
  useEffect(() => {
    setDraft(contact);
    setNewField({ key: '', value: '' });
    setNewTag('');
    if (nextFollowup) {
      // Convert ISO → "yyyy-MM-ddTHH:mm" for datetime-local input.
      const d = new Date(nextFollowup.due_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setFollowupDueLocal(local);
    } else {
      // PR 114: when no follow-up exists, default the input to "tomorrow
      // at 10am" so the agent can schedule one in two clicks (edit time
      // if needed, then "Schedule"). Hugo: "I should be able to schedule
      // a follow-up time from the edit modal at any stage, even before
      // a call."
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      tomorrow.setHours(10, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, '0');
      const local = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
      setFollowupDueLocal(local);
    }
  }, [contact, nextFollowup]);

  if (!contact || !draft) return null;

  const set = <K extends keyof Contact>(k: K, v: Contact[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-[560px] bg-white rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.18)] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-[#1A1A1A]">Edit contact</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-[#F3F3EE]">
            <X className="w-4 h-4 text-[#6B7280]" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px]"
              />
            </Field>
            <Field label="Phone">
              <input
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] tabular-nums"
              />
            </Field>
            <Field label="Email">
              <input
                value={draft.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px]"
              />
            </Field>
            <Field label="Deal value (£)">
              <input
                type="number"
                value={draft.dealValuePence ? draft.dealValuePence / 100 : ''}
                onChange={(e) =>
                  set(
                    'dealValuePence',
                    e.target.value ? parseInt(e.target.value, 10) * 100 : undefined
                  )
                }
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] tabular-nums"
              />
            </Field>
            <Field label="Owner">
              <select
                value={draft.ownerAgentId ?? ''}
                onChange={(e) => set('ownerAgentId', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
              >
                <option value="">Unassigned</option>
                {ownerOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pipeline stage">
              <select
                value={draft.pipelineColumnId ?? ''}
                onChange={(e) => set('pipelineColumnId', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
              >
                <option value="">— None —</option>
                {pipelineColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Notes — top-level, always visible */}
          <div>
            <Label>Notes</Label>
            <textarea
              value={draft.customFields.notes ?? ''}
              onChange={(e) =>
                set('customFields', { ...draft.customFields, notes: e.target.value })
              }
              placeholder="Add notes…"
              rows={3}
              className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] resize-none focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80]"
            />
          </div>

          {/* PR 110 + 114: schedule / edit a follow-up. PR 114 (Hugo
              2026-04-28): if NO follow-up exists yet, allow creating
              one right here. Default time = tomorrow 10:00 local. */}
          <div className="bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[10px] p-3">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide text-[#B45309] font-bold">
              <Bell className="w-3 h-3" />
              {nextFollowup ? 'Next follow-up' : 'Schedule a follow-up'}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Due (local time)</Label>
                <input
                  type="datetime-local"
                  value={followupDueLocal}
                  onChange={(e) => setFollowupDueLocal(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!followupDueLocal) return;
                  setSavingFollowup(true);
                  const iso = new Date(followupDueLocal).toISOString();
                  if (nextFollowup) {
                    await reschedule(nextFollowup.id, iso);
                  } else if (contact && draft.pipelineColumnId) {
                    // Create needs a column. If contact has no stage,
                    // we can't create here — skip silently and the
                    // agent can pick a stage first.
                    await createFollowup({
                      contact_id: contact.id,
                      column_id: draft.pipelineColumnId,
                      due_at: iso,
                    });
                  }
                  setSavingFollowup(false);
                }}
                disabled={
                  savingFollowup ||
                  !followupDueLocal ||
                  (!!nextFollowup &&
                    new Date(followupDueLocal).toISOString() === nextFollowup.due_at) ||
                  (!nextFollowup && !draft.pipelineColumnId)
                }
                className="px-3 py-2 bg-[#B45309] text-white text-[12px] font-semibold rounded-[10px] hover:bg-[#92400E] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingFollowup
                  ? 'Saving…'
                  : nextFollowup
                    ? 'Update'
                    : 'Schedule'}
              </button>
            </div>
            {nextFollowup?.note && (
              <div className="text-[11px] text-[#6B7280] mt-1 italic">
                Note: {nextFollowup.note}
              </div>
            )}
            {!nextFollowup && !draft.pipelineColumnId && (
              <div className="text-[10px] text-[#B45309] mt-1.5 italic">
                Pick a pipeline stage above first to schedule.
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draft.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#F3F3EE] text-[#6B7280] pl-2 pr-1 py-0.5 rounded-full"
                >
                  #{t}
                  <button
                    onClick={() =>
                      set(
                        'tags',
                        draft.tags.filter((x) => x !== t)
                      )
                    }
                    className="text-[#9CA3AF] hover:text-[#EF4444]"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    set('tags', [...draft.tags, newTag.trim()]);
                    setNewTag('');
                  }
                }}
                placeholder="Add tag + Enter"
                className="flex-1 px-3 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[10px]"
              />
              <button
                onClick={() => {
                  if (newTag.trim()) {
                    set('tags', [...draft.tags, newTag.trim()]);
                    setNewTag('');
                  }
                }}
                className="px-3 text-[#1E9A80] hover:bg-[#ECFDF5] rounded-[10px]"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Property fields — first-class custom fields surfaced as
              dedicated columns on /crm/contacts. Stored under standard
              keys property_address / property_url inside customFields so
              the data layer stays jsonb-flat (no schema change). */}
          <div className="grid grid-cols-1 gap-2">
            <div>
              <Label>Property address</Label>
              <input
                value={draft.customFields.property_address ?? ''}
                onChange={(e) =>
                  set('customFields', {
                    ...draft.customFields,
                    property_address: e.target.value,
                  })
                }
                placeholder="e.g. 12 Acacia Avenue, London W1"
                className="w-full px-3 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[10px]"
              />
            </div>
            <div>
              <Label>Property URL</Label>
              <input
                value={draft.customFields.property_url ?? ''}
                onChange={(e) =>
                  set('customFields', {
                    ...draft.customFields,
                    property_url: e.target.value,
                  })
                }
                placeholder="https://…"
                type="url"
                className="w-full px-3 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[10px]"
              />
            </div>
          </div>

          {/* Custom fields */}
          <div>
            <Label>Custom fields</Label>
            <div className="space-y-1.5 mb-2">
              {Object.entries(draft.customFields)
                .filter(([k]) => k !== 'property_address' && k !== 'property_url')
                .map(([k, v]) => (
                <div key={k} className="flex gap-1.5 items-center">
                  <input
                    value={k}
                    readOnly
                    className="w-[40%] px-2 py-1 text-[12px] bg-[#F3F3EE]/60 border border-[#E5E7EB] rounded-[8px] text-[#6B7280]"
                  />
                  <input
                    value={v}
                    onChange={(e) =>
                      set('customFields', {
                        ...draft.customFields,
                        [k]: e.target.value,
                      })
                    }
                    className="flex-1 px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px]"
                  />
                  <button
                    onClick={() => {
                      const cf = { ...draft.customFields };
                      delete cf[k];
                      set('customFields', cf);
                    }}
                    className="text-[#9CA3AF] hover:text-[#EF4444] p-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={newField.key}
                onChange={(e) => setNewField({ ...newField, key: e.target.value })}
                placeholder="Field name"
                className="w-[40%] px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px]"
              />
              <input
                value={newField.value}
                onChange={(e) =>
                  setNewField({ ...newField, value: e.target.value })
                }
                placeholder="Value"
                className="flex-1 px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px]"
              />
              <button
                onClick={() => {
                  if (newField.key.trim()) {
                    set('customFields', {
                      ...draft.customFields,
                      [newField.key.trim()]: newField.value,
                    });
                    setNewField({ key: '', value: '' });
                  }
                }}
                className="px-2 text-[#1E9A80] hover:bg-[#ECFDF5] rounded-[8px]"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-[#F3F3EE]/50 border-t border-[#E5E7EB] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12px] text-[#6B7280] hover:text-[#1A1A1A] px-3 py-2"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="bg-[#1E9A80] text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#1E9A80]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)]"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
      {children}
    </div>
  );
}
