// interpolateScript — fill the sales script's NAMED lead tokens from a contact.
//
// The one-call sales script (src/core/content/one-call-script.html) is a
// template with named bracket tokens the agent reads aloud, personalised per
// lead: [owner_first], [business_name], [reviews], [rating], [rank], [town],
// [competitor_1], [competitor_2], [plumbers_ahead], [total_plumbers], and the
// href value [google_search_url].
//
// Design notes:
//   - This is DISPLAY-ONLY. It never mutates the saved template — the dialer
//     keeps the raw template (with bare tokens) for editing and shows the filled
//     copy. So editing/saving the script never bakes one lead's numbers in.
//   - We only touch the KNOWN named tokens. Ambiguous illustration numbers in
//     the calculator (e.g. [10], [120], [X]) are left untouched on purpose.
//   - A value that's missing keeps the token, but wrapped in a brown "ph" span
//     so an editor/agent can SEE it's an unfilled slot (styled by `.ph` in the
//     script HTML). [google_search_url] falls back to "#" (a bare token in an
//     href would be a broken link).
//   - Values are rendered via innerHTML by the script's build(), so every
//     substituted value is HTML-escaped to keep CSV data (e.g. "Bob & Sons",
//     a stray "<") from breaking the markup. Inside an href the browser decodes
//     the entities back, so the same escape is correct for the URL token too.

import { resolveTrade } from '../../../../api/lib/trades';

export interface ScriptContact {
  name?: string | null;
  customFields?: Record<string, string> | null;
}

/** The named text tokens (order doesn't matter; used for fill + highlight). */
export const SCRIPT_TEXT_TOKENS = [
  'owner_first', 'business_name', 'reviews', 'rating', 'rank', 'town',
  'competitor_1', 'competitor_2', 'plumbers_ahead', 'total_plumbers',
  // Trade-neutral aliases. [plumbers_ahead]/[total_plumbers] keep their names
  // (9 files reference them, including the voice-coach edge function) but the
  // VALUES are trade-neutral — for an electrician lead they're electricians
  // ahead, from an electricians search. Use these in script copy so the WORDS
  // match the numbers: "you're behind [competitors_ahead] other [trade_plural]".
  'trade', 'trade_plural', 'competitors_ahead', 'total_competitors',
] as const;

const PH_OPEN = '<span class="ph">';
const PH_CLOSE = '</span>';

/** HTML-escape a value before it's injected via innerHTML (text or attribute). */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** First word of a full name — "Lewis Adrian Ingoe" -> "Lewis". */
function firstWord(v: string | undefined): string | undefined {
  const w = (v ?? '').trim().split(/\s+/)[0];
  return w || undefined;
}

/** Replace every literal occurrence of `token` with `value`. */
function replaceAll(html: string, token: string, value: string): string {
  return html.split(token).join(value);
}

/** Reverse highlightTokens — used before saving so the stored template keeps
 *  bare tokens, not the brown styling. */
export function stripHighlights(html: string): string {
  return html.replace(/<span class="ph"[^>]*>(\[[a-z0-9_]+\])<\/span>/gi, '$1');
}

/** Wrap every bare known text token in a brown `.ph` span so unfilled slots are
 *  obvious (used for the dialer's Edit view). Idempotent — strips any existing
 *  wraps first, so a token is never double-wrapped. Never touches
 *  [google_search_url] (it lives in an href attribute, where a span would break
 *  the markup). */
export function highlightTokens(html: string): string {
  let out = stripHighlights(html);
  for (const name of SCRIPT_TEXT_TOKENS) {
    const token = `[${name}]`;
    out = replaceAll(out, token, `${PH_OPEN}${token}${PH_CLOSE}`);
  }
  return out;
}

export function interpolateScript(templateHtml: string, contact?: ScriptContact | null): string {
  const cf = contact?.customFields ?? {};
  const name = (contact?.name ?? '').trim();
  const trade = resolveTrade(cf, cf.town?.trim(), name);

  // token -> resolved raw value (undefined = leave the token as an unfilled slot)
  const textTokens: Record<string, string | undefined> = {
    '[owner_first]': firstWord(cf.owner_name),
    '[business_name]': name || (cf.business_name ?? '').trim() || undefined,
    '[reviews]': cf.reviews?.trim() || undefined,
    '[rating]': cf.rating?.trim() || undefined,
    '[rank]': cf.rank?.trim() || undefined,
    '[town]': cf.town?.trim() || undefined,
    '[competitor_1]': cf.competitor_1?.trim() || undefined,
    '[competitor_2]': cf.competitor_2?.trim() || undefined,
    '[plumbers_ahead]': cf.plumbers_ahead?.trim() || undefined,
    '[total_plumbers]': cf.total_plumbers?.trim() || undefined,
    '[trade]': trade.label ?? undefined,
    '[trade_plural]': trade.plural,
    '[competitors_ahead]': cf.plumbers_ahead?.trim() || undefined,
    '[total_competitors]': cf.total_plumbers?.trim() || undefined,
  };

  // Start from bare tokens (defensive: a template captured from a highlighted
  // view still fills cleanly).
  let html = stripHighlights(templateHtml);

  for (const [token, value] of Object.entries(textTokens)) {
    if (value == null) continue; // leave it — it becomes a brown slot below
    html = replaceAll(html, token, esc(value));
  }

  // The href token always resolves — to the lead's live search, or "#".
  const url = cf.google_search_url?.trim();
  html = replaceAll(html, '[google_search_url]', esc(url || '#'));

  // Any known text token still present was unfilled -> make it an obvious slot.
  return highlightTokens(html);
}
