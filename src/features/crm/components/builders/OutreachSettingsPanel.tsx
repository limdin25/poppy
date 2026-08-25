// The builder outreach settings, admin only.
//
// This row in platform_settings has driven the whole builder lane since it was
// built and has never had a screen. Every value here was edited by hand in the
// database, which is why nobody could answer "is the opener template actually
// wired up" without opening SQL.
//
// It is admin-gated while the rest of the desk is open to Pedro, because these
// are not per-house decisions: auto-send and the daily cap change what goes out
// to real builders on every house at once.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

interface Settings {
  auto_send: boolean;
  daily_cap: number;
  radius_m: number;
  max_new_builders: number;
  invite_sid: string;
  followup_sid: string;
  morning_sid: string;
  query_sid: string;
}

const SIDS: Array<{ key: keyof Settings; label: string; help: string }> = [
  { key: 'invite_sid', label: 'The opener', help: 'The first message a builder gets, asking them to walk a house.' },
  { key: 'followup_sid', label: 'The chase', help: 'Sent when a builder never answered the opener.' },
  { key: 'morning_sid', label: 'Morning reminder', help: 'Sent at 8am on the day of the viewing.' },
  { key: 'query_sid', label: 'Question to Hugo', help: 'Not builder-facing. This is how the machine asks you something when your WhatsApp window is shut, so leaving it blank stops every escalation.' },
];

export default function OutreachSettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const call = useCallback(async (init?: RequestInit) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('Not signed in');
    const res = await fetch('/api/admin/builder-settings', {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const raw = await res.text();
    let json: Record<string, unknown>;
    try { json = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new Error(`The server answered with an error (HTTP ${res.status}).`); }
    if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
    return json;
  }, []);

  useEffect(() => {
    let alive = true;
    call()
      .then((j) => { if (alive) setS(j.settings as Settings); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Could not load the settings.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [call]);

  const save = async () => {
    if (!s || saving) return;
    setSaving(true); setErr(null); setMsg(null);
    try {
      const j = await call({ method: 'POST', body: JSON.stringify({ settings: s }) });
      setS(j.settings as Settings);
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-24 animate-pulse rounded-[10px] bg-[#F3F4F6]" />;
  if (!s) return <p className="text-[11.5px] text-[#DC2626]">{err ?? 'Could not load the settings.'}</p>;

  const num = (key: 'daily_cap' | 'radius_m' | 'max_new_builders', label: string, help: string, suffix?: string) => (
    <div key={key}>
      <label className="block text-[11.5px] font-medium text-[#1A1A1A]">{label}</label>
      <p className="mb-1 text-[10.5px] text-[#6B7280]">{help}</p>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={s[key]}
          onChange={(e) => setS({ ...s, [key]: Number(e.target.value) })}
          className="w-28 rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] tabular-nums focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
        />
        {suffix ? <span className="text-[11px] text-[#9CA3AF]">{suffix}</span> : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="builder-settings-panel">
      {err ? <div className="rounded-[10px] border border-[#DC2626]/40 bg-[#FEF2F2] px-3 py-2 text-[11.5px] text-[#DC2626]">{err}</div> : null}
      {msg ? <div className="rounded-[10px] border border-[#BBD4BE] bg-[#EDF6EE] px-3 py-2 text-[11.5px] text-[#2E7D46]">{msg}</div> : null}

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={s.auto_send}
          onChange={(e) => setS({ ...s, auto_send: e.target.checked })}
          className="mt-[3px] h-3.5 w-3.5 accent-[#3C5A87]"
        />
        <span>
          <span className="block text-[11.5px] font-medium text-[#1A1A1A]">Invite builders automatically</span>
          <span className="block text-[10.5px] text-[#6B7280]">
            When this is on, the machine sends openers on its own every five minutes without anybody pressing
            anything. Off means a person picks the builders and reads the message first.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {num('daily_cap', 'Most messages a day', 'Across every house together, not per house. Sending more than this in a day is how a number gets reported.')}
        {num('radius_m', 'Where to start looking', 'The FIRST ring searched around a house, not a fixed limit. Find more steps out to 20km and then 40km.', 'metres')}
        {num('max_new_builders', 'New builders per area', 'How many unknown builders one search may add to the roster. It does not cap how many you can invite.')}
      </div>

      <div className="space-y-3">
        <h3 className="text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Approved WhatsApp messages</h3>
        {SIDS.map(({ key, label, help }) => {
          const v = String(s[key] ?? '');
          const wired = /^HX[0-9a-f]{32}$/i.test(v);
          return (
            <div key={key}>
              <div className="flex items-center gap-1.5">
                <label className="text-[11.5px] font-medium text-[#1A1A1A]">{label}</label>
                <span
                  className={
                    wired
                      ? 'rounded-full border border-[#BBD4BE] bg-[#EDF6EE] px-1.5 py-[1px] text-[9.5px] font-semibold text-[#2E7D46]'
                      : 'rounded-full border border-[#F59E0B] bg-[#FFFBEB] px-1.5 py-[1px] text-[9.5px] font-semibold text-[#B45309]'
                  }
                >
                  {wired ? 'wired up' : 'not set'}
                </span>
              </div>
              <p className="mb-1 text-[10.5px] text-[#6B7280]">{help}</p>
              <input
                value={v}
                onChange={(e) => setS({ ...s, [key]: e.target.value })}
                placeholder="HX..."
                spellCheck={false}
                className="w-full rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1 font-mono text-[11.5px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
              />
            </div>
          );
        })}
      </div>

      <button
        data-testid="builder-settings-save"
        onClick={() => void save()}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#3C5A87] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save
      </button>
    </div>
  );
}
