// The raw data command center. Everything the scraper finds lands here
// FIRST; only a press on this page moves a lead into Pedro's dialer.
//
// Hugo, 2026-08-19: "the raw data page isn't just a list, it's a command
// center. Multi-select and drag and drop so Hugo can manually approve and
// push specific deals directly to the Pedro dialer. Full sorting by
// location, price, and scrape date. For every lead: asking price, three
// distinct comparables with their specific prices and distances, any
// available floor plans, the initial discount right out of the gate, and
// a ballpark range minimum to maximum. Maintenance calculations stay tied
// to the live call."
//
// Every figure on this page is READ from wk_raw_leads, which the engine's
// nightly export fills. Nothing here computes money. The push flips the
// already-written review queue rows to pending (api/crm/raw-leads.ts), so
// approving a deal cannot half-create anything.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, RefreshCw, ArrowUpDown, HardHat, ChevronDown, ChevronRight,
  MapPin, CalendarDays, Ruler, X, Radio, Loader2,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';

interface CompRow { price?: number; distance_m?: number; date?: string; address?: string }

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

function LeadRow({ lead, checked, onCheck, onDragStart }: {
  lead: RawLead;
  checked: boolean;
  onCheck: (id: string, on: boolean) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const discountPct = typeof lead.discount === 'number' ? Math.round(lead.discount * 100) : null;
  return (
    <li
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      data-testid="raw-lead-row"
      className={cn(
        'bg-white border border-[#E5E7EB] rounded-[12px] px-3 py-2.5 cursor-grab active:cursor-grabbing',
        checked && 'ring-1 ring-[#3C5A87]/50 border-[#3C5A87]/50',
      )}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(lead.id, e.target.checked)}
          className="mt-1 h-3.5 w-3.5 accent-[#3C5A87]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[#1A1A1A] truncate">
              {lead.address ?? 'Unnamed house'}
            </span>
            {lead.outcode && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#6B7280]">
                <MapPin className="w-2.5 h-2.5" />{lead.outcode}
              </span>
            )}
            {discountPct !== null && (
              <span className="text-[10.5px] font-bold text-[#2E7D46] bg-[#E7F0E9] rounded-full px-2 py-0.5">
                {discountPct}% below sold prices
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 flex-wrap text-[11.5px] text-[#374151]">
            <span>Asking <b className="text-[#1A1A1A]">{gbp(lead.asking_price) ?? '?'}</b></span>
            {lead.band_min != null && lead.band_max != null && (
              <span>
                Viable <b>{gbp(lead.band_min)}</b> to <b>{gbp(lead.band_max)}</b>
                <span className="text-[#9CA3AF]"> (works are priced on the call)</span>
              </span>
            )}
            {lead.bedrooms != null && <span>{lead.bedrooms} bed {lead.property_type ?? ''}</span>}
            {lead.days_on_market != null && (
              <span className="inline-flex items-center gap-0.5 text-[#6B7280]">
                <CalendarDays className="w-3 h-3" />{lead.days_on_market}d listed
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#3C5A87]"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {lead.comps.length} sold comparables
            {lead.floorplans.length > 0 && ` · ${lead.floorplans.length} floor plan${lead.floorplans.length > 1 ? 's' : ''}`}
          </button>
          {open && (
            <div className="mt-1.5 border-t border-[#F3F4F6] pt-1.5 space-y-1">
              {lead.comps.slice(0, 3).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-[#374151]">
                  <Ruler className="w-3 h-3 text-[#9CA3AF] flex-shrink-0" />
                  <b>{gbp(c.price) ?? '?'}</b>
                  {typeof c.distance_m === 'number' && <span>{c.distance_m}m away</span>}
                  {c.date && <span className="text-[#6B7280]">{c.date}</span>}
                  {c.address && <span className="truncate text-[#6B7280]">{c.address}</span>}
                </div>
              ))}
              <div className="flex items-center gap-2 flex-wrap">
                {lead.floorplans.slice(0, 2).map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10.5px] font-semibold text-[#3C5A87] underline"
                  >
                    Floor plan {i + 1}
                  </a>
                ))}
                {lead.url && (
                  <a href={lead.url} target="_blank" rel="noreferrer" className="text-[10.5px] text-[#6B7280] underline">
                    Listing
                  </a>
                )}
                {lead.agent_name && <span className="text-[10px] text-[#9CA3AF]">{lead.agent_name}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function RawLeadsPage() {
  const [leads, setLeads] = useState<RawLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('discount');
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

  const sorted = useMemo(() => {
    const list = [...leads];
    switch (sortKey) {
      case 'price':
        list.sort((a, b) => (a.asking_price ?? 0) - (b.asking_price ?? 0)); break;
      case 'location':
        list.sort((a, b) => (a.outcode ?? a.address ?? '').localeCompare(b.outcode ?? b.address ?? '')); break;
      case 'scraped':
        list.sort((a, b) => Date.parse(b.scraped_at ?? '') - Date.parse(a.scraped_at ?? '')); break;
      default:
        list.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0));
    }
    return list;
  }, [leads, sortKey]);

  const allChecked = sorted.length > 0 && sorted.every((l) => selected.has(l.id));

  return (
    <div className="h-full overflow-y-auto bg-[#FAFAF8] p-4" data-testid="raw-leads-page">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="flex items-center gap-2 text-[16px] font-semibold text-[#1A1A1A]">
              <Boxes className="w-4 h-4 text-[#3C5A87]" />
              Raw deals
            </h1>
            <p className="text-[11.5px] text-[#6B7280]">
              Everything the scraper qualified, before anyone dials. Tick or drag the
              ones worth calling onto Pedro's dialer. Nothing moves without your press.
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

        {/* The controls: sort, select-all, the two presses, and the drop zone. */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[#374151] bg-white border border-[#E5E7EB] rounded-[8px] px-2 py-1.5">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => setSelected(e.target.checked ? new Set(sorted.map((l) => l.id)) : new Set())}
              className="h-3.5 w-3.5 accent-[#3C5A87]"
            />
            All ({sorted.length})
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-[#374151] bg-white border border-[#E5E7EB] rounded-[8px] px-2 py-1.5">
            <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-transparent outline-none"
            >
              <option value={'discount'}>Deepest discount</option>
              <option value={'price'}>Price, low to high</option>
              <option value={'location'}>Location</option>
              <option value={'scraped'}>Scrape date, newest</option>
            </select>
          </label>
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
        </div>

        {/* The drop zone: Pedro's dialer. */}
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
            'mt-3 flex items-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-3 text-[12px] transition-colors',
            dragOver
              ? 'border-[#2E7D46] bg-[#EDF6EE] text-[#2E7D46] font-semibold'
              : 'border-[#D1D5DB] bg-white text-[#6B7280]',
          )}
        >
          <HardHat className="w-4 h-4" />
          Drop deals here to push them to Pedro's dialer
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
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-[12px] bg-[#F3F4F6]" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-8 text-center text-[12px] italic text-[#9CA3AF]">
            Nothing waiting for review. The overnight scrape files fresh deals here.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {sorted.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                checked={selected.has(lead.id)}
                onCheck={onCheck}
                onDragStart={onDragStart}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
