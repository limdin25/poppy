// Does this one stack? For Hugo, on the Properties page, not for Pedro on a call.
//
// Hugo, 2026-08-09, asked for this on his admin page rather than on the dialer:
// "yes but for me, not Pedro." Pedro needs to know what to say; this answers
// whether the deal is worth doing at all, which is a decision made afterwards
// with a cup of tea, not mid-negotiation.
//
// It starts from the property's REAL numbers (the offer the valuation engine
// produced, what the comps say it is worth, the local rent) and lets Hugo push
// them around. The scraper's own verdict is shown beside it when there is one,
// so a disagreement between the two is visible rather than hidden.

import { useState } from 'react';
import { computeDeal, money, DEAL_ASSUMPTIONS } from '../lib/dealMaths';

interface Props {
  /** What we would pay: the offer band's ceiling, capped below asking. */
  defaultPurchase: number;
  /** What the sold comps say it is worth today. */
  defaultMarketValue: number;
  /** From the scraper's rental comps, when it found any. */
  defaultRent: number;
  /** The valuation engine's own conclusion, for comparison. */
  engineTotalCash?: number | null;
  engineVerdict?: string | null;
}

const VERDICT_STYLES: Record<string, string> = {
  ok: 'bg-success/10 text-success border-success/30',
  needs_jv: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  walk_mv: 'bg-danger/10 text-danger border-danger/30',
  walk_purchase: 'bg-danger/10 text-danger border-danger/30',
};

export default function DealCalculator({
  defaultPurchase, defaultMarketValue, defaultRent, engineTotalCash, engineVerdict,
}: Props) {
  const [purchase, setPurchase] = useState(Math.round(defaultPurchase) || 0);
  const [marketValue, setMarketValue] = useState(Math.round(defaultMarketValue) || 0);
  const [refurb, setRefurb] = useState(15000);
  const [rentPcm, setRentPcm] = useState(Math.round(defaultRent) || 0);
  const [termMonths, setTermMonths] = useState(9);

  const d = computeDeal({ purchase, marketValue, refurb, rentPcm, termMonths });
  const style = VERDICT_STYLES[d.verdict.kind] ?? VERDICT_STYLES.needs_jv;

  // The engine and this calculator answering differently is worth seeing. It
  // usually means the refurb or the term below is not what the engine assumed.
  const disagrees = engineTotalCash != null && engineTotalCash > 0
    && Math.abs(engineTotalCash - d.totalCash) > Math.max(2000, d.totalCash * 0.15);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Does it stack?</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}>
          {d.verdict.text}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Buy at" value={purchase} onChange={setPurchase} />
        <Field label="Worth now" value={marketValue} onChange={setMarketValue} />
        <Field label="Refurb" value={refurb} onChange={setRefurb} />
        <Field label="Rent pcm" value={rentPcm} onChange={setRentPcm} />
        <Field label="Months" value={termMonths} onChange={setTermMonths} step={1} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Head>Cash you need on day one</Head>
          <Row k="Bridge (75% of value)" v={money(d.bridge)} />
          <Row k="Arrangement fee" v={`-${money(d.arrangementFee)}`} />
          <Row k={`Interest (${termMonths} mo)`} v={`-${money(d.interest)}`} />
          <Row k="Net loan" v={money(d.netLoan)} />
          <Row k="Gap to the purchase" v={money(d.gap)} />
          <Row k="Stamp duty" v={money(d.sdlt)} />
          <Row k="Solicitor + surveys" v={money(DEAL_ASSUMPTIONS.solicitor + DEAL_ASSUMPTIONS.surveys)} />
          <Row k="Total cash in" v={money(d.totalCash)} strong />
          {disagrees && (
            <p className="mt-1.5 text-[11px] text-amber-600">
              The scraper worked this out as {money(engineTotalCash!)}. The difference is
              usually the refurb or the term above.
            </p>
          )}
          {engineVerdict && (
            <p className="mt-1 text-[11px] text-ink-muted">Scraper says: {engineVerdict}</p>
          )}
        </div>

        <div>
          <Head>What comes back on refinance</Head>
          {d.scenarios.map((s) => (
            <Row
              key={s.label}
              k={s.label}
              v={money(s.cashBack)}
              tone={s.resultVsCashIn >= 0 ? 'good' : undefined}
            />
          ))}
          <Head className="mt-3">Every month, once let</Head>
          <Row k="Rent" v={money(d.monthly.rent)} />
          <Row k="Mortgage" v={`-${money(d.monthly.mortgage)}`} />
          <Row k="Insurance" v={`-${money(d.monthly.insurance)}`} />
          <Row k="Profit" v={money(d.monthly.profit)} strong tone={d.monthly.profit > 0 ? 'good' : 'bad'} />
          <Row
            k="Split 40 / 30 / 30"
            v={`${money(d.monthly.hugoShare)} · ${money(d.monthly.partner1Share)} · ${money(d.monthly.partner2Share)}`}
          />
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-ink-muted">
        Assumes {(DEAL_ASSUMPTIONS.ltv * 100).toFixed(0)}% loan to value, {(DEAL_ASSUMPTIONS.bridgeRate * 100).toFixed(0)}% a month
        bridging, {(DEAL_ASSUMPTIONS.sdltRate * 100).toFixed(0)}% stamp duty and a {(DEAL_ASSUMPTIONS.btlRate * 100).toFixed(1)}% buy-to-let
        rate. Change them in src/features/admin/lib/dealMaths.ts.
      </p>
    </div>
  );
}

function Field({
  label, value, onChange, step = 500,
}: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-ink"
      />
    </label>
  );
}

function Head({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-subtle ${className}`}>
      {children}
    </div>
  );
}

function Row({
  k, v, strong, tone,
}: { k: string; v: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  const colour = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-border/50 py-1 text-[12px] ${strong ? 'font-semibold' : ''}`}>
      <span className="text-ink-muted">{k}</span>
      <span className={`tabular-nums ${colour}`}>{v}</span>
    </div>
  );
}
