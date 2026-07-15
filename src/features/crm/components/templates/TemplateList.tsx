import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useSmsTemplates, type SmsTemplate } from '../../hooks/useSmsTemplates';
import { useSmsV2 } from '../../store/SmsV2Store';
import ChannelBadge from './ChannelBadge';
import TemplateEditor, { type TemplateDraft } from './TemplateEditor';

interface TemplateListProps {
  campaignId?: string | null;
  filterChannel?: 'sms' | 'whatsapp' | 'email' | null;
  isAdmin?: boolean;
}

export default function TemplateList({
  campaignId = null,
  filterChannel,
  isAdmin = false,
}: TemplateListProps) {
  const { items: allItems, loading, error, add, patch, remove } = useSmsTemplates({ campaignId });
  const { columns } = useSmsV2();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>({
    name: '',
    body_md: '',
    move_to_stage_id: null,
    channel: filterChannel ?? null,
    subject: '',
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const items = filterChannel != null
    ? allItems.filter((t) => t.channel === filterChannel || t.channel === null)
    : allItems;

  const startEdit = (t: SmsTemplate) => {
    if (!isAdmin && t.is_global) return;
    setEditingId(t.id);
    setDraft({
      name: t.name,
      body_md: t.body_md,
      move_to_stage_id: t.move_to_stage_id,
      channel: t.channel,
      subject: t.subject ?? '',
    });
  };
  const startNew = () => {
    setEditingId('new');
    setDraft({
      name: '',
      body_md: '',
      move_to_stage_id: null,
      channel: filterChannel ?? null,
      subject: '',
    });
  };
  const cancel = () => {
    setEditingId(null);
    setActionError(null);
  };

  const save = async () => {
    setActionError(null);
    if (draft.channel === 'email' && !draft.subject.trim()) {
      setActionError('Email templates need a subject line.');
      return;
    }
    try {
      const subjectValue =
        draft.channel === 'email' || draft.channel === null
          ? draft.subject.trim() || null
          : null;
      if (editingId === 'new') {
        await add({
          name: draft.name.trim(),
          body_md: draft.body_md.trim(),
          is_global: isAdmin,
          owner_agent_id: null,
          move_to_stage_id: draft.move_to_stage_id,
          channel: draft.channel,
          subject: subjectValue,
          attachment_url: null,
        });
      } else if (editingId) {
        await patch(editingId, {
          name: draft.name.trim(),
          body_md: draft.body_md.trim(),
          move_to_stage_id: draft.move_to_stage_id,
          channel: draft.channel,
          subject: subjectValue,
        });
      }
      cancel();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'save failed');
    }
  };

  const del = async (t: SmsTemplate) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    setActionError(null);
    try {
      await remove(t.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'delete failed');
    }
  };

  const channelLabel = filterChannel
    ? filterChannel === 'sms' ? 'SMS' : filterChannel === 'whatsapp' ? 'WhatsApp' : 'Email'
    : 'SMS / WhatsApp / Email';

  return (
    <div>
      <div className="text-[11px] text-[#6B7280] leading-snug mb-3">
        Each template can optionally <strong>move the contact to a pipeline stage</strong> when an
        agent uses it to send.
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] text-[#6B7280]">
          {loading ? 'Loading…' : `${items.length} ${channelLabel} templates`}
        </div>
        <button
          onClick={startNew}
          disabled={editingId !== null}
          className="bg-[#1E9A80] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] inline-flex items-center gap-1 hover:bg-[#1E9A80]/90 disabled:opacity-60"
        >
          <Plus className="w-3.5 h-3.5" /> New template
        </button>
      </div>

      {(error || actionError) && (
        <div className="text-[11px] text-[#EF4444] mb-2">
          ⚠ {actionError ?? error}
        </div>
      )}

      {editingId === 'new' && (
        <TemplateEditor
          draft={draft}
          setDraft={setDraft}
          columns={columns}
          onSave={save}
          onCancel={cancel}
        />
      )}

      <div className="space-y-2">
        {items.map((t) => {
          const targetStage = columns.find((c) => c.id === t.move_to_stage_id);
          const canEdit = isAdmin || !t.is_global;
          return (
            <div
              key={t.id}
              className="border border-[#E5E7EB] rounded-xl p-3 bg-white"
            >
              {editingId === t.id ? (
                <TemplateEditor
                  draft={draft}
                  setDraft={setDraft}
                  columns={columns}
                  onSave={save}
                  onCancel={cancel}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-[#1A1A1A]">{t.name}</span>
                      <ChannelBadge channel={t.channel} />
                      {t.is_global && (
                        <span className="text-[9px] uppercase font-bold tracking-wide text-[#6B7280] bg-[#F3F3EE] px-1.5 py-0.5 rounded">
                          global
                        </span>
                      )}
                      {targetStage && (
                        <span className="text-[10px] bg-[#ECFDF5] text-[#1E9A80] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5">
                          → {targetStage.name}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(t)}
                        disabled={!canEdit}
                        className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] hover:bg-[#F3F3EE] disabled:opacity-40"
                        title={canEdit ? 'Edit template' : 'Only admins can edit global templates'}
                      >
                        Edit
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => void del(t)}
                          className="text-[11px] px-2 py-1 rounded-md text-[#EF4444] hover:bg-[#FEF2F2]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {t.channel === 'email' && t.subject && (
                    <div className="text-[11px] text-[#1A1A1A] mb-1">
                      <span className="font-semibold">Subject:</span> {t.subject}
                    </div>
                  )}
                  <div className="text-[12px] text-[#6B7280] leading-snug whitespace-pre-wrap">
                    {t.body_md}
                  </div>
                </>
              )}
            </div>
          );
        })}
        {!loading && items.length === 0 && editingId !== 'new' && (
          <div className="text-[12px] text-[#9CA3AF] text-center py-6">
            No templates yet. Click "New template" to add one.
          </div>
        )}
      </div>
    </div>
  );
}
