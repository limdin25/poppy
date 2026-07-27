// The video messages, on the Templates page where an agent expects to find them.
//
// Hugo 2026-07-27: "when I go to templates, I don't see the templates for
// sending the video. It should be there as well."
//
// These are not wk_sms_templates rows — they live in
// platform_settings.vsl_automation and are read by api/crm/vsl-page.ts (the one
// the agent sends on the call) and api/cron/vsl-automation.ts (the five
// follow-ups that go out on their own). Showing them here is the difference
// between an agent knowing what goes out in their name and guessing.
//
// Read-only for an agent, editable for an admin — the same split the global
// templates above already use.

import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { VSL_SEQUENCE } from '../../../../../api/lib/vsl-sequence';

interface Rule {
  enabled: boolean;
  template: string;
  delay_minutes: number;
  max_sends: number;
  repeat_hours: number;
}

interface Templates {
  send_template: string;
  send_template_no_site: string;
  rules: Record<string, Rule>;
}

/** Left→right through the funnel, so the page reads as the journey the lead
 *  actually takes rather than as whatever order the JSON happens to be in. */
// Order and wording BOTH come from the sequence itself. This file used to keep
// its own list of five keys, so the 2026-07-27 rules rendered as an empty page:
// a second copy of the schedule is a second thing to forget to update.
const RULE_ORDER = VSL_SEQUENCE.map((r) => r.key);
const RULE_LABEL: Record<string, string> = Object.fromEntries(
  VSL_SEQUENCE.map((r) => [r.key, r.label]),
);

const RULE_WHEN = (r: Rule): string => {
  const first = r.delay_minutes >= 60
    ? `${Math.round(r.delay_minutes / 60)}h`
    : `${r.delay_minutes}m`;
  const repeats = r.max_sends > 1 ? `, then every ${r.repeat_hours}h up to ${r.max_sends}×` : '';
  return `Sends ${first} after that happens${repeats}.`;
};

function Field({
  label, hint, value, onChange, editable, rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  rows?: number;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[12px] font-semibold text-[#1A1A1A]">{label}</span>
        {hint && <span className="text-[10.5px] text-[#6B7280]">{hint}</span>}
      </div>
      {editable ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="w-full text-[12px] text-[#1A1A1A] bg-white border border-[#E5E7EB] rounded-[10px] px-2.5 py-2 leading-snug resize-y focus:outline-none focus:border-[#3C5A87]"
        />
      ) : (
        <div className="text-[12px] text-[#6B7280] leading-snug whitespace-pre-wrap bg-[#FAFAF7] border border-[#E5E7EB] rounded-[10px] px-2.5 py-2">
          {value}
        </div>
      )}
    </div>
  );
}

export default function VideoTemplateList({ isAdmin = false }: { isAdmin?: boolean }) {
  const [tpl, setTpl] = useState<Templates | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (method: 'GET' | 'POST', body?: unknown) => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch('/api/crm/vsl-templates', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(res.status === 403 ? 'Admins only.' : `Request failed (${res.status})`);
    }
    return res.json();
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    call('GET')
      .then((d) => setTpl(d.templates as Templates))
      .catch((e) => setError((e as Error).message || 'Could not load the video templates.'))
      .finally(() => setLoading(false));
  }, [call]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!tpl) return;
    setSaving(true);
    setError(null);
    try {
      await call('POST', { templates: tpl });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message || 'Save failed — try again.');
    } finally {
      setSaving(false);
    }
  }

  const setRule = (key: string, template: string) =>
    setTpl((t) => (t ? { ...t, rules: { ...t.rules, [key]: { ...t.rules[key], template } } } : t));

  if (loading) return <div className="text-[12px] text-[#6B7280] py-6 text-center">Loading…</div>;
  if (error && !tpl) {
    return (
      <div className="text-[12px] text-[#EF4444] py-6 text-center">
        {error} <button onClick={load} className="underline font-semibold">Retry</button>
      </div>
    );
  }
  if (!tpl) return null;

  return (
    <div>
      <div className="text-[11px] text-[#6B7280] leading-snug mb-3">
        These are the messages that carry a lead’s personal video page. They use{' '}
        <code className="bg-[#F3F3EE] px-1 rounded">{'{first}'}</code>{' '}
        <code className="bg-[#F3F3EE] px-1 rounded">{'{business}'}</code>{' '}
        <code className="bg-[#F3F3EE] px-1 rounded">{'{url}'}</code>{' '}
        <code className="bg-[#F3F3EE] px-1 rounded">{'{agent}'}</code> — <strong>not</strong> the{' '}
        <code className="bg-[#F3F3EE] px-1 rounded">{'{first_name}'}</code> the templates above use.
        {!isAdmin && ' Only an admin can change them.'}
      </div>

      <div className="space-y-4">
        <div className="border border-[#E5E7EB] rounded-xl p-3 bg-white space-y-3">
          <div className="flex items-center gap-1.5">
            <Clapperboard className="w-3.5 h-3.5 text-[#3C5A87]" />
            <span className="text-[13px] font-semibold text-[#1A1A1A]">Sent on the call</span>
          </div>
          <Field
            label="Video link — has a website"
            hint="what the agent sends after “make their video”"
            value={tpl.send_template}
            onChange={(v) => setTpl((t) => (t ? { ...t, send_template: v } : t))}
            editable={isAdmin}
          />
          <Field
            label="Video link — no website"
            hint="their video opens on the Google search instead"
            value={tpl.send_template_no_site}
            onChange={(v) => setTpl((t) => (t ? { ...t, send_template_no_site: v } : t))}
            editable={isAdmin}
          />
        </div>

        <div className="border border-[#E5E7EB] rounded-xl p-3 bg-white space-y-3">
          <div className="text-[13px] font-semibold text-[#1A1A1A]">
            Follow-ups that send on their own
          </div>
          {RULE_ORDER.map((key) => {
            const rule = tpl.rules[key];
            if (!rule) return null;
            return (
              <div key={key}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12px] font-semibold text-[#1A1A1A]">{RULE_LABEL[key]}</span>
                  {!rule.enabled && (
                    <span className="text-[9px] uppercase font-bold tracking-wide text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] px-1.5 py-0.5 rounded">
                      Off
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] text-[#6B7280] mb-1">{RULE_WHEN(rule)}</div>
                <Field
                  label=""
                  value={rule.template}
                  onChange={(v) => setRule(key, v)}
                  editable={isAdmin}
                  rows={2}
                />
              </div>
            );
          })}
          <div className="text-[10.5px] text-[#6B7280] leading-snug">
            Timings and on/off switches live on the Video funnel page, under Automation.
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] inline-flex items-center gap-1 hover:bg-[#3C5A87]/90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save video templates
          </button>
          {saved && <span className="text-[11px] text-[#166534] font-semibold">Saved</span>}
          {error && <span className="text-[11px] text-[#EF4444]">{error}</span>}
        </div>
      )}
    </div>
  );
}
