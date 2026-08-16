// The selected deal: what it is, what it is worth, what is missing, and the
// buttons that do something about it.
//
// EVERYTHING HERE IS BORROWED. NextStepCard renders the deterministic brief,
// OfferStrip renders the money exactly as Pedro sees it above his script,
// usePropertyListings is the ONE normaliser of the engine's nested-versus-flat
// deal shape, and CompGroup renders comparables in the same words as the
// dialer. Nothing about a deal is re-derived on this page.
//
// The action bar contains NO fetch. The only component in the cockpit that can
// commit anything is ActionConfirmDialog, and a test pins that.

import { useMemo, useState } from 'react';
import { Loader2, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import NextStepCard from '@/core/property/NextStepCard';
import CompGroup from '../shared/CompGroup';
import OfferStrip from '../live-call/OfferStrip';
import { usePropertyListings } from '../../hooks/usePropertyListings';
import { gbpShort } from '../../../../../api/lib/brrr-offer';
import { AttentionChip, FlagPills, ReplyBlock } from './CockpitQueue';
import { COCKPIT_ACTIONS, buttonsFor, primaryButtonFor, type CockpitAction } from './cockpitActions';
import type { CockpitDeal, StressReport } from './types';

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">{children}</span>
  );
}

/** Plain English for the checklist keys, so "condition_band" never reaches a
 *  human. Same list as the server's, which is the price of the server writing
 *  its own sentences: a test keeps both honest against CHECKLIST_KEYS. */
const CHECKLIST_WORDS: Record<string, string> = {
  still_available: 'still available',
  why_selling: 'why they are selling',
  motivation: 'how motivated',
  condition_notes: 'what condition',
  condition_band: 'how bad the works are',
  water: 'water coming in',
  tenure: 'freehold or leasehold',
  floor_area: 'floor area',
  rejected_offer: 'any offer turned down',
  agent_comparable: 'a done up sale on the street',
  rent_estimate: 'what it rents for',
  best_price_indicated: 'best price hinted at',
};

export default function CockpitCommandPanel({ deal, houses, onSelectHouse, reports, busy, onRequest }: {
  deal: CockpitDeal;
  /** Every live house this BRANCH holds, focus first. One card per branch is
   *  the rule (Hugo, 16 Aug: 15 deals on the pipeline, 35 in the cockpit), so
   *  the switcher lives here instead of extra cards existing. */
  houses?: Array<{ propertyId: string; address: string | null; attention: number }>;
  onSelectHouse?: (propertyId: string) => void;
  reports: Record<string, StressReport>;
  busy: string | null;
  onRequest: (action: CockpitAction) => void;
}) {
  const [showComps, setShowComps] = useState(false);
  const [showWhole, setShowWhole] = useState(false);
  // Hugo, 16 Aug: "I don't want to know so much details if it's not needed."
  // The order is the page; the working sits behind this fold.
  const [showDetail, setShowDetail] = useState(false);

  // The one normaliser, keyed on the branch phone exactly as the dialer does.
  // Deliberately NOT asking for withdrawn listings: a house the auditor pulled
  // has no figures we stand behind, and the money strip should say so rather
  // than quietly show the old ones.
  const { listings, loading: listingsLoading } = usePropertyListings(deal.branchPhone);
  const listing = useMemo(
    () => listings.find((l) => l.id === deal.propertyId) ?? null,
    [listings, deal.propertyId],
  );

  const buttons = buttonsFor(deal);
  const primary = primaryButtonFor(deal.action);
  const needsHugo = deal.who === 'HUGO' || deal.flags.includes('blocked_needs_hugo');

  // A reveal never leaves the building: with the working behind the fold now,
  // the Comparisons button opens the fold and the comps in one press. Anything
  // else goes to the gate.
  const request = (a: CockpitAction) => {
    if (COCKPIT_ACTIONS[a].kind === 'reveal') {
      setShowDetail(true);
      setShowComps(true);
      return;
    }
    onRequest(a);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ---- scrolls ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3" data-testid="cockpit-command">
        {/* the deal, named */}
        <div className="flex items-start gap-3" data-testid="cockpit-command-header">
          <AttentionChip score={deal.attention} big />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-ink leading-tight">
              {deal.address ?? 'Unnamed property'}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {deal.contactName && (
                <span className="text-[11px] text-ink-muted">{deal.contactName}</span>
              )}
              {deal.column && (
                <span className="text-[10px] rounded-full border border-border px-1.5 py-0.5 text-ink-muted">
                  {deal.column}
                </span>
              )}
              <FlagPills flags={deal.flags} />
            </div>
          </div>
        </div>

        {/* the branch's other live houses, chips not cards */}
        {(houses?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-1.5" data-testid="cockpit-house-switcher">
            {houses!.map((h) => (
              <button
                key={h.propertyId}
                type="button"
                onClick={() => onSelectHouse?.(h.propertyId)}
                className={cn(
                  'max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[11px]',
                  h.propertyId === deal.propertyId
                    ? 'border-brand bg-brand-50 font-semibold text-brand'
                    : 'border-border bg-white text-ink-muted hover:bg-elevated',
                )}
              >
                {h.address ?? 'Unnamed house'}
              </button>
            ))}
          </div>
        )}

        {/* THEY REPLIED. Above the order, unclamped, because the order was
            written before they wrote and that inversion is the whole point. */}
        {deal.repliedSinceBrief && (
          <ReplyBlock preview={deal.lastInboundPreview} at={deal.lastInboundAt} full />
        )}

        {/* this one is not Pedro's to fix */}
        {needsHugo && (
          <div className="rounded-md border border-[#FED7AA] bg-[#FFF7ED] px-2.5 py-2 text-[11.5px] text-[#C2410C]">
            <strong className="font-semibold">This one needs Hugo, not Pedro.</strong>{' '}
            The machine escalates, it never resolves.
          </div>
        )}

        {/* THE ORDER IS THE PAGE. Hugo, 16 Aug: "just tell exactly what the
            intelligence is asking us to do for the next step", "small texts".
            One big sentence, one big button, everything else behind the fold. */}
        <div className="rounded-lg border border-border bg-elevated px-3 py-2.5" data-testid="cockpit-order">
          <Label>Do this next</Label>
          <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{deal.instruction}</p>
          <button
            type="button"
            onClick={() => request(primary)}
            disabled={busy !== null}
            data-testid="cockpit-primary-action"
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === primary
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : (() => { const I = COCKPIT_ACTIONS[primary].icon; return <I className="w-4 h-4" />; })()}
            {COCKPIT_ACTIONS[primary].label}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9.5px] text-ink-subtle">
            <span>{deal.source === 'manager' ? 'Written by the deal brain' : 'From the brief on the file'}</span>
            {deal.stale && <span>Something has changed since this was written</span>}
          </div>
        </div>

        {/* the working, out of the way until asked for */}
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          data-testid="cockpit-detail-toggle"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink"
        >
          {showDetail ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          The detail
        </button>

        {showDetail && (<div className="space-y-3" data-testid="cockpit-detail">
        {deal.evidence.length > 0 && (
          <p className="text-[10.5px] text-ink-subtle">Based on: {deal.evidence.join(', ')}</p>
        )}

        {/* Hugo's own words, and the deterministic brief, both borrowed */}
        <NextStepCard brief={deal.brief as never} pinnedNote={deal.pinnedNote} />

        {/* the money, exactly as it reads above Pedro's script */}
        {listingsLoading ? (
          <div className="h-16 rounded-md bg-[#F3F4F6] animate-pulse" />
        ) : listing ? (
          <OfferStrip listing={listing} startCollapsed={false} />
        ) : (
          <div className="rounded-md border border-border bg-white px-2.5 py-2 text-[11.5px] text-ink-muted">
            {deal.status === 'auditor_killed'
              ? 'The second brain withdrew this valuation, so there are no figures we stand behind.'
              : 'No figures on file for this house yet.'}
            {deal.money.asking !== null && (
              <span className="ml-1">Asking {gbpShort(deal.money.asking)}.</span>
            )}
          </div>
        )}

        {/* what we still do not know */}
        {deal.checklist.missing.length > 0 && (
          <div className="rounded-md border border-border bg-white px-2.5 py-2">
            <Label>
              Still missing ({deal.checklist.answered} of {deal.checklist.total} answered)
            </Label>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">
              {deal.checklist.missing.map((k) => CHECKLIST_WORDS[k] ?? k.replace(/_/g, ' ')).join(', ')}
            </p>
          </div>
        )}

        {/* COMPARISONS. A pure reveal: the listings are already loaded, so this
            makes no network call at all. The e2e test asserts that. */}
        <div className="rounded-md border border-border bg-white">
          <button
            type="button"
            onClick={() => setShowComps((v) => !v)}
            data-testid="cockpit-comparisons-toggle"
            className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left"
          >
            {showComps ? <ChevronDown className="w-3.5 h-3.5 text-ink-subtle" />
              : <ChevronRight className="w-3.5 h-3.5 text-ink-subtle" />}
            <span className="text-[11.5px] font-semibold text-ink">Comparisons</span>
            <span className="text-[10px] text-ink-subtle">
              {deal.pack.compsCount} sold nearby
            </span>
          </button>

          {showComps && (
            <div className="space-y-2 border-t border-border px-2.5 py-2" data-testid="cockpit-comparisons">
              {listing ? (
                <>
                  {/* THE SAME TWO HEADINGS AS THE DIALER, word for word. A sale
                      at today's bed count is what it is worth now; a sale at
                      the target count is what it is worth once the conversion
                      is done. Reading one out as the other is how an agent
                      quotes a 5 bed price for a 3 bed house. */}
                  <CompGroup
                    heading="Same size as it is now"
                    comps={listing.comps.filter((c) => c.when === 'today')}
                  />
                  <CompGroup
                    heading="The size it becomes after the conversion"
                    comps={listing.comps.filter((c) => c.when === 'after')}
                  />
                  {listing.evidence.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-[#6B7280]">Why it holds</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {listing.evidence.map((e) => (
                          <li key={e} className="text-[11.5px] leading-snug text-[#4B5563]">{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {listing.listing_url && (
                    <a
                      href={listing.listing_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" /> Open the listing
                    </a>
                  )}
                </>
              ) : (
                <p className="text-[11.5px] text-ink-muted">
                  There are no comparables on file for this house.
                </p>
              )}
            </div>
          )}
        </div>

        {/* the rest of the file, out of the way until wanted */}
        <button
          type="button"
          onClick={() => setShowWhole((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
        >
          {showWhole ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          The whole deal
        </button>
        {showWhole && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border bg-white px-2.5 py-2 text-[11.5px]">
            {([
              ['Asking', deal.money.asking], ['Our opener', deal.money.open],
              ['Finished value', deal.money.gdv], ['Market value today', deal.money.tmv],
              ['Refurbishment', deal.money.refurb], ['Builder quote', deal.builder.quote],
            ] as const).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-subtle">{k}</dt>
                <dd className="text-ink tabular-nums">{v === null ? 'not on file' : gbpShort(v)}</dd>
              </div>
            ))}
            <div className="contents">
              <dt className="text-ink-subtle">Evidence</dt>
              <dd className="text-ink">{deal.money.compsTier ?? 'not graded'}</dd>
            </div>
            <div className="contents">
              <dt className="text-ink-subtle">Builders covering</dt>
              <dd className="text-ink">{deal.builder.matches}</dd>
            </div>
          </dl>
        )}
        </div>)}
      </div>

      {/* ---- never scrolls away ----
          pr-16 below xl reserves the corner the floating softphone sits in. */}
      <div className="flex-shrink-0 border-t border-border bg-surface p-3 pr-16 xl:pr-3" data-testid="cockpit-actions">
        <div className="flex flex-wrap gap-1.5">
          {buttons.map((a) => {
            const spec = COCKPIT_ACTIONS[a];
            const report = reports[a];
            const blocked = report ? !report.ok : false;
            const Icon = spec.icon;
            const isPrimary = a === primary;
            return (
              <button
                key={a}
                type="button"
                onClick={() => request(a)}
                disabled={busy !== null}
                data-testid={`cockpit-action-${a}`}
                data-blocked={blocked ? '1' : '0'}
                title={blocked ? report?.checks.find((c) => c.level === 'block')?.title : spec.label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors disabled:opacity-50',
                  isPrimary
                    ? 'bg-brand text-white hover:bg-brand-700'
                    : 'border border-border bg-white text-ink hover:bg-elevated',
                  // A blocked button is NOT hidden and NOT disabled here: the
                  // gate is where a refusal is explained, and a button that
                  // silently does nothing teaches people to stop pressing.
                  blocked && !isPrimary && 'text-ink-muted',
                )}
              >
                {busy === a
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Icon className="w-3.5 h-3.5" />}
                {spec.label}
                {blocked && <span className="text-[9.5px]">checks</span>}
              </button>
            );
          })}
        </div>
        {needsHugo && (
          <p className="mt-1.5 text-[10px] text-ink-subtle">
            Hugo has to do this one. Sending it to him is the step.
          </p>
        )}
      </div>
    </div>
  );
}
