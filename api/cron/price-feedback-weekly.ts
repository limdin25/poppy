// Our offer against their number, every Monday morning.
//
// Stage 8 of the deal-engine build, and the only feedback loop the business
// actually has. brrr_price_feedback has been recording what an estate agent
// said out loud beside what the engine claimed at that exact moment since
// 2026-08-11, frozen so a nightly re-price cannot rewrite history. Nobody read
// it. The admin Properties page shows one national median, which tells Hugo the
// engine is out and nothing about what to change.
//
// Cut by OUTCODE and by CONDITION BAND it becomes actionable, and the two cuts
// answer different questions:
//
//   by outcode         where the comparables are wrong. One area running high
//                      is a comps problem in that area, not a global one.
//   by condition band  whether the REFURB estimate is drifting. The offer is
//                      (GDV - refurb) x 0.75, so if branches consistently sit
//                      above our ceiling on full-refurb houses and inside it on
//                      turnkey ones, the refurb card is what is wrong.
//
// EVERY NUMBER HERE IS ARITHMETIC. No model is asked to interpret anything,
// for the same reason no model is allowed to set a price: a confident sentence
// about a drift that is not there would send somebody to change a rate card
// that was fine. Medians throughout, never averages, so one silly note cannot
// move a figure Hugo acts on. The plain-English verdict at the top is a
// threshold on a median and nothing more.
//
// Quiet by design. No figures on file at all means no email: the queue is on
// hold while the new engine is wired up, and a weekly "nothing happened" is how
// a report gets filtered into a folder nobody opens.

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import {
  calibrate, calibrateBy, valuationVerdict, refurbVerdict,
  pctText as pct, ratioText as ratio, MEANINGFUL_SAMPLE as MEANINGFUL,
  type CalibrationRow, type CalibrationGroup,
} from '../lib/price-feedback.js';
import { outcodeOf } from '../lib/brrr-deal-facts.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/** A row as it comes out of the table, plus the address we can still recover an
 *  outcode from on rows written before the column existed. */
interface FeedbackRow extends CalibrationRow {
  created_at: string;
  address: string | null;
  said_text: string | null;
  outcome: string | null;
}

const money = (v: number | null | undefined): string =>
  v && v > 0 ? `£${Math.round(v).toLocaleString('en-GB')}` : 'n/a';
const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function table(title: string, groups: CalibrationGroup[], weekly: Map<string, number>): string {
  if (groups.length === 0) return '';
  const rows = groups.map((g) => {
    const thin = g.n < MEANINGFUL;
    const c = thin ? '#9CA3AF' : '#1A1A1A';
    return `<tr>
      <td style="padding:6px 10px;border-top:1px solid #E5E7EB;color:${c};font-weight:600">${esc(g.key)}</td>
      <td style="padding:6px 10px;border-top:1px solid #E5E7EB;color:${c};text-align:right">${g.n}${weekly.get(g.key) ? ` <span style="color:#6B7280;font-weight:400">(+${weekly.get(g.key)})</span>` : ''}</td>
      <td style="padding:6px 10px;border-top:1px solid #E5E7EB;color:${c};text-align:right">${ratio(g.vsOffer)}</td>
      <td style="padding:6px 10px;border-top:1px solid #E5E7EB;color:${c};text-align:right">${ratio(g.vsCmv)}</td>
      <td style="padding:6px 10px;border-top:1px solid #E5E7EB;color:${c};text-align:right">${pct(g.withinCeilingPct)}</td>
    </tr>`;
  }).join('');
  return `<h3 style="margin:22px 0 6px;font-size:15px">${title}</h3>
    <p style="margin:0 0 6px;color:#9CA3AF;font-size:11.5px">Grey rows have fewer than ${MEANINGFUL} figures behind them and should not be read yet. The bracket is what came in this week.</p>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <tr style="color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em">
        <td style="padding:0 10px 4px;text-align:left">Group</td>
        <td style="padding:0 10px 4px;text-align:right">Figures</td>
        <td style="padding:0 10px 4px;text-align:right">Theirs / our open</td>
        <td style="padding:0 10px 4px;text-align:right">Theirs / our value</td>
        <td style="padding:0 10px 4px;text-align:right">Inside our ceiling</td>
      </tr>
      ${rows}
    </table>`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Everything on file, not just the week. The dataset is small and getting a
  // median out of seven days of calls in one outcode is not measurement, it is
  // noise with a decimal point. The week is reported as a count on top.
  const { data, error } = await supabase
    .from('brrr_price_feedback')
    .select('created_at, address, said_text, said_price, asking_price, cmv, cmv_confidence, gdv, offer_open, offer_max, outcode, condition_band, outcome')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (data ?? []) as unknown as FeedbackRow[];
  if (rows.length === 0) {
    // Nothing has ever been recorded. Say nothing: a weekly email about an
    // empty table trains the reader to ignore the one that finally matters.
    return new Response(JSON.stringify({ ok: true, sent: false, reason: 'no figures on file' }), { status: 200 });
  }

  // The outcode column only exists from 2026-08-12. Older rows still carry the
  // address, and a postcode is not a thing that gets re-priced, so recovering
  // it at read time is safe in a way that recovering the condition band would
  // not be.
  const withOutcode = rows.map((r) => ({ ...r, outcode: r.outcode || outcodeOf(r.address) }));
  const thisWeek = withOutcode.filter((r) => r.created_at >= weekAgo);

  const all = calibrate(withOutcode);
  const week = calibrate(thisWeek);
  const byOutcode = calibrateBy(withOutcode, (r) => r.outcode);
  const byCondition = calibrateBy(withOutcode, (r) => r.condition_band);
  const weeklyOutcode = new Map(calibrateBy(thisWeek, (r) => r.outcode).map((g) => [g.key, g.n]));
  const weeklyCondition = new Map(calibrateBy(thisWeek, (r) => r.condition_band).map((g) => [g.key, g.n]));

  // The ones where we were furthest out, so Hugo can look at actual houses
  // rather than only at medians. Ordered by how far their figure sat above the
  // most we could have paid.
  const misses = withOutcode
    .filter((r) => (r.said_price ?? 0) > 0 && (r.offer_max ?? 0) > 0 && (r.said_price as number) > (r.offer_max as number))
    .sort((a, b) => (b.said_price! / b.offer_max!) - (a.said_price! / a.offer_max!))
    .slice(0, 8);

  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:680px;color:#1A1A1A">
    <h2 style="margin:0 0 4px">Our offer against their number</h2>
    <p style="color:#6B7280;margin:0 0 18px;font-size:13.5px">
      Every figure an estate agent has named on a call, beside what the engine claimed at that moment.
      ${week.n} this week, ${all.n} in total.
    </p>

    <div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="text-align:center;padding:8px">
            <div style="font-size:26px;font-weight:700;color:#3C5A87">${ratio(all.vsOffer)}</div>
            <div style="color:#6B7280;font-size:12px">their figure vs our opener</div>
          </td>
          <td style="text-align:center;padding:8px">
            <div style="font-size:26px;font-weight:700;color:#3C5A87">${ratio(all.vsCmv)}</div>
            <div style="color:#6B7280;font-size:12px">their figure vs our valuation</div>
          </td>
          <td style="text-align:center;padding:8px">
            <div style="font-size:26px;font-weight:700;color:#3C5A87">${pct(all.withinCeilingPct)}</div>
            <div style="color:#6B7280;font-size:12px">inside our walk-away</div>
          </td>
          <td style="text-align:center;padding:8px">
            <div style="font-size:26px;font-weight:700;color:#3C5A87">${ratio(all.vsAsking)}</div>
            <div style="color:#6B7280;font-size:12px">their figure vs the advert</div>
          </td>
        </tr>
      </table>
    </div>

    <div style="border-left:3px solid #3C5A87;padding:2px 0 2px 12px;margin-bottom:6px">
      <p style="margin:0;font-size:13.5px;line-height:1.55"><strong>Valuation:</strong> ${valuationVerdict(all.vsCmv, all.n)}</p>
    </div>
    <div style="border-left:3px solid #9A6B1E;padding:2px 0 2px 12px;margin-bottom:8px">
      <p style="margin:0;font-size:13.5px;line-height:1.55"><strong>Refurb:</strong> ${refurbVerdict(byCondition)}</p>
    </div>

    ${table('By outcode, where the comparables are wrong', byOutcode, weeklyOutcode)}
    ${table('By condition band, whether the refurb estimate is drifting', byCondition, weeklyCondition)}

    ${misses.length ? `<h3 style="margin:22px 0 6px;font-size:15px">Furthest above what we could pay</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      ${misses.map((m) => `<tr>
        <td style="padding:6px 10px;border-top:1px solid #E5E7EB">${esc(m.address || 'unknown address')}</td>
        <td style="padding:6px 10px;border-top:1px solid #E5E7EB;text-align:right;color:#A83232;font-weight:600">${money(m.said_price)}</td>
        <td style="padding:6px 10px;border-top:1px solid #E5E7EB;text-align:right;color:#6B7280">our ceiling ${money(m.offer_max)}</td>
        <td style="padding:6px 10px;border-top:1px solid #E5E7EB;text-align:right;color:#6B7280">asking ${money(m.asking_price)}</td>
      </tr>`).join('')}
    </table>` : ''}

    <p style="margin-top:20px;font-size:12px;color:#9CA3AF">
      Medians, never averages, so one odd note cannot move a figure.
      A blank cell means nothing was recorded, not zero.
      <a href="${appUrl}/admin/properties" style="color:#3C5A87">Open the properties board</a>
    </p>
  </div>`;

  const to = process.env.PRICE_FEEDBACK_EMAIL
    || process.env.DAILY_REPORT_EMAIL
    || 'hugodesouzax@gmail.com';
  try {
    await sendEmail(to, `Offer vs their number: ${week.n} new figures, ${all.n} on file`, html);
  } catch (e) {
    console.error('[price-feedback-weekly] email failed:', e);
    return new Response(JSON.stringify({ ok: false, sent: false, error: (e as Error).message }), { status: 200 });
  }

  return new Response(JSON.stringify({
    ok: true,
    sent: true,
    week: week.n,
    total: all.n,
    outcodes: byOutcode.length,
    conditions: byCondition.length,
  }), { status: 200 });
}
