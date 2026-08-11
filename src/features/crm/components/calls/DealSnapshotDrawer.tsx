// The complete deal behind a call, one click from Call history.
//
// Hugo, 2026-08-11: "when we're looking at call history, we aren't just
// seeing the property link. We need to see the full deal, the ballpark
// numbers, and the whole calculator breakdown, exactly how it looks before
// it goes to Pedro. No more flying blind after the call is made."
//
// Three sections, top to bottom:
//   1. What this call was: status, duration, when, who rang, the agent's own
//      note, the logged property outcome, and the pipeline stage now.
//   2. The deal as Pedro saw it: the same OfferStrip that is pinned above his
//      script, the same facts, sold evidence and warnings as the Houses tab.
//      Reads usePropertyListings off the branch phone, so it is always the
//      numbers as they stand, refreshed by the same engine that wrote them.
//   3. Hugo's calculator (admins only): computeDeal over the engine's own
//      figures, the same sums as the admin Properties drawer. Gated because
//      the partner split and the cash position are the director's business,
//      not the caller's; the dialer itself stays clean of this maths.
import { useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { gbpShort } from '../../../../../api/lib/brrr-offer';
import { computeDeal, money } from '@/core/lib/dealMaths';
import { useAuth } from '../../lib/useCrmAuth';
import { usePropertyListings } from '../../hooks/usePropertyListings';
import type { PropertyListing } from '../../hooks/usePropertyListings';
import OfferStrip from '../live-call/OfferStrip';
import { formatDuration } from '../../data/helpers';
import type { CallRecord, Contact } from '../../types';

interface Props {
  contact: Contact | null;
  call: CallRecord | null;
  agentName?: string;
  stageName?: string;
  onClose: () => void;
}

function numOf(v: unknown): number {
  const o = typeof v === 'object' && v !== null
    ? (v as Record<string, unknown>).estimate
    : v;
  const n = Number(o);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function DealSnapshotDrawer({ contact, call, agentName, stageName, onClose }: Props) {
  const { isAdmin } = useAuth();
  // Withdrawn deals INCLUDED here, and only here. A branch Pedro has already
  // rung must never go blank because the auditor later pulled its only deal:
  // that is the flying-blind this panel exists to end. The dialer calls the
  // same hook without this flag, so he can never quote a withdrawn figure.
  const { listings, loading } = usePropertyListings(contact?.phone, { includeWithdrawn: true });
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected: PropertyListing | null = useMemo(() => {
    if (listings.length === 0) return null;
    return listings.find((l) => l.id === pickedId) ?? listings[0];
  }, [listings, pickedId]);

  const deal = (selected?.deal ?? {}) as Record<string, unknown>;
  const cmv = numOf(deal.cmv);
  const rent = numOf(deal.rent);
  const stack = (deal.stack && typeof deal.stack === 'object')
    ? deal.stack as Record<string, unknown> : null;
  const qual = (selected?.qualification && typeof selected.qualification === 'object')
    ? selected.qualification as Record<string, unknown> : null;

  // Hugo's sums, off the engine's own numbers: buy at the walk-away, worth is
  // today's sold-comps value, refurb is the bedroom-conversion budget. Same
  // defaults as the admin Properties drawer.
  const sums = useMemo(() => {
    if (!selected || !selected.offerMax || !cmv) return null;
    return computeDeal({
      purchase: selected.offerMax,
      marketValue: cmv,
      refurb: selected.upliftRefurbBudget || 15_000,
      rentPcm: rent,
      termMonths: 9,
    });
  }, [selected, cmv, rent]);

  if (!contact || !call) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-[440px] max-w-full flex-col overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="deal-snapshot-drawer"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#E5E7EB] px-4 py-3">
          <div>
            <div className="text-[15px] font-bold text-[#1A1A1A]">{contact.name || 'Estate agent'}</div>
            <div className="text-[11px] tabular-nums text-[#6B7280]">{contact.phone}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[#9CA3AF] hover:bg-[#F3F3EE] hover:text-[#1A1A1A]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 1. This call */}
        <div className="border-b border-[#E5E7EB] bg-[#FAFAF8] px-4 py-2.5 text-[12px] text-[#4B5563]">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#8A9AAB]">This call</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="capitalize">{call.direction} · {call.status}</span>
            {call.durationSec > 0 && <span>{formatDuration(call.durationSec)}</span>}
            <span>
              {new Date(call.startedAt).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </span>
            {agentName && <span>by {agentName}</span>}
            {stageName && <span>stage: <b>{stageName}</b></span>}
          </div>
          {call.agentNote && (
            <div className="mt-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11.5px] italic">
              "{call.agentNote}"
            </div>
          )}
          {qual?.outcome ? (
            <div className="mt-1 text-[11.5px]">
              Logged outcome: <b className="capitalize">{String(qual.outcome).replace(/_/g, ' ')}</b>
              {qual.next_step ? <> → {String(qual.next_step).replace(/_/g, ' ')}</> : null}
            </div>
          ) : null}
        </div>

        {/* 2. The deal as Pedro saw it */}
        {loading ? (
          <div className="px-4 py-6 text-[12px] text-[#9CA3AF]">Loading the deal…</div>
        ) : !selected ? (
          <div className="px-4 py-6 text-[12px] text-[#9CA3AF]">
            No property was ever filed against this number. It was probably
            imported as an ordinary lead rather than from the scraper.
          </div>
        ) : (
          <>
            {listings.length > 1 && (
              <div className="border-b border-[#E5E7EB] px-4 py-2">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#8A9AAB]">
                  {listings.length} properties at this branch
                </div>
                <div className="space-y-1">
                  {listings.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setPickedId(l.id)}
                      className={`flex w-full items-baseline gap-2 rounded-md border px-2 py-1 text-left text-[11.5px] ${
                        l.id === selected.id
                          ? 'border-[#3C5A87] bg-[#EEF2F8]'
                          : 'border-[#E5E7EB] hover:bg-[#FAFAF8]'
                      }`}
                    >
                      <span className="flex-1 truncate">{l.address}</span>
                      <span className="whitespace-nowrap font-semibold text-[#2E7D43]">{gbpShort(l.offerMin)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selected.withdrawn && (
              <div className="border-b border-[#F3C2C2] bg-[#FDF1F1] px-4 py-2.5" data-testid="deal-withdrawn">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-[#A83232]" />
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#A83232]">
                      Deal withdrawn by the auditor
                      {selected.withdrawnAt
                        ? ` · ${new Date(selected.withdrawnAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                        : ''}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {(selected.withdrawnReasons.length
                        ? selected.withdrawnReasons
                        : ['The second brain rejected this valuation.']).map((why) => (
                        <li key={why} className="text-[11.5px] leading-snug text-[#A83232]">{why}</li>
                      ))}
                    </ul>
                    <div className="mt-1 text-[11.5px] text-[#8A5A5A]">
                      The figures below are what the branch was called about. Do not
                      quote them; this one is off Pedro's list.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <OfferStrip listing={selected} total={listings.length} />

            <div className="border-b border-[#E5E7EB] px-4 py-2.5 text-[11.5px] text-[#4B5563]">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {selected.bedrooms != null && <span>{selected.bedrooms} bed</span>}
                {selected.property_type && <span>{selected.property_type}</span>}
                {selected.days_on_market && <span>{selected.days_on_market} days on the market</span>}
              </div>
              {selected.listing_url && (
                <a
                  href={selected.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#3C5A87] hover:underline"
                >
                  Open the listing <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {(selected.floorplan_urls ?? []).length > 0 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {(selected.floorplan_urls ?? []).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="flex-shrink-0">
                      <img src={u} alt="Floor plan" className="h-20 w-auto rounded border border-[#E5E7EB] bg-white object-contain" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {selected.evidence.length > 0 && (
              <div className="border-b border-[#E5E7EB] px-4 py-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#8A9AAB]">Sold evidence</div>
                <ul className="space-y-0.5">
                  {selected.evidence.map((e) => (
                    <li key={e} className="text-[11.5px] leading-snug text-[#4B5563]">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {selected.flags.length > 0 && (
              <div className="border-b border-[#E5E7EB] bg-[#FDF9F0] px-4 py-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#9A6B1E]">Worth knowing</div>
                <ul className="space-y-0.5">
                  {selected.flags.map((f) => (
                    <li key={f} className="text-[11.5px] leading-snug text-[#9A6B1E]">{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 3. Hugo's calculator. Admin only: the cash position and the
                partner split are the director's business, not the caller's. */}
            {/* No sums on a withdrawn deal. They are built on the valuation the
                auditor just rejected, and a precise "cash needed" figure off a
                broken value is the false confidence this whole day was about. */}
            {isAdmin && sums && !selected.withdrawn && (
              <div className="border-b border-[#E5E7EB] px-4 py-2.5" data-testid="deal-snapshot-sums">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8A9AAB]">
                  The sums at {gbpShort(selected.offerMax)} (admin only)
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-[#4B5563]">
                  <span>Bridge at 75% of value</span><b className="text-right tabular-nums">{money(sums.bridge)}</b>
                  <span>Cash gap on day one</span><b className="text-right tabular-nums">{money(sums.gap)}</b>
                  <span>Stamp duty</span><b className="text-right tabular-nums">{money(sums.sdlt)}</b>
                  <span>Total cash needed</span><b className="text-right tabular-nums">{money(sums.totalCash)}</b>
                  {stack?.left_in != null && (
                    <><span>Engine: left in after refi</span><b className="text-right tabular-nums">{money(Number(stack.left_in))}</b></>
                  )}
                  {rent > 0 && (
                    <><span>Monthly profit once let</span><b className="text-right tabular-nums">{money(sums.monthly.profit)}</b></>
                  )}
                </div>
                <div className="mt-1.5 rounded-md border border-[#E5E7EB] bg-[#FAFAF8] px-2 py-1 text-[11.5px] text-[#1A1A1A]">
                  {sums.verdict.text}
                  {stack?.verdict ? <span className="text-[#6B7280]"> · engine: {String(stack.verdict).replace(/_/g, ' ')}</span> : null}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
