import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { callWaAdmin, type MetaTemplate } from '../../lib/waAdmin';
import {
  extractTemplateVars,
  slugTemplateName,
  templateProblem,
} from '../../lib/waTemplates';

/**
 * Meta message templates for the WhatsApp sender (Hugo 2026-08-03).
 *
 * Its own card, separate from the business profile: they are two unrelated
 * things with two unrelated Save buttons, and sharing one box made it look
 * like saving one saved the other.
 *
 * An approved template is the only message that may open a conversation more
 * than 24 hours after the lead last wrote. It costs money per send, unlike a
 * free in-window reply.
 */

function StatusBadge({ status, reason }: { status: string; reason: string }) {
  const s = status.toLowerCase();
  const approved = s === 'approved';
  const rejected = s === 'rejected' || s === 'paused' || s === 'disabled';
  return (
    <span
      title={rejected && reason ? reason : undefined}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
        approved && 'bg-emerald-50 text-emerald-700',
        rejected && 'bg-red-50 text-red-600',
        !approved && !rejected && 'bg-amber-50 text-amber-700',
      )}
    >
      {approved && <BadgeCheck className="w-3 h-3" />}
      {approved ? 'Approved' : rejected ? status : 'In review'}
    </span>
  );
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-[13px] text-[#1A1A1A] bg-white focus:outline-none focus:border-[#3C5A87]';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-[#6B7280] mb-1';

export default function WhatsAppMetaTemplates() {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callWaAdmin<{ templates: MetaTemplate[] }>({ action: 'template_list' });
      setTemplates(res.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bodyVars = extractTemplateVars(newBody);
  const liveProblem = (newName || newBody) ? templateProblem(newName, newBody) : null;

  const submit = async () => {
    const problem = templateProblem(newName, newBody);
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    setError(null);
    try {
      await callWaAdmin({
        action: 'template_create',
        name: newName,
        body: newBody,
        category: newCategory,
        samples,
      });
      setCreating(false);
      setNewName('');
      setNewBody('');
      setSamples({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const del = async (t: MetaTemplate) => {
    if (!confirm(`Delete Meta template "${t.name}"?`)) return;
    setError(null);
    try {
      await callWaAdmin({ action: 'template_delete', content_sid: t.sid });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    }
  };

  return (
    <section
      data-testid="wa-meta-templates-card"
      className="bg-white border border-[#E5E7EB] rounded-2xl p-5"
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-bold text-[#1A1A1A]">Meta approved templates</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            title="Refresh approval status"
            className="p-1.5 rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              data-testid="wa-new-meta-template"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#3C5A87] text-white text-[12px] font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> New template
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[#6B7280] leading-snug mb-3">
        The only WhatsApp messages you can send when a lead has not written to you in the last
        24 hours. Meta reviews each one, usually within the hour. Approved templates appear in
        the inbox composer, and each one sent costs about 4p.
      </p>

      {error && (
        <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {creating && (
        <div className="mb-3 border border-[#E5E7EB] rounded-xl p-3 bg-[#FAFAF7]">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelCls}>Template name</label>
              <input
                className={inputCls}
                placeholder="instagram_url_request"
                value={newName}
                onChange={(e) => setNewName(slugTemplateName(e.target.value))}
                data-testid="wa-tpl-name"
              />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select
                className={inputCls}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as 'MARKETING' | 'UTILITY')}
              >
                <option value="MARKETING">Marketing (safe default)</option>
                <option value="UTILITY">Utility (order/account updates only)</option>
              </select>
            </div>
          </div>
          <label className={labelCls}>Body (use {'{{1}}'} for the lead's first name)</label>
          <textarea
            className={cn(inputCls, 'min-h-[96px] resize-y')}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={'Hi {{1}}, thanks for your interest!'}
            data-testid="wa-tpl-body"
          />
          {bodyVars.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {bodyVars.map((v) => (
                <div key={v}>
                  <label className={labelCls}>
                    Sample for {'{{'}{v}{'}}'} (shown to Meta's reviewer)
                  </label>
                  <input
                    className={inputCls}
                    value={samples[v] ?? ''}
                    placeholder="John"
                    onChange={(e) => setSamples((s) => ({ ...s, [v]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          {liveProblem && <div className="mt-2 text-[11px] text-amber-700">{liveProblem}</div>}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void submit()}
              disabled={submitting || !!templateProblem(newName, newBody)}
              data-testid="wa-tpl-submit"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3C5A87] text-white text-[12px] font-medium disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Submit for approval
            </button>
            <button
              onClick={() => { setCreating(false); setError(null); }}
              className="px-3 py-1.5 text-[12px] text-[#6B7280]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && templates.length === 0 ? (
        <div className="text-[12px] text-[#6B7280] py-2">Loading templates from Twilio...</div>
      ) : templates.length === 0 ? (
        <div className="text-[12px] text-[#6B7280] py-2">
          No Meta templates yet. Create one to reach leads outside the 24 hour window.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.sid}
              data-testid={`wa-meta-template-${t.name}`}
              className="border border-[#E5E7EB] rounded-xl px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[#1A1A1A]">{t.name}</span>
                <StatusBadge status={t.approval.status} reason={t.approval.rejection_reason} />
                {t.approval.category && (
                  <span className="text-[10px] text-[#9CA3AF] uppercase">{t.approval.category}</span>
                )}
                <span className="text-[10px] text-[#9CA3AF] uppercase">{t.language}</span>
                <button
                  onClick={() => void del(t)}
                  title="Delete template"
                  className="ml-auto p-1 text-[#9CA3AF] hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-[12px] text-[#4B5563] whitespace-pre-wrap mt-1">{t.body}</div>
              {t.approval.rejection_reason && (
                <div className="text-[11px] text-red-600 mt-1">
                  Meta said: {t.approval.rejection_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
