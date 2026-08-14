// The one sentence about sold comparables that a human reads out loud.
//
// Hugo, 2026-08-14, looking at a live board card: the field said
// "[object Object] · [object Object] · [object Object]". `comp_evidence` is a
// SCRIPT TOKEN, so that string was on its way to being read down the phone to
// an estate agent.
//
// What happened: the valuation engine used to file deal.evidence as an array of
// SENTENCES and now files it as an array of comp ROWS (address, price, date,
// distance_m, ...). The dialer's own reader was fixed for the new shape on
// 2026-08-12; the assign script, which writes the value onto the contact and is
// the thing the pipeline card and the Edit modal show, was not. A .join() on
// objects does not throw, it just prints [object Object], which is why nothing
// went red for two days.
//
// PREFERENCE ORDER, best evidence first, and every branch of it is a fact the
// engine already wrote. Nothing here re-derives a number:
//
//   1. deal.comps_note   the engine's own sentence ("3 sold comps, same style,
//                        within 400m, sold in the last 12 months"). Written to
//                        be said out loud, so it wins.
//   2. cmv.n_used        a count, when the engine reported one.
//   3. the rows          address, raw sold price and date. RAW, never the
//                        time-adjusted figure, because Pedro says these to
//                        somebody who can look them up.
//   4. nothing           "no sold comparables on file", which is a real and
//                        useful answer.
//
// No distance is ever put in the sentence. cmv.ring_used is the engine's ring
// INDEX, not a number of metres, and "4 sold comparables within 1m" is a line
// nobody can say to an estate agent.

const num = (v) => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const money = (n) => (num(n) > 0 ? `£${Math.round(num(n)).toLocaleString('en-GB')}` : '');

/** Every comp row the engine filed, from either shape, newest key first. */
export function compRows(deal) {
  const d = deal ?? {};
  const cmv = d.cmv && typeof d.cmv === 'object' ? d.cmv : {};
  const audit = Array.isArray(cmv.audit)
    ? cmv.audit.filter((a) => a && typeof a === 'object' && a.included === true)
    : [];
  const evidence = Array.isArray(d.evidence)
    ? d.evidence.filter((e) => e && typeof e === 'object')
    : [];
  return [...audit, ...evidence].filter((r) => num(r.price) > 0);
}

/** Sentences the engine filed as plain strings, back when it did. */
function flatSentences(deal) {
  const d = deal ?? {};
  return Array.isArray(d.evidence)
    ? d.evidence.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim())
    : [];
}

/**
 * The comp_evidence token for one property.
 *
 * @param {object} deal the brrr_properties.deal jsonb, either shape
 * @returns {string} always a sentence, never an empty string
 */
export function compEvidenceSentence(deal) {
  const d = deal ?? {};
  const cmv = d.cmv && typeof d.cmv === 'object' ? d.cmv : {};
  const worth = num(cmv.estimate) || num(d.cmv);

  const note = typeof d.comps_note === 'string' ? d.comps_note.trim() : '';
  if (note) {
    return worth > 0 ? `${note}, putting it at ${money(worth)}` : note;
  }

  const counted = num(cmv.comps) || num(cmv.n_used);
  if (counted > 0 && worth > 0) {
    return `${counted} sold comparable${counted === 1 ? '' : 's'} nearby put it at ${money(worth)}`;
  }

  const flat = flatSentences(d);
  if (flat.length) return flat.slice(0, 3).join(' · ');

  const rows = compRows(d);
  if (rows.length) {
    return rows
      .slice(0, 3)
      .map((r) => {
        const addr = String(r.address ?? '').trim() || 'a house nearby';
        const when = String(r.date ?? '').trim();
        return `${addr} sold for ${money(r.price)}${when ? ` (${when})` : ''}`;
      })
      .join(' · ');
  }

  return 'no sold comparables on file';
}
