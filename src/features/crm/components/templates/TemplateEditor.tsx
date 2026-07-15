import { useState } from 'react';
import { Sparkles, Wand2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { cn } from '@/core/lib/cn';
import type { PipelineColumn } from '../../types';

export interface TemplateDraft {
  name: string;
  body_md: string;
  move_to_stage_id: string | null;
  channel: 'sms' | 'whatsapp' | 'email' | null;
  subject: string;
}

const AI_MODELS: Array<{ id: string; label: string }> = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini (fast, default)' },
  { id: 'gpt-4o', label: 'GPT-4o (best quality)' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
      {children}
    </div>
  );
}

export default function TemplateEditor({
  draft,
  setDraft,
  columns,
  onSave,
  onCancel,
}: {
  draft: TemplateDraft;
  setDraft: (d: TemplateDraft) => void;
  columns: PipelineColumn[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) =>
    setDraft({ ...draft, [k]: v });
  const subjectInvalid =
    draft.channel === 'email' && draft.subject.trim().length === 0;
  const canSave =
    draft.name.trim().length > 0 &&
    draft.body_md.trim().length > 0 &&
    !subjectInvalid;

  const [aiModel, setAiModel] = useState<string>(AI_MODELS[0].id);
  const [aiBusy, setAiBusy] = useState<'generate' | 'refine' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const runAi = async (mode: 'generate' | 'refine') => {
    setAiError(null);
    setAiBusy(mode);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.functions as any).invoke('wk-ai-template', {
        body: {
          mode,
          channel: draft.channel,
          name: draft.name,
          subject: draft.subject,
          body: draft.body_md,
          model: aiModel,
        },
      });
      if (error) throw new Error(error.message ?? 'AI call failed');
      const d = (data ?? {}) as { name?: string; subject?: string; body?: string; error?: string };
      if (d.error) throw new Error(d.error);
      setDraft({
        ...draft,
        name: (d.name && d.name.trim()) || draft.name,
        subject: (d.subject ?? draft.subject ?? '').trim(),
        body_md: (d.body ?? draft.body_md ?? '').trim(),
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI call failed');
    } finally {
      setAiBusy(null);
    }
  };

  const canRefine = draft.body_md.trim().length > 0;
  return (
    <div className="border border-[#3C5A87]/40 bg-[#EEF2F8] rounded-xl p-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Name</Label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Send breakdown"
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          />
        </div>
        <div>
          <Label>Channel</Label>
          <select
            value={draft.channel ?? ''}
            onChange={(e) => {
              const v = e.target.value as '' | 'sms' | 'whatsapp' | 'email';
              set('channel', v === '' ? null : v);
            }}
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          >
            <option value="">Universal (any channel)</option>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </select>
        </div>
      </div>
      {(draft.channel === 'email' || draft.channel === null) && (
        <div>
          <Label>
            Email subject {draft.channel === 'email' ? '(required)' : '(optional — used when sent as email)'}
          </Label>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => set('subject', e.target.value)}
            placeholder="e.g. Your breakdown"
            className={cn(
              'w-full px-3 py-2 text-[12px] border rounded-[10px] bg-white',
              subjectInvalid ? 'border-[#EF4444]' : 'border-[#E5E7EB]'
            )}
          />
          {subjectInvalid && (
            <div className="text-[10px] text-[#EF4444] mt-1">Email templates need a subject.</div>
          )}
        </div>
      )}
      <div>
        <Label>Move contact to stage (optional)</Label>
        <select
          value={draft.move_to_stage_id ?? ''}
          onChange={(e) => set('move_to_stage_id', e.target.value || null)}
          className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
        >
          <option value="">— No stage move —</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Body (use {'{first_name}'} / {'{agent_first_name}'})</Label>
        <textarea
          value={draft.body_md}
          onChange={(e) => set('body_md', e.target.value)}
          rows={4}
          placeholder={
            draft.channel === 'email'
              ? 'Hi {first_name},\n\nHere\'s the breakdown…'
              : 'Hi {first_name}, …'
          }
          className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#E5E7EB] mt-1">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
          AI assist
        </div>
        <select
          value={aiModel}
          onChange={(e) => setAiModel(e.target.value)}
          disabled={aiBusy !== null}
          className="px-2 py-1 text-[11px] border border-[#E5E7EB] rounded-[8px] bg-white disabled:opacity-60"
          title="Pick the AI model"
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void runAi('generate')}
          disabled={aiBusy !== null}
          className="inline-flex items-center gap-1 bg-white border border-[#3C5A87]/40 text-[#3C5A87] text-[11px] font-semibold px-2.5 py-1 rounded-[8px] hover:bg-[#EEF2F8] disabled:opacity-60"
          title="Generate a fresh template from the name + channel"
        >
          {aiBusy === 'generate' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          Generate with AI
        </button>
        <button
          type="button"
          onClick={() => void runAi('refine')}
          disabled={aiBusy !== null || !canRefine}
          className="inline-flex items-center gap-1 bg-white border border-[#E5E7EB] text-[#1A1A1A] text-[11px] font-semibold px-2.5 py-1 rounded-[8px] hover:bg-[#F3F3EE] disabled:opacity-60"
          title={canRefine ? 'Improve the existing draft' : 'Type a body first, then refine'}
        >
          {aiBusy === 'refine' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Wand2 className="w-3 h-3" />
          )}
          Refine with AI
        </button>
      </div>
      {aiError && (
        <div className="text-[10px] text-[#EF4444]">⚠ {aiError}</div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
