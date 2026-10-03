// Objections (Pedro, 3 Oct 2026): what owners actually say on his calls, and
// the best way to answer each one, mined from the real transcripts by
// scripts/hostunico-objections.mjs into wk_objections. Read only here.
// Each example call opens the past-call screen, where he can re-listen.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, PlayCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useDesk } from '../lib/DeskContext';

export interface ObjectionRow {
  id: string;
  category: string;
  objection: string;
  example_quotes: string[];
  call_ids: string[];
  times_heard: number;
  best_rebuttal: string;
  our_rebuttal_seen: string | null;
  created_at: string;
}

export function filterObjections(rows: ObjectionRow[], query: string): ObjectionRow[] {
  const q = query.trim().toLowerCase();
  const sorted = [...rows].sort((a, b) => b.times_heard - a.times_heard || a.category.localeCompare(b.category));
  if (!q) return sorted;
  return sorted.filter((r) => [r.category, r.objection, r.best_rebuttal, ...(r.example_quotes || [])].join(' ').toLowerCase().includes(q));
}

export function ObjectionsList({ rows, query, myCalls }: { rows: ObjectionRow[]; query: string; myCalls?: Set<string> }) {
  const shown = filterObjections(rows, query);
  const calls = new Set(rows.flatMap((r) => r.call_ids || []));
  const generated = rows.map((r) => r.created_at).sort().at(-1);
  return <>
    {rows.length > 0 && <p className="rounded-xl bg-[#EEF2F8] px-4 py-3 text-sm leading-relaxed text-[#3C5A87]" data-testid="objections-note">
      Generated on {generated ? new Date(generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'an unknown date'} from {calls.size} real calls where owners raised objections, plus the standard owner objections. The answers are suggestions in your own words: adapt them, never promise guaranteed income.
    </p>}
    {shown.length === 0 && <p className="py-8 text-center text-sm text-[#6B7280]">{rows.length ? 'Nothing matches that search.' : 'No objections yet.'}</p>}
    <div className="space-y-4">
      {shown.map((r) => <article key={r.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-4 md:p-5" data-testid="objection-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">{r.category}</h2>
          <span className="text-xs text-[#9CA3AF]">{r.times_heard > 0 ? `Heard ${r.times_heard} time${r.times_heard === 1 ? '' : 's'}` : 'Standard objection'}</span>
        </div>
        <p className="mt-1 text-lg font-semibold leading-snug text-[#1A1A1A] md:text-xl">{r.objection}</p>
        {r.example_quotes?.length > 0 && <ul className="mt-2 space-y-1">
          {r.example_quotes.map((q) => <li key={q} className="text-[15px] italic leading-relaxed text-[#4B5563]">"{q}"</li>)}
        </ul>}
        <div className="mt-3 rounded-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Say this</p>
          <p className="mt-1 text-lg leading-relaxed text-[#14532D] md:text-xl">{r.best_rebuttal}</p>
        </div>
        {r.our_rebuttal_seen && <p className="mt-2 text-sm text-[#6B7280]"><b>What was said on a call:</b> {r.our_rebuttal_seen}</p>}
        {r.call_ids?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
          {r.call_ids.filter((id) => !myCalls || myCalls.has(id)).slice(0, 6).map((id, i) => <Link key={id} to={`/admin/crm/calls/${id}`} className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-sm font-medium text-[#3C5A87] hover:bg-[#EEF2F8]">
            <PlayCircle className="h-4 w-4" />Listen to call {i + 1}
          </Link>)}
        </div>}
      </article>)}
    </div>
  </>;
}

export default function ObjectionsPage() {
  const { desk } = useDesk();
  const [rows, setRows] = useState<ObjectionRow[]>([]);
  const [myCalls, setMyCalls] = useState<Set<string> | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase.from('wk_objections' as any) as any)
        .select('id, category, objection, example_quotes, call_ids, times_heard, best_rebuttal, our_rebuttal_seen, created_at')
        .eq('desk', desk)
        .eq('is_active', true)
        .order('sort_order');
      if (cancelled) return;
      if (err) { setError('Could not load the objections. Please refresh.'); setLoading(false); return; }
      const list = (data ?? []) as ObjectionRow[];
      setRows(list);
      // Only link calls this person can open (their own, or every call for an admin).
      const ids = [...new Set(list.flatMap((r) => r.call_ids || []))];
      if (ids.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: visible } = await (supabase.from('wk_calls' as any) as any).select('id').in('id', ids).eq('desk', desk);
        if (!cancelled) setMyCalls(new Set(((visible ?? []) as { id: string }[]).map((c) => c.id)));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [desk]);
  const count = useMemo(() => filterObjections(rows, query).length, [rows, query]);
  return <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4 md:px-6 md:py-6" data-testid="objections-page">
    <header>
      <h1 className="text-2xl font-bold text-[#1A1A1A]">Objections</h1>
      <p className="mt-1 text-[15px] text-[#6B7280]">What owners say on the phone, and how to answer. Most heard first.</p>
    </header>
    <label className="relative block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, for example price, manager, email" aria-label="Search objections" className="w-full rounded-xl border border-[#E5E7EB] py-3 pl-9 pr-3 text-base focus:border-[#3C5A87] focus:outline-none" />
    </label>
    {query && <p className="text-sm text-[#6B7280]">{count} match{count === 1 ? '' : 'es'}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {loading ? <p className="py-8 text-center text-sm text-[#9CA3AF]">Loading...</p> : <ObjectionsList rows={rows} query={query} myCalls={myCalls} />}
  </div>;
}
