// The ballpark, on one button, after call one.
//
// Hugo, 2026-08-15: "after the first call I should go and analyze myself and
// then have a button to fetch the ballpark ... the system hears the call ...
// and then we have the solid ballpark for a callback."
//
// This is the confirm-or-refuse screen for /api/crm/fetch-ballpark. It shows
// WHAT THE SYSTEM HEARD (the agent's own words) next to WHAT THE ENGINE SAYS
// (the band, the evidence, or its refusal), and nothing is written until the
// button at the bottom is pressed. The maths all happened on the engine; every
// figure on this screen is read, never derived.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';

interface InvestorCase {
  total_in?: number;
  sdlt?: number;
  refi_loan?: number;
  left_in?: number;
  bmv?: number | null;
  rent_pcm?: number | null;
  net_pcm?: number | null;
  roi?: number | null;
  gross_yield?: number | null;
  flags?: string[];
  gates?: { bmv_ok?: boolean; roi_ok?: boolean };
  sellable?: boolean;
}

interface ProjectCase {
  total_project_cost?: number;
  cash_in?: number;
  refi_loan?: number;
  left_in?: number;
  recycled_pct?: number | null;
  roi_on_capital_left?: number | null;
  arv_needed?: Record<string, number | null>;
  flags?: string[];
}

interface EngineAnswer {
  ok?: boolean;
  reason?: string;
  detail?: string;
  open?: number;
  ceiling?: number;
  ladder?: number[];
  gdv?: number;
  /** The works at the TRADE rate. This is the number that set the offer. */
  refurb?: number;
  /** The same works at Hugo's own crew rate: what the builder is handed as a
   *  budget. Deliberately a different number from the one above. */
  refurb_builder_budget?: number;
  refurb_band?: string;
  tmv?: number;
  asking?: number;
  comps_tier?: string;
  /** 'standard' = gold or strong (within 12 months). 'weaker' = the fair tier,
   *  same 400m and same three same-style sales, but out to 24 months. */
  evidence_strength?: string;
  /** A done-up sale the AGENT quoted on the call. Used only when it is LOWER
   *  than our own figure; recorded and ignored when higher. */
  agent_comp?: {
    price?: number; note?: string | null; engine_gdv?: number;
    gap_pct?: number; used?: boolean; why?: string;
  } | null;
  /** What the vendor has already refused: their floor. Never lifts our band. */
  rejected_offer?: {
    price?: number; above_our_ceiling?: boolean;
    gap_to_ceiling?: number; verdict?: string;
  } | null;
  comps_used?: number;
  gdv_basis?: string;
  condition_source?: string;
  why?: string;
  /** The ballpark's own fresh look at the house: every photo, plus the call. */
  deep?: {
    photos_read?: number;
    condition_band?: string;
    confidence?: string;
    works_needed?: string[];
    issues?: string[];
    error?: string;
    comparison?: {
      nightly?: { condition_band?: string; photos_read?: number } | null;
      band_gap?: number | null;
      disagrees?: boolean;
    };
  } | null;
  investor?: {
    at_open?: InvestorCase;
    at_ceiling?: InvestorCase;
    rent_needed_pcm?: number;
    rent_source?: string | null;
    rent_comps?: Array<{ address?: string; pcm?: number; bedrooms?: number | null; distance_m?: number | null }>;
    rent_area?: {
      pcm?: number; p25?: number; p75?: number; n?: number;
      outcode?: string; bedrooms?: number; evidence?: string;
    } | null;
    /** The full cost view: every fee, three scenarios, and what the house
     *  must be worth done up for the investor's money to come back. */
    project?: {
      conservative?: ProjectCase;
      base?: ProjectCase;
      optimistic?: ProjectCase;
      verdict?: { ok?: boolean; headline?: string; recycled_pct?: number };
    } | null;
  };
  evidence?: Array<{
    address?: string; price?: number; date?: string;
    distance_m?: number | string | null; floor_area_sqm?: number | string | null;
  }>;
}

interface FetchResult {
  ok?: boolean;
  applied?: boolean;
  reason?: string;
  detail?: string;
  error?: string;
  heard?: {
    condition_band: string;
    works_needed: string[];
    floor_area_sqm: number | null;
    heard: string[];
  };
  engine?: EngineAnswer;
}

const gbp = (n?: number | null) =>
  typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : '?';

async function callApi(propertyId: string, apply: boolean): Promise<FetchResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  const res = await fetch('/api/crm/fetch-ballpark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ propertyId, apply }),
  });
  return await res.json() as FetchResult;
}

export default function BallparkModal({ propertyId, address, onClose }: {
  propertyId: string;
  address?: string | null;
  onClose: () => void;
}) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [applying, setApplying] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    let live = true;
    setBusy(true);
    callApi(propertyId, false)
      .then((r) => { if (live) setResult(r); })
      .catch(() => { if (live) setResult({ error: 'Could not reach the server. Try again.' }); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [propertyId]);

  const apply = async () => {
    setApplying(true);
    try {
      const r = await callApi(propertyId, true);
      setResult(r);
      if (r.applied) {
        void qc.invalidateQueries({ queryKey: ['property-links'] });
        // The dialer room reads its card from this one. Without it, arming
        // from the room left the banner and the empty slots on screen until
        // a full reload (18 Aug, the room gained its own arm button).
        void qc.invalidateQueries({ queryKey: ['property-listings'] });
      }
    } catch {
      setResult({ error: 'Could not reach the server. Try again.' });
    } finally {
      setApplying(false);
    }
  };

  const heard = result?.heard;
  const engine = result?.engine;
  const refused = result && !result.error && (!result.ok || engine?.ok === false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-[#FDFCF7] rounded-[14px] shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] font-extrabold text-[#1F2937]">Fetch the ballpark</div>
        <div className="text-[11px] text-[#6B7280] mb-3">{address ?? 'this property'}</div>

        {busy && (
          <div className="text-[12px] text-[#6B7280] py-6 text-center">
            Hearing the call and asking the engine. Ten seconds or so.
          </div>
        )}

        {!busy && result?.error && (
          <div className="text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[8px] p-2">
            {result.error}
          </div>
        )}

        {!busy && heard && (
          <div className="mb-3">
            <div className="text-[11px] font-bold text-[#374151] mb-1">What the call said</div>
            <div className="text-[12px] text-[#1F2937]">
              Condition: <b>{heard.condition_band}</b>
              {engine?.condition_source === 'listing_photos' && (
                <span className="text-[#6B7280]"> (from the listing photos, the call did not establish it)</span>
              )}
              {heard.works_needed.length > 0 && <> · works: {heard.works_needed.join(', ')}</>}
              {heard.floor_area_sqm != null && <> · size stated: {heard.floor_area_sqm} sqm</>}
            </div>
            {heard.heard.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {heard.heard.map((q, i) => (
                  <li key={i} className="text-[11px] text-[#6B7280] italic">"{q}"</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!busy && refused && engine && (
          <div className="text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[8px] p-2">
            <b>No ballpark yet: {String(engine.reason ?? result?.reason ?? '')}.</b>{' '}
            {String(engine.detail ?? result?.detail ?? '')}
          </div>
        )}
        {!busy && !result?.error && !engine && result?.detail && (
          <div className="text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[8px] p-2">
            {result.detail}
          </div>
        )}

        {!busy && engine?.ok && (
          <div className="mb-3">
            <div className="text-[11px] font-bold text-[#374151] mb-1">The ballpark, course maths, engine computed</div>
            <div className="grid grid-cols-2 gap-1 text-[12px] text-[#1F2937]">
              <div className="bg-[#F3F7F0] rounded-[8px] p-2">Open at<br /><b className="text-[15px]">{gbp(engine.open)}</b></div>
              <div className="bg-[#FBEFEA] rounded-[8px] p-2">Never above<br /><b className="text-[15px]">{gbp(engine.ceiling)}</b></div>
            </div>
            <div className="text-[11px] text-[#6B7280] mt-1">
              Worth {gbp(engine.gdv)} done up, works {gbp(engine.refurb)} at the trade rate ({engine.refurb_band}),
              {' '}{engine.comps_used} sold comps, {engine.comps_tier} evidence. Asking {gbp(engine.asking)}.
            </div>
            {/* The two refurb figures do different jobs and must never be read
                as one. The offer is priced on the trade rate; the crew rate is
                the budget the builder is given. Showing only one of them is how
                a builder ends up quoting against the number we offered on. */}
            {engine.refurb_builder_budget != null && (
              <div className="text-[11px] text-[#1F2937] mt-1 bg-[#F6F7F9] border border-[#E5E7EB] rounded-[8px] p-2">
                Offer priced on <b>{gbp(engine.refurb)}</b> of work.
                {' '}Builder's budget: <b>{gbp(engine.refurb_builder_budget)}</b>.
                <span className="text-[#6B7280]"> The gap is our cushion, not a saving to give away.</span>
              </div>
            )}
            {engine.evidence_strength === 'weaker' && (
              <div className="text-[11px] text-[#92400E] mt-1 bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[8px] p-2">
                Weaker evidence: the three sold comparables are within 400 metres
                but older than a year. The band is right on what we know, and
                what we know is thinner than usual.
              </div>
            )}

            {/* What the agent said that the desk could not know, and what the
                engine did with it. Shown either way, so a figure that moved has
                a visible cause and a figure that did not move is not silently
                discarded. */}
            {engine.agent_comp && (
              <div className={`text-[11px] mt-1 rounded-[8px] p-2 border ${engine.agent_comp.used ? 'bg-[#F3F7F0] border-[#2E7D43]/30 text-[#1F2937]' : 'bg-[#FFFBEB] border-[#F59E0B]/40 text-[#92400E]'}`}>
                <b>The agent's own done-up sale: {gbp(engine.agent_comp.price)}</b>
                {engine.agent_comp.note && <span className="text-[#6B7280]"> ({engine.agent_comp.note})</span>}
                <div className="mt-0.5">{engine.agent_comp.why}</div>
              </div>
            )}
            {engine.rejected_offer && (
              <div className={`text-[11px] mt-1 rounded-[8px] p-2 border ${engine.rejected_offer.above_our_ceiling ? 'bg-[#FBEFEA] border-[#DC2626]/40 text-[#7F1D1D]' : 'bg-[#F3F7F0] border-[#2E7D43]/30 text-[#1F2937]'}`}>
                <b>They already turned down {gbp(engine.rejected_offer.price)}.</b>
                <div className="mt-0.5">{engine.rejected_offer.verdict}</div>
              </div>
            )}
            {engine.why && <div className="text-[11px] text-[#374151] mt-1">{engine.why}</div>}

            {/* What the fresh look at every photograph found. */}
            {engine.deep?.photos_read != null && (
              <div className={`mt-2 rounded-[8px] p-2 border ${engine.deep.comparison?.disagrees ? 'bg-[#FFFBEB] border-[#F59E0B]/40' : 'bg-[#F6F7F9] border-[#E5E7EB]'}`}>
                <div className="text-[11px] font-bold text-[#374151]">
                  Fresh look at the house: {engine.deep.photos_read} photos read
                  {engine.deep.comparison?.nightly?.photos_read != null && (
                    <span className="font-normal text-[#6B7280]"> (the overnight scan saw {engine.deep.comparison.nightly.photos_read})</span>
                  )}
                </div>
                <div className="text-[11px] text-[#1F2937]">
                  Condition <b>{engine.deep.condition_band}</b>
                  {engine.deep.confidence && <> ({engine.deep.confidence} confidence)</>}
                  {(engine.deep.works_needed?.length ?? 0) > 0 && (
                    <> · works seen: {engine.deep.works_needed!.join(', ')}</>
                  )}
                </div>
                {(engine.deep.issues?.length ?? 0) > 0 && (
                  <div className="text-[11px] text-[#B45309]">Flagged: {engine.deep.issues!.join(', ')}</div>
                )}
                {engine.deep.comparison?.disagrees && (
                  <div className="text-[11px] text-[#B45309] mt-0.5">
                    This disagrees with the overnight read ({engine.deep.comparison.nightly?.condition_band}).
                    Two readings this far apart mean nobody understands this house yet. Treat the figure with care.
                  </div>
                )}
              </div>
            )}

            {/* The whole evidence pack, on the screen. Hugo 2026-08-15: "it
                should bring all the comparables as well ... so we know
                everything is there and then all you have to do is the second
                call." */}
            {(engine.evidence?.length ?? 0) > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-bold text-[#374151] mb-0.5">Sold nearby, the evidence</div>
                <ul className="space-y-0.5">
                  {engine.evidence!.map((c, i) => (
                    <li key={i} className="text-[11px] text-[#374151]">
                      {String(c.address ?? '').split(',')[0]} went for <b>{gbp(Number(c.price))}</b>
                      {c.floor_area_sqm ? ` · ${c.floor_area_sqm} sqm` : ''}
                      {c.distance_m != null ? ` · ${Math.round(Number(c.distance_m))}m away` : ''}
                      {c.date ? ` · ${String(c.date).slice(0, 7)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Hugo 2026-08-15: "when we are fetching the ballpark, that is
                where the investor return has to be calculated, because that
                is how we decide if we move forward or not." Same maths as the
                course's BRR sheet, computed on the engine, read here. */}
            {engine.investor?.at_open && (() => {
              const o = engine.investor.at_open!;
              const c = engine.investor.at_ceiling;
              const noRent = (o.flags ?? []).includes('no_rent_evidence');
              const pct = (v?: number | null) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '?');
              const good = !noRent && o.gates?.roi_ok === true;
              return (
                <div className={`mt-2 rounded-[8px] p-2 border ${good ? 'bg-[#F0FDF4] border-[#16A34A]/30' : 'bg-[#FFFBEB] border-[#F59E0B]/40'}`}>
                  <div className="text-[11px] font-bold text-[#374151] mb-0.5">The investor's case (BRR sheet, all buying costs in)</div>
                  <div className="text-[11px] text-[#1F2937]">
                    At our opener: all-in {gbp(o.total_in)}, refinance {gbp(o.refi_loan)},
                    {' '}<b>money left in {gbp(o.left_in)}</b>
                    {typeof o.roi === 'number' && <> · ROI {pct(o.roi)}{o.gates?.roi_ok ? ' (clears 20%)' : ' (below the 20% gate)'}</>}
                    {(o.left_in ?? 1) <= 0 && <> · all the money comes back out</>}
                  </div>
                  {c && (
                    <div className="text-[11px] text-[#6B7280]">
                      At our ceiling: money left in {gbp(c.left_in)}{typeof c.roi === 'number' && <> · ROI {pct(c.roi)}</>}
                    </div>
                  )}
                  {noRent && (
                    <div className="text-[11px] text-[#B45309] mt-0.5">
                      To clear the investor's 20% return at our opener the house must let for
                      {' '}<b>{gbp(engine.investor?.rent_needed_pcm)} a month</b>.
                    </div>
                  )}
                  {!noRent && typeof o.rent_pcm === 'number' && (
                    <div className="text-[11px] text-[#6B7280] mt-0.5">
                      Rent used: <b>{gbp(o.rent_pcm)} a month</b>
                      {engine.investor?.rent_source === 'stated_on_call'
                        ? ', the agent\'s own figure from the call.'
                        : engine.investor?.rent_source === 'area_model' && engine.investor.rent_area
                          ? `, the ${engine.investor.rent_area.outcode} going rate for a ${engine.investor.rent_area.bedrooms} bed (${engine.investor.rent_area.n} live to-rent listings, ${gbp(engine.investor.rent_area.p25)} to ${gbp(engine.investor.rent_area.p75)}). Confirm on the call.`
                          : ', the median of nearby lets at the same bedroom count.'}
                    </div>
                  )}
                  {/* Does the money come back out? Every fee counted, three
                      scenarios, judged on the conservative one. */}
                  {engine.investor?.project?.verdict && (() => {
                    const p = engine.investor!.project!;
                    const pct = (v?: number | null) =>
                      typeof v === 'number' ? `${Math.round(v * 100)}%` : '?';
                    return (
                      <div className="mt-1.5 pt-1.5 border-t border-[#00000014]">
                        <div className="text-[11px] font-bold text-[#374151]">
                          Does the money come back? {p.verdict!.headline}
                        </div>
                        <div className="text-[11px] text-[#374151]">
                          Full cost, every fee in: <b>{gbp(p.base?.total_project_cost)}</b>.
                          {' '}Worst case {pct(p.conservative?.recycled_pct)} back
                          ({gbp(p.conservative?.left_in)} stays in) ·
                          {' '}likely {pct(p.base?.recycled_pct)} ({gbp(p.base?.left_in)} in) ·
                          {' '}best {pct(p.optimistic?.recycled_pct)} ({gbp(p.optimistic?.left_in)} in).
                        </div>
                        {p.base?.arv_needed && (
                          <div className="text-[11px] text-[#6B7280]">
                            To get it all back it must be worth <b>{gbp(p.base.arv_needed['100'])}</b> done up
                            {' '}(90% back: {gbp(p.base.arv_needed['90'])} · 75% back: {gbp(p.base.arv_needed['75'])}).
                            {' '}We value it at {gbp(engine.gdv)}.
                          </div>
                        )}
                        {(p.conservative?.flags ?? []).includes('fails_lender_rent_cover') && (
                          <div className="text-[11px] text-[#B45309]">
                            Warning: the rent fails a lender's 125% stress test, so the refinance may not be offered.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {(engine.investor?.rent_comps?.length ?? 0) > 0 && (
                    <div className="text-[11px] text-[#374151] mt-0.5">
                      Letting nearby:{' '}
                      {engine.investor!.rent_comps!.map((c) =>
                        `${String(c.address ?? '').split(',')[0]} ${gbp(c.pcm)} (${c.bedrooms ?? '?'} bed, ${Math.round(Number(c.distance_m ?? 0))}m)`,
                      ).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {!busy && result?.applied && (
          <div className="text-[12px] text-[#166534] bg-[#F0FDF4] border border-[#16A34A]/30 rounded-[8px] p-2 mb-2">
            Call two is armed. The band is on the card, the step is Offer call, and the board card moved to Ready for call 2.
          </div>
        )}

        <div className="flex gap-2 mt-2">
          {engine?.ok && !result?.applied && (
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying}
              className="flex-1 px-3 py-2 rounded-[8px] text-[12px] font-bold bg-[#3C5A87] text-white hover:bg-[#31486D] disabled:opacity-50"
            >
              {applying ? 'Arming call two...' : 'Confirm: arm call two with this band'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-[8px] text-[12px] font-semibold bg-[#EEEDE6] text-[#374151] hover:bg-[#E2E1D8]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
