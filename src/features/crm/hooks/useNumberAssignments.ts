// useNumberAssignments — admin view of every CRM number, its label, and which
// agents it's assigned to (many-to-many via wk_number_agents). Powers the
// "Assign numbers to agents" card in Settings → Numbers. Writes go straight to
// Supabase; RLS enforces admin-only writes.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AssignableNumber {
  id: string;
  e164: string;
  label: string | null;
  channel: string;
  sms_enabled: boolean;
  voice_enabled: boolean;
}
export interface AssignableAgent {
  id: string;
  name: string;
}
export interface NumberAssignment {
  number_id: string;
  agent_id: string;
  is_primary: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (name: string) => supabase.from(name as any) as any;

export function useNumberAssignments() {
  const [numbers, setNumbers] = useState<AssignableNumber[]>([]);
  const [agents, setAgents] = useState<AssignableAgent[]>([]);
  const [assignments, setAssignments] = useState<NumberAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [numsRes, agentsRes, asgRes] = await Promise.all([
      tbl('wk_numbers').select('id, e164, label, channel, sms_enabled, voice_enabled').order('e164'),
      tbl('profiles').select('id, name, email').in('workspace_role', ['agent', 'admin']),
      tbl('wk_number_agents').select('number_id, agent_id, is_primary'),
    ]);
    if (numsRes.error) setError(numsRes.error.message);
    setNumbers((numsRes.data ?? []) as AssignableNumber[]);
    setAgents(((agentsRes.data ?? []) as Array<{ id: string; name: string | null; email: string | null }>)
      .map((a) => ({ id: a.id, name: a.name ?? a.email ?? 'Agent' }))
      .sort((a, b) => a.name.localeCompare(b.name)));
    setAssignments((asgRes.data ?? []) as NumberAssignment[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const assign = useCallback(async (numberId: string, agentId: string) => {
    const { error } = await tbl('wk_number_agents').insert({ number_id: numberId, agent_id: agentId });
    if (error) { setError(error.message); return; }
    await refresh();
  }, [refresh]);

  const unassign = useCallback(async (numberId: string, agentId: string) => {
    const { error } = await tbl('wk_number_agents').delete().eq('number_id', numberId).eq('agent_id', agentId);
    if (error) { setError(error.message); return; }
    await refresh();
  }, [refresh]);

  // Only one primary number per agent — clear the agent's others first.
  const setPrimary = useCallback(async (numberId: string, agentId: string, value: boolean) => {
    if (value) await tbl('wk_number_agents').update({ is_primary: false }).eq('agent_id', agentId);
    const { error } = await tbl('wk_number_agents').update({ is_primary: value }).eq('number_id', numberId).eq('agent_id', agentId);
    if (error) { setError(error.message); return; }
    await refresh();
  }, [refresh]);

  const setLabel = useCallback(async (numberId: string, label: string) => {
    const { error } = await tbl('wk_numbers').update({ label: label.trim() || null }).eq('id', numberId);
    if (error) { setError(error.message); return; }
    setNumbers((prev) => prev.map((n) => (n.id === numberId ? { ...n, label: label.trim() || null } : n)));
  }, []);

  return { numbers, agents, assignments, loading, error, refresh, assign, unassign, setPrimary, setLabel };
}
