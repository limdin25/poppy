// Find builders. Pedro's desk for getting somebody to walk a house.
//
// Hugo, 2026-08-24: "we select the property and then he finds builders in the
// area ... and then he can click and say send message and then it shows the
// opener message ... we see the log, we see everything, how many numbers for
// that property. We have to be very user friendly."
//
// WHY THIS IS A PAGE AND NOT A PIPELINE TAB. The pipeline is a kanban board of
// dense chip stacks; a picker, sub-tabs, a builder table and a log turn it into
// a different screen. The cockpit's BuilderOutreachPanel stays exactly where it
// is as the per-deal quick desk. This is the cross-property one.
//
// NOT ADMIN GATED, on purpose. Every builder route before this was gated on the
// admin_users table, which meant the panel was silently blank for Pedro, the
// only person who does this job. This page and api/crm/find-builders.ts use the
// same agent-or-admin gate as the rest of his presses. Only the settings
// sub-tab stays admin-only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, HardHat, Loader2, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import PropertyPicker, { type PickerProperty } from '../components/builders/PropertyPicker';
import HouseNumberBar from '../components/builders/HouseNumberBar';
import BuilderTable, { type BuilderRow } from '../components/builders/BuilderTable';
import SendReviewDialog from '../components/builders/SendReviewDialog';

interface HouseDetail extends PickerProperty {
  builderFacingAddress: string;
  viewingAddress: string | null;
  viewingNotes: string | null;
  assignedBuilderId: string | null;
  scrapedAt: string | null;
  radiusM: number | null;
}

interface LogLine { text: string }

interface Bundle {
  property: HouseDetail;
  blockedReason: string | null;
  builders: BuilderRow[];
  sentToday: number;
  nextRadiusM: number | null;
  settings: { radius_m: number; max_new_builders: number; daily_cap: number; auto_send: boolean; invite_sid: string };
}

/** The block codes the server returns, in words a person can act on. Same
 *  vocabulary as the cockpit panel so the two screens never disagree. */
const BLOCKED_WORDS: Record<string, string> = {
  floor_above_ceiling: 'The vendor has turned down more than our ceiling, so this house is not worth a builder yet.',
  below_discount_rule: 'This house is not far enough under its own street to be worth a builder an afternoon.',
  not_proven_a_deal: 'Nothing proves this is a deal yet, so no builder can be invited.',
  no_viewing_time: 'No viewing time on this house yet. Book the time first and the invites unlock.',
  template_pending: 'The WhatsApp opener is not approved by Meta yet, so nothing can send.',
};

export default function FindBuildersPage() {
  const [params, setParams] = useSearchParams();
  const propertyId = params.get('propertyId');

  const [properties, setProperties] = useState<PickerProperty[]>([]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHouse, setLoadingHouse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [lastLog, setLastLog] = useState<LogLine[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  /** Reads the body as text first: a scrape press can take twenty seconds and a
   *  gateway timeout answers HTML, which JSON.parse turns into a baffling
   *  "Unexpected token A". Copied from RawLeadsPage for exactly that reason. */
  const call = useCallback(async (path: string, init?: RequestInit) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('Not signed in');
    const res = await fetch(path, {
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

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await call('/api/crm/find-builders');
      setProperties((json.properties ?? []) as PickerProperty[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the houses.');
    } finally {
      setLoading(false);
    }
  }, [call]);

  const loadHouse = useCallback(async (id: string) => {
    setLoadingHouse(true);
    try {
      const json = await call(`/api/crm/find-builders?property_id=${encodeURIComponent(id)}`);
      setBundle(json as unknown as Bundle);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that house.');
      setBundle(null);
    } finally {
      setLoadingHouse(false);
    }
  }, [call]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    if (propertyId) void loadHouse(propertyId);
    else setBundle(null);
  }, [propertyId, loadHouse]);

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('propertyId', id);
    setParams(next, { replace: true });
    setSelected(new Set());
    setLastLog([]);
    setNotice(null);
  };

  const findBuilders = async (action: 'scrape' | 'widen') => {
    if (!propertyId || searching) return;
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const json = await call('/api/crm/find-builders', {
        method: 'POST',
        body: JSON.stringify({ action, property_id: propertyId }),
      });
      setLastLog((json.log ?? []) as LogLine[]);
      if (json.message) setNotice(String(json.message));
      await Promise.all([loadHouse(propertyId), loadList()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The search did not run.');
    } finally {
      setSearching(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleAll = (on: boolean) => {
    const pickable = (bundle?.builders ?? []).filter((b) => b.isMobile && !b.status).map((b) => b.id);
    setSelected(on ? new Set(pickable) : new Set());
  };

  const send = async (contentSid: string, vars: Record<string, string>) => {
    if (!propertyId) return;
    setError(null);
    try {
      const json = await call('/api/crm/find-builders', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send', property_id: propertyId,
          builder_ids: [...selected], content_sid: contentSid, content_variables: vars,
        }),
      });
      const failed = ((json.results ?? []) as Array<{ name: string; ok: boolean; error?: string }>)
        .filter((r) => !r.ok);
      setNotice(String(json.message ?? 'Sent.'));
      if (failed.length) {
        setError(failed.map((f) => `${f.name}: ${f.error ?? 'did not send'}`).join('. '));
      }
      setReviewOpen(false);
      setSelected(new Set());
      await Promise.all([loadHouse(propertyId), loadList()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was sent.');
    }
  };

  const recipients = useMemo(
    () => (bundle?.builders ?? [])
      .filter((b) => selected.has(b.id))
      .map((b) => ({ id: b.id, name: b.name, phone: b.phone })),
    [bundle, selected],
  );

  const saveHouseNumber = async (typed: string) => {
    if (!propertyId) return;
    setNotice(null);
    try {
      const json = await call('/api/crm/find-builders', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_house_number', property_id: propertyId, number: typed }),
      });
      setNotice(String(json.message ?? 'Saved.'));
      await Promise.all([loadHouse(propertyId), loadList()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the house number.');
    }
  };

  const missingNumbers = useMemo(
    () => properties.filter((p) => !p.houseNumberKnown && p.invited > 0).length,
    [properties],
  );

  return (
    <div className="h-full overflow-y-auto bg-[#FAFAF8] p-4" data-testid="find-builders-page">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-1.5 text-[16px] font-semibold text-[#1A1A1A]">
              <HardHat className="h-4 w-4 text-[#3C5A87]" /> Find builders
            </h1>
            <p className="mt-0.5 text-[11.5px] text-[#6B7280]">
              Pick a house, find builders near it, read the message, then send.
            </p>
          </div>
          <button
            onClick={() => { void loadList(); if (propertyId) void loadHouse(propertyId); }}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#6B7280] hover:bg-[#F9FAFB]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {missingNumbers > 0 ? (
          <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-[#DC2626]/40 bg-[#FEF2F2] px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-[#DC2626]" />
            <span className="text-[11.5px] text-[#DC2626]">
              {missingNumbers} {missingNumbers === 1 ? 'house has' : 'houses have'} builders invited and no house
              number, so nobody can be told where to go.
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 rounded-[10px] border border-[#DC2626]/40 bg-[#FEF2F2] px-3 py-2 text-[11.5px] text-[#DC2626]">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mb-3 rounded-[10px] border border-[#BBD4BE] bg-[#EDF6EE] px-3 py-2 text-[11.5px] text-[#2E7D46]">
            {notice}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-[12px] border border-[#E5E7EB] bg-white">
            <div className="border-b border-[#E5E7EB] bg-[#FAFAF8] px-3 py-2 text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">
              Houses with a viewing
            </div>
            {loading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-[10px] bg-[#F3F4F6]" />)}
              </div>
            ) : (
              <PropertyPicker properties={properties} selectedId={propertyId} onSelect={select} />
            )}
          </div>

          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-3">
            {!propertyId ? (
              <p className="py-10 text-center text-[12px] italic text-[#9CA3AF]">
                Pick a house on the left to see who can walk it.
              </p>
            ) : loadingHouse && !bundle ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-[10px] bg-[#F3F4F6]" />)}
              </div>
            ) : bundle ? (
              <div className="space-y-3">
                <div>
                  <h2 className="text-[13.5px] font-semibold text-[#1A1A1A]">{bundle.property.address}</h2>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    {bundle.property.viewingLabel ?? 'No viewing time booked yet'}
                  </p>
                </div>

                <HouseNumberBar
                  known={bundle.property.houseNumberKnown}
                  facingAddress={bundle.property.builderFacingAddress}
                  streetAddress={bundle.property.address}
                  onSave={saveHouseNumber}
                />

                {bundle.blockedReason ? (
                  <div className="rounded-[10px] border border-[#F59E0B] bg-[#FFFBEB] px-3 py-2 text-[11.5px] text-[#B45309]">
                    {BLOCKED_WORDS[bundle.blockedReason] ?? bundle.blockedReason}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3 rounded-[10px] bg-[#FAFAF8] px-3 py-2 text-[11.5px] text-[#374151]">
                  <Stat n={bundle.property.coveringCount} label={`builders cover ${bundle.property.outcode ?? 'this area'}`} />
                  <Stat n={bundle.property.mobileCount} label="can be messaged" />
                  <Stat n={bundle.property.invited} label="invited" />
                  <Stat n={bundle.property.replied} label="replied" />
                  <Stat n={bundle.property.confirmed} label="confirmed" tone={bundle.property.confirmed ? 'good' : undefined} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    data-testid="find-builders-scrape"
                    onClick={() => void findBuilders(bundle.property.scrapedAt ? 'widen' : 'scrape')}
                    disabled={searching}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#3C5A87] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-40"
                  >
                    {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    {bundle.property.scrapedAt ? 'Find more, go out a ring' : 'Find builders near this house'}
                  </button>
                  {bundle.property.scrapedAt ? (
                    <span className="text-[10.5px] text-[#6B7280]">
                      Last searched {bundle.property.radiusM ? `${Math.round(bundle.property.radiusM / 1000)}km` : ''} around{' '}
                      {bundle.property.outcode ?? 'this area'}
                      {bundle.nextRadiusM
                        ? `. Next ring is ${Math.round(bundle.nextRadiusM / 1000)}km.`
                        : '. That is as far as we go.'}
                    </span>
                  ) : null}
                </div>

                {lastLog.length ? (
                  <ul
                    data-testid="find-builders-log"
                    className="space-y-0.5 rounded-[10px] border border-[#E5E7EB] bg-[#FAFAF8] px-3 py-2"
                  >
                    {lastLog.map((l, i) => (
                      <li key={i} className="text-[11px] text-[#374151]">{l.text}</li>
                    ))}
                  </ul>
                ) : null}

                <BuilderTable
                  builders={bundle.builders}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    data-testid="find-builders-send"
                    disabled={!selected.size}
                    onClick={() => setReviewOpen(true)}
                    className="rounded-[8px] bg-[#2E7D46] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-40"
                  >
                    Write to {selected.size || ''} builder{selected.size === 1 ? '' : 's'}
                  </button>
                  <span className="text-[10.5px] text-[#6B7280]">
                    {bundle.sentToday} of {bundle.settings.daily_cap} sent today
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {bundle ? (
        <SendReviewDialog
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          recipients={recipients}
          facts={{
            address: bundle.property.builderFacingAddress,
            viewingTime: bundle.property.viewingLabel ?? '',
            sender: 'Pedro',
          }}
          houseNumberKnown={bundle.property.houseNumberKnown}
          blockedReason={bundle.blockedReason}
          sentToday={bundle.sentToday}
          dailyCap={bundle.settings.daily_cap}
          onSend={send}
        />
      ) : null}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'good' }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <strong className={cn('text-[13px] font-bold tabular-nums', tone === 'good' ? 'text-[#2E7D46]' : 'text-[#1A1A1A]')}>{n}</strong>
      <span className="text-[10.5px] text-[#6B7280]">{label}</span>
    </span>
  );
}
