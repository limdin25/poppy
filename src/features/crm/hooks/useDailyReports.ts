// useDailyReports — the AI coaching reports written at 17:30 UK each day.
//
// Hugo 2026-07-24: both agents see BOTH reports, deliberately, to keep it
// competitive. RLS on wk_agent_daily_reports allows any CRM staff to read every
// row, so no filtering here — the UI groups by date and shows every agent.
//
// Written by api/cron/daily-agent-reports.ts. Read-only from the client.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface DailyReport {
  id: string;
  agentId: string;
  agentName: string;
  reportDate: string; // YYYY-MM-DD
  bodyMd: string;
  stats: Record<string, number | null>;
}

interface Row {
  id: string;
  agent_id: string;
  report_date: string;
  body_md: string;
  stats: Record<string, number | null> | null;
}

export function useDailyReports(limitDays = 30): {
  reports: DailyReport[];
  dates: string[];
  loading: boolean;
  error: string | null;
} {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - limitDays);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: dbError } = await (supabase.from('wk_agent_daily_reports' as any) as any)
      .select('id, agent_id, report_date, body_md, stats')
      .gte('report_date', since.toISOString().slice(0, 10))
      .order('report_date', { ascending: false });

    if (dbError) {
      setError(dbError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Row[];
    const ids = Array.from(new Set(rows.map((r) => r.agent_id)));
    const names = new Map<string, string>();
    if (ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profs } = await (supabase.from('profiles' as any) as any)
        .select('id, name, email')
        .in('id', ids);
      for (const p of (profs ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
        names.set(p.id, p.name?.trim() || p.email || 'Agent');
      }
    }

    setError(null);
    setReports(
      rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        agentName: names.get(r.agent_id) ?? 'Agent',
        reportDate: r.report_date,
        bodyMd: r.body_md,
        stats: r.stats ?? {},
      })),
    );
    setLoading(false);
  }, [limitDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dates = Array.from(new Set(reports.map((r) => r.reportDate)));
  return { reports, dates, loading, error };
}
