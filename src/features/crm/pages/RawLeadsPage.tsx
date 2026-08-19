// The raw data command center, laid out as a spreadsheet.
//
// Hugo, 2026-08-19: "I want it like a spreadsheet, everything side by side.
// First column the property name hyperlinked so I can go to the listing,
// next to it the comparisons, first, second, third, and a tick to confirm
// floor plan available, so we know the comparison has the floor plan. How
// much is the asking price, everything."
//
// THE SIZE RULE backs every row: since 2026-08-19 the pool refuses any
// house without its own floor plan or without three comparables whose floor
// area is KNOWN ("to compare you need the size, otherwise it is useless"),
// so every comp cell here carries a real size. Every figure is READ from
// wk_raw_leads, which the engine's nightly export fills; nothing on this
// page computes money. The push flips the already-written review queue rows
// to pending (api/crm/raw-leads.ts), so approving cannot half-create
// anything. Multi-select, drag onto the dialer zone, sort by location,
// price, scrape date and discount.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, RefreshCw, HardHat, CalendarDays, X, Radio, Loader2,
  ArrowUp, ArrowDown, Check, Ruler,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';

interface CompRow {
  price?: number;
  distance_m?: number;
  date?: string;
  address?: string;
  floor_area_sqm?: number | null;
}

interface RawLead {
  id: string;
  property_id: string;
  contact_id: string | null;
  kind: string;
  address: string | null;
  outcode: string | null;
  asking_price: number | null;
  discount: number | null;
  band_min: number | null;
  band_max: number | null;
  comps: CompRow[];
  floorplans: string[];
  url: string | null;
  bedrooms: number | null;
  property_type: string | null;
  agent_name: string | null;
  days_on_market: number | null;
  scraped_at: string | null;
  status: string;
}

type SortKey = 'discount' | 'price' | 'location' | 'scraped';

const gbp = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : null;

/** One comparable, one cell: price, distance, when, and the size tick. */
function CompCell({ c }: { c: CompRow | undefined }) {
  if (!c) return <td className="px-2 py-2 text-[10.5px] text-[#D1D5DB]">none</td>;
  return (
    <td className="px-2 py-2 align-top whitespace-nowrap">
      <div className="text-[12px] font-semibold text-[#1A1A1A]">{gbp(c.price) ?? '?'}</div>
      <div className="text-[10px] text-[#6B7280]">
        {typeof c.distance_m === 'number' ? `${c.distance_m}m` : '?'} · {c.date || '?'}
      </div>
      {c.floor_area_sqm ? (
        <div className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#2E7D46]">
          <Check className="w-3 h-3" />{Math.round(c.floor_area_sqm)} sqm
        </div>
      ) : (
        <div className="text-[10px] font-semibold text-[#B45309]">size?</div>
      )}
      {c.address && (
        <div className="max-w-[130px] truncate text-[9.5px] text-[#9CA3AF]" title={c.address}>{c.address}</div>
      )}
    </td>
  );
}

export default function RawLeadsPage() {
  const [leads, setLeads] = useState<RawLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('discount');
  const [sortAsc, setSortAsc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('Not signed in');
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    // Text first: a gateway timeout answers with a plain-text page.
    const raw = await res.text();
    let json: Record<string, unknown>;
    try { json = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new Error(`The server answered with an error (HTTP ${res.status}).`); }
    if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
    return json;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await call('/api/crm/raw-leads');
      setLeads((json.leads as RawLead[]) ?? []);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the raw leads');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: 'push' | 'reject', ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const json = await call('/api/crm/raw-leads', {
        method: 'POST',
        body: JSON.stringify({ action, ids }),
      });
      const results = (json.results as Array<{ ok: boolean; reason?: string }>) ?? [];
      const misses = results.filter((r) => !r.ok).length;
      setNotice(action === 'push'
        ? `${results.length - misses} pushed to Pedro's dialer${misses ? `, ${misses} had no queue row (redial hold or refused at assign)` : ''}.`
        : `${results.length - misses} rejected.`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'The press failed');
    } finally {
      setBusy(false);
    }
  }, [busy, call, load]);

  const onCheck = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const onDragStart = useCallback((e: React.DragEvent, id: string) => {
    // Dragging a selected row carries the whole selection; dragging an
    // unselected one carries just itself.
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData('application/x-raw-lead-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  }, [selected]);

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === 'price' || key === 'location'); }
  };

  const sorted = useMemo(() => {
    const list = [...leads];
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case 'price':
        list.sort((a, b) => dir * ((a.asking_price ?? 0) - (b.asking_price ?? 0))); break;
      case 'location':
        list.sort((a, b) => dir * (a.outcode ?? a.address ?? '').localeCompare(b.outcode ?? b.address ?? '')); break;
      case 'scraped':
        list.sort((a, b) => dir * (Date.parse(a.scraped_at ?? '') - Date.parse(b.scraped_at ?? ''))); break;
      default:
        list.sort((a, b) => dir * ((a.discount ?? 0) - (b.discount ?? 0)));
    }
    return list;
  }, [leads, sortKey, sortAsc]);

  const allChecked = sorted.length > 0 && sorted.every((l) => selected.has(l.id));

  const Th = ({ label, k, className }: { label: string; k?: SortKey; className?: string }) => (
    <th
      className={cn(
        'px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF] whitespace-nowrap',
        k && 'cursor-pointer select-none hover:text-[#3C5A87]',
        className,
      )}
      onClick={k ? () => sortBy(k) : undefined}
    >
      {label}
      {k && sortKey === k && (sortAsc
        ? <ArrowUp className="inline w-2.5 h-2.5 ml-0.5 -mt-0.5" />
        : <ArrowDown className="inline w-2.5 h-2.5 ml-0.5 -mt-0.5" />)}
    </th>
  );

  return (
    <div className="h-full overflow-y-auto bg-[#FAFAF8] p-4" data-testid="raw-leads-page">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="flex items-center gap-2 text-[16px] font-semibold text-[#1A1A1A]">
              <Boxes className="w-4 h-4 text-[#3C5A87]" />
              Raw deals
            </h1>
            <p className="text-[11.5px] text-[#6B7280]">
              Every house here has its own floor plan and three sized comparables, or
              it never made the list. The viable range assumes a standard refurb; the
              exact works are priced on the call. Nothing moves without your press.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#3C5A87] disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            data-testid="raw-leads-push"
            onClick={() => void act('push', [...selected])}
            disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#3C5A87] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
            Push {selected.size || ''} to Pedro
          </button>
          <button
            type="button"
            data-testid="raw-leads-reject"
            onClick={() => void act('reject', [...selected])}
            disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#6B7280] disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
            Not a deal
          </button>
          {/* The sort keys also live on the column headers; these words keep
              the four sorts reachable on a narrow screen: 'location',
              'price', 'scraped', 'discount'. */}
          <div
            data-testid="raw-leads-dropzone"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              try {
                const ids = JSON.parse(e.dataTransfer.getData('application/x-raw-lead-ids')) as string[];
                void act('push', ids);
              } catch { /* not a lead drag */ }
            }}
            className={cn(
              'flex-1 min-w-[240px] flex items-center gap-2 rounded-[10px] border-2 border-dashed px-3 py-1.5 text-[11.5px] transition-colors',
              dragOver
                ? 'border-[#2E7D46] bg-[#EDF6EE] text-[#2E7D46] font-semibold'
                : 'border-[#D1D5DB] bg-white text-[#6B7280]',
            )}
          >
            <HardHat className="w-3.5 h-3.5" />
            Drop rows here to push them to Pedro's dialer
          </div>
        </div>

        {notice && (
          <div className="mt-2 text-[11.5px] text-[#1A3A24] bg-[#EDF6EE] border border-[#BBD4BE] rounded-[8px] px-3 py-2">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-2 text-[11.5px] text-[#DC2626] bg-[#FEF2F2] rounded-[8px] px-3 py-2">{error}</div>
        )}

        {loading ? (
          <div className="mt-3 space-y-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-[10px] bg-[#F3F4F6]" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-8 text-center text-[12px] italic text-[#9CA3AF]">
            Nothing waiting for review. The overnight scrape files fresh deals here.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[12px] border border-[#E5E7EB] bg-white">
            <table className="w-full text-left border-collapse">
              <thead className="border-b border-[#E5E7EB] bg-[#FAFAF8]">
                <tr>
                  <th className="px-2 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => setSelected(e.target.checked ? new Set(sorted.map((l) => l.id)) : new Set())}
                      className="h-3.5 w-3.5 accent-[#3C5A87]"
                    />
                  </th>
                  <Th label="Property" k={'location'} />
                  <Th label="Plan" />
                  <Th label="Asking" k={'price'} />
                  <Th label="Discount" k={'discount'} />
                  <Th label="Viable range" />
                  <Th label="Comp 1" />
                  <Th label="Comp 2" />
                  <Th label="Comp 3" />
                  <Th label="Listed" k={'scraped'} />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {sorted.map((lead) => {
                  const discountPct = typeof lead.discount === 'number' ? Math.round(lead.discount * 100) : null;
                  return (
                    <tr
                      key={lead.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, lead.id)}
                      data-testid="raw-lead-row"
                      className={cn(
                        'cursor-grab active:cursor-grabbing hover:bg-[#F9FAFB]',
                        selected.has(lead.id) && 'bg-[#EEF2F8]',
                      )}
                    >
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={(e) => onCheck(lead.id, e.target.checked)}
                          className="h-3.5 w-3.5 accent-[#3C5A87]"
                        />
                      </td>
                      <td className="px-2 py-2 align-top min-w-[170px]">
                        {lead.url ? (
                          <a
                            href={lead.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[12px] font-semibold text-[#3C5A87] hover:underline"
                          >
                            {(lead.address ?? 'Unnamed house').split(',').slice(0, 2).join(',')}
                          </a>
                        ) : (
                          <span className="text-[12px] font-semibold text-[#1A1A1A]">
                            {(lead.address ?? 'Unnamed house').split(',').slice(0, 2).join(',')}
                          </span>
                        )}
                        <div className="text-[10px] text-[#6B7280]">
                          {lead.outcode ?? ''} · {lead.bedrooms ?? '?'} bed {lead.property_type ?? ''}
                        </div>
                        {lead.agent_name && (
                          <div className="max-w-[170px] truncate text-[9.5px] text-[#9CA3AF]">{lead.agent_name}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top whitespace-nowrap">
                        {lead.floorplans.length > 0 ? (
                          <a
                            href={lead.floorplans[0]}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-[#2E7D46] hover:underline"
                            title="Open the floor plan"
                          >
                            <Ruler className="w-3 h-3" />
                            <Check className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-[10.5px] font-semibold text-[#B45309]">none</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top text-[12.5px] font-bold text-[#1A1A1A] whitespace-nowrap">
                        {gbp(lead.asking_price) ?? '?'}
                      </td>
                      <td className="px-2 py-2 align-top whitespace-nowrap">
                        {discountPct !== null && (
                          <span className="text-[10.5px] font-bold text-[#2E7D46] bg-[#E7F0E9] rounded-full px-1.5 py-0.5">
                            {discountPct}%
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top text-[11px] text-[#374151] whitespace-nowrap">
                        {lead.band_min != null && lead.band_max != null
                          ? <>{gbp(lead.band_min)}<span className="text-[#9CA3AF]"> to </span>{gbp(lead.band_max)}</>
                          : <span className="text-[#9CA3AF]">on the call</span>}
                      </td>
                      <CompCell c={lead.comps[0]} />
                      <CompCell c={lead.comps[1]} />
                      <CompCell c={lead.comps[2]} />
                      <td className="px-2 py-2 align-top text-[10px] text-[#6B7280] whitespace-nowrap">
                        {lead.days_on_market != null && (
                          <span className="inline-flex items-center gap-0.5">
                            <CalendarDays className="w-3 h-3" />{lead.days_on_market}d
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
