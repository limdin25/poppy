import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAgreementTemplates, type AgreementTemplate } from '../../hooks/useAgreementTemplates';

interface AgreementTemplateListProps {
  isAdmin?: boolean;
}

interface AgreementDraft {
  name: string;
  title: string;
  terms_html: string;
  default_amount: string;
  default_currency: string;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
      {children}
    </div>
  );
}

const EMPTY_DRAFT: AgreementDraft = {
  name: '',
  title: 'Investment Agreement',
  terms_html: '',
  default_amount: '',
  default_currency: 'USD',
};

export default function AgreementTemplateList({ isAdmin = false }: AgreementTemplateListProps) {
  const { items, loading, error, add, patch, remove } = useAgreementTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgreementDraft>(EMPTY_DRAFT);
  const [actionError, setActionError] = useState<string | null>(null);

  const set = <K extends keyof AgreementDraft>(k: K, v: AgreementDraft[K]) =>
    setDraft({ ...draft, [k]: v });

  const startEdit = (t: AgreementTemplate) => {
    if (!isAdmin && t.is_global) return;
    setEditingId(t.id);
    setDraft({
      name: t.name,
      title: t.title,
      terms_html: t.terms_html ?? '',
      default_amount: t.default_amount != null ? String(t.default_amount) : '',
      default_currency: t.default_currency,
    });
  };

  const startNew = () => {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  };

  const cancel = () => {
    setEditingId(null);
    setActionError(null);
  };

  const save = async () => {
    setActionError(null);
    if (!draft.name.trim() || !draft.title.trim()) {
      setActionError('Name and title are required.');
      return;
    }
    try {
      const payload = {
        name: draft.name.trim(),
        title: draft.title.trim(),
        terms_html: draft.terms_html.trim() || null,
        default_amount: draft.default_amount ? Number(draft.default_amount) : null,
        default_currency: draft.default_currency,
        is_global: isAdmin,
        owner_agent_id: null,
      };
      if (editingId === 'new') {
        await add(payload);
      } else if (editingId) {
        await patch(editingId, payload);
      }
      cancel();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'save failed');
    }
  };

  const del = async (t: AgreementTemplate) => {
    if (!confirm(`Delete agreement template "${t.name}"?`)) return;
    setActionError(null);
    try {
      await remove(t.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'delete failed');
    }
  };

  const canSave = draft.name.trim().length > 0 && draft.title.trim().length > 0;

  const editorUI = (
    <div className="border border-[#1E9A80]/40 bg-[#ECFDF5] rounded-xl p-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Template name</Label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Standard property agreement"
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          />
        </div>
        <div>
          <Label>Agreement title</Label>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Investment Agreement"
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Default amount</Label>
          <input
            type="number"
            value={draft.default_amount}
            onChange={(e) => set('default_amount', e.target.value)}
            placeholder="e.g. 5000"
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          />
        </div>
        <div>
          <Label>Currency</Label>
          <select
            value={draft.default_currency}
            onChange={(e) => set('default_currency', e.target.value)}
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          >
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>
      <div>
        <Label>Terms (HTML)</Label>
        <textarea
          value={draft.terms_html}
          onChange={(e) => set('terms_html', e.target.value)}
          rows={6}
          placeholder="Enter agreement terms as HTML…"
          className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white font-mono"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void save()}
          disabled={!canSave}
          className="bg-[#1E9A80] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] hover:bg-[#1E9A80]/90 disabled:opacity-60"
        >
          Save
        </button>
        <button
          onClick={cancel}
          className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="text-[11px] text-[#6B7280] leading-snug mb-3">
        Reusable agreement templates with default title, amount, currency, and terms.
        Agents can create personal templates; admins create global ones.
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] text-[#6B7280]">
          {loading ? 'Loading…' : `${items.length} agreement templates`}
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

      {editingId === 'new' && editorUI}

      <div className="space-y-2">
        {items.map((t) => {
          const canEdit = isAdmin || !t.is_global;
          return (
            <div key={t.id} className="border border-[#E5E7EB] rounded-xl p-3 bg-white">
              {editingId === t.id ? (
                editorUI
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-[#1A1A1A]">{t.name}</span>
                      <span className="text-[9px] uppercase font-bold tracking-wide text-[#B45309] bg-[#FEF3C7] px-1.5 py-0.5 rounded">
                        Agreement
                      </span>
                      {t.is_global && (
                        <span className="text-[9px] uppercase font-bold tracking-wide text-[#6B7280] bg-[#F3F3EE] px-1.5 py-0.5 rounded">
                          global
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
                  <div className="text-[11px] text-[#1A1A1A] mb-1">
                    <span className="font-semibold">Title:</span> {t.title}
                    {t.default_amount != null && (
                      <span className="ml-2 text-[#6B7280]">
                        {t.default_currency} {Number(t.default_amount).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {t.terms_html && (
                    <div className="text-[12px] text-[#6B7280] leading-snug whitespace-pre-wrap line-clamp-3">
                      {t.terms_html.replace(/<[^>]*>/g, '').slice(0, 200)}
                      {t.terms_html.length > 200 ? '…' : ''}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {!loading && items.length === 0 && editingId !== 'new' && (
          <div className="text-[12px] text-[#9CA3AF] text-center py-6">
            No agreement templates yet. Click "New template" to add one.
          </div>
        )}
      </div>
    </div>
  );
}
