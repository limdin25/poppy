import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { HOSTUNICO_FOLLOWUP, type FollowupConfig, type SequenceLead } from '@/core/hostunicoFollowup';
export async function followupAction(action: string, values: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in.');
  const read = action === 'list' || action === 'items';
  const query = new URLSearchParams({ action, ...(values.contact_id ? { contact_id: String(values.contact_id) } : {}) });
  const r = await fetch(`/api/crm/sa-followups${read ? `?${query}` : ''}`, { method: read ? 'GET' : 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, ...(read ? {} : { body: JSON.stringify({ action, ...values }) }) });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || 'Could not load follow-ups.');
  return result;
}
export function useHostunicoFollowups(enabled = true) {
  const [leads, setLeads] = useState<SequenceLead[]>([]);
  const [config, setConfig] = useState<FollowupConfig>(HOSTUNICO_FOLLOWUP);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!enabled) return;
    try { const r = await followupAction('list'); setLeads(r.leads); setConfig(r.config); setAdmin(r.admin); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load follow-ups.'); }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const channel = supabase.channel('hostunico-followups-page').on('postgres_changes', { event: '*', schema: 'public', table: 'sa_report_followups' }, () => void load()).subscribe();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { void supabase.removeChannel(channel); window.clearInterval(timer); };
  }, [load, enabled]);
  return { leads, config, admin, error, reload: load };
}
