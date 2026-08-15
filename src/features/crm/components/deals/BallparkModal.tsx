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

interface EngineAnswer {
  ok?: boolean;
  reason?: string;
  detail?: string;
  open?: number;
  ceiling?: number;
  ladder?: number[];
  gdv?: number;
  refurb?: number;
  refurb_band?: string;
  tmv?: number;
  asking?: number;
  comps_tier?: string;
  comps_used?: number;
  gdv_basis?: string;
  condition_source?: string;
  why?: string;
  investor?: {
    at_open?: InvestorCase;
    at_ceiling?: InvestorCase;
    rent_needed_pcm?: number;
  };
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
      if (r.applied) void qc.invalidateQueries({ queryKey: ['property-links'] });
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
              Worth {gbp(engine.gdv)} done up, works {gbp(engine.refurb)} at the low end ({engine.refurb_band}),
              {' '}{engine.comps_used} sold comps, {engine.comps_tier} evidence. Asking {gbp(engine.asking)}.
            </div>
            {engine.why && <div className="text-[11px] text-[#374151] mt-1">{engine.why}</div>}

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
                      No rent evidence from the call. To clear the investor's 20% return at our opener the house must let for
                      {' '}<b>{gbp(engine.investor?.rent_needed_pcm)} a month</b>. Check what similar houses let for before call two.
                    </div>
                  )}
                  {!noRent && typeof o.rent_pcm === 'number' && (
                    <div className="text-[11px] text-[#6B7280] mt-0.5">Rent used: {gbp(o.rent_pcm)} a month, the agent's own figure from the call.</div>
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
