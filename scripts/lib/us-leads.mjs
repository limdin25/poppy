// US lead helpers: normalise a scraped number, classify it for free off the
// NANPA table, and work out whether it is a civil hour where that number lives.
//
// WHY THE FREE GATES MATTER MORE HERE THAN THEY DO IN THE UK.
//
// In the UK the only question worth paying for is "is this subscription still
// alive". In the US there is a second question, it is answerable for nothing,
// and it decides whether a call is a routine B2B cold call or a call that
// carries statutory damages:
//
//   Is this a business landline, or somebody's mobile?
//
// The FCC ruled on 2024-02-08 that an AI-generated voice is an "artificial
// voice" for the purposes of the TCPA. 47 USC 227(b)(1)(A)(iii) bans an
// artificial voice to a MOBILE without prior express consent, and unlike the
// Do Not Call rules there is no clean business-to-business carve-out. Damages
// are statutory, 500 dollars a call and up to 1,500 if it is judged willful,
// so it is per-call exposure rather than a regulator's discretion.
//
// A business LANDLINE is the much quieter case: 227(b)(1)(B) covers
// residential lines, and business landlines sit outside it.
//
// We already own a 1.3 million row copy of the NANPA numbering plan in
// Supabase for the phone validator, so telling the two apart costs nothing per
// lookup. That makes "prefer landlines" a free control rather than a trade-off,
// which is the only reason it is the default here.
//
// It is NOT a legal opinion and it is not a guarantee. A landline number that
// was ported to a mobile still reads as a landline in the numbering plan. It
// lowers exposure, it does not remove it.

/** Digits only, then insist on a NANPA-shaped US number. Returns "" if it is not one. */
export function toE164US(raw) {
  const d = String(raw ?? '').replace(/\D+/g, '');
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (n.length !== 10) return '';
  // NANPA: area code and exchange both start 2-9, and N11 area codes are service
  // codes (411, 911), never subscribers.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(n)) return '';
  if (n[1] === '1' && n[2] === '1') return '';
  return `+1${n}`;
}

/** Split a +1 number into the NANPA parts the prefix table is keyed on. */
export function nanpaParts(e164) {
  const n = e164.replace(/^\+1/, '');
  return { npa: n.slice(0, 3), nxx: n.slice(3, 6), thousands: n.slice(6, 7) };
}

// prefix_type values seen in the table. Anything WIRELESS is a mobile; the
// telco codes (RBOC, CLEC, ILEC) are wireline. PCS is mobile too.
const WIRELESS = /WIRELESS|PCS|CELL/i;

/** landline | wireless | voip | unknown, from a NANPA prefix_type. */
export function lineTypeFromPrefix(prefixType) {
  const t = String(prefixType ?? '').toUpperCase();
  if (!t) return 'unknown';
  if (WIRELESS.test(t)) return 'wireless';
  if (t.includes('VOIP') || t.includes('INTERCONNECTED')) return 'voip';
  if (/RBOC|CLEC|ILEC|LEC|COMPETITIVE|INCUMBENT/.test(t)) return 'landline';
  return 'unknown';
}

/**
 * Look the numbers up in our own NANPA copy. Free, no per-lookup fee.
 * Returns Map<e164, {line_type, prefix_type, company, state, ratecenter}>.
 *
 * Misses are simply absent from the map, and a miss must be treated as
 * "unknown", never as "landline".
 */
export async function nanpaLookup(e164s, { supabaseUrl, supabaseKey, log = console.log } = {}) {
  const out = new Map();
  const unique = [...new Set(e164s.filter(Boolean))];
  if (!supabaseUrl || !supabaseKey || unique.length === 0) return out;

  // One row per (npa,nxx) rather than per lead, so 3,790 leads become far fewer
  // queries: plumbers cluster hard onto the same exchanges.
  const byPrefix = new Map();
  for (const e of unique) {
    const { npa, nxx } = nanpaParts(e);
    const k = `${npa}-${nxx}`;
    if (!byPrefix.has(k)) byPrefix.set(k, []);
    byPrefix.get(k).push(e);
  }
  const prefixes = [...byPrefix.keys()].map((k) => {
    const [npa, nxx] = k.split('-');
    return { npa, nxx };
  });
  log(`NANPA: ${unique.length} number(s) across ${prefixes.length} exchange(s), free lookup.`);

  const CHUNK = 120;
  for (let i = 0; i < prefixes.length; i += CHUNK) {
    const chunk = prefixes.slice(i, i + CHUNK);
    // PostgREST `or` needs the outer parens, and each pair its own and(...).
    const orFilter = `(${chunk.map((p) => `and(npa.eq.${p.npa},nxx.eq.${p.nxx})`).join(',')})`;
    const url = `${supabaseUrl}/rest/v1/nanpa_prefixes`
      + `?select=npa,nxx,prefix_type,company,state,ratecenter`
      + `&or=${encodeURIComponent(orFilter)}&limit=2000`;
    let rows = [];
    try {
      const res = await fetch(url, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      });
      if (!res.ok) {
        log(`NANPA chunk failed: HTTP ${res.status}. Those numbers stay "unknown".`);
        continue;
      }
      rows = await res.json();
    } catch (e) {
      log(`NANPA chunk failed: ${e.message}. Those numbers stay "unknown".`);
      continue;
    }
    // The table can hold several rows for one exchange (thousands-block splits).
    // We do not know the block owner per lead, so a mixed exchange is only
    // called "landline" when EVERY row for it agrees. Disagreement is unknown,
    // which keeps the safe default safe.
    const seen = new Map();
    for (const r of rows) {
      const k = `${r.npa}-${r.nxx}`;
      const t = lineTypeFromPrefix(r.prefix_type);
      if (!seen.has(k)) seen.set(k, { types: new Set(), row: r });
      seen.get(k).types.add(t);
    }
    for (const [k, v] of seen) {
      const line_type = v.types.size === 1 ? [...v.types][0] : 'unknown';
      for (const e of byPrefix.get(k) ?? []) {
        out.set(e, {
          line_type,
          prefix_type: v.row.prefix_type,
          company: v.row.company,
          state: v.row.state,
          ratecenter: v.row.ratecenter,
        });
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Calling hours
// --------------------------------------------------------------------------
//
// The TCPA window is 8am to 9pm in the LOCAL time of the person being called,
// so a UK-run campaign has to know where each number lives. The NANPA state is
// how we know.
//
// We deliberately enforce a NARROWER window than the law allows, 9am to 7pm.
// Two reasons, one legal and one practical. Several states straddle two zones
// (west Texas is Mountain, the Florida panhandle is Central), and a state-level
// map gets those wrong by an hour; an hour of margin at each end absorbs that
// error instead of turning it into an 8:01am violation. And nobody has ever
// warmed to a sales call at one minute past eight.

const STATE_TZ = {
  // Eastern
  CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', MA: 'America/New_York',
  MD: 'America/New_York', ME: 'America/New_York', MI: 'America/New_York',
  NC: 'America/New_York', NH: 'America/New_York', NJ: 'America/New_York',
  NY: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', VA: 'America/New_York',
  VT: 'America/New_York', WV: 'America/New_York', IN: 'America/New_York',
  KY: 'America/New_York',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago',
  IL: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago',
  MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago',
  ND: 'America/Chicago', NE: 'America/Chicago', OK: 'America/Chicago',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  WI: 'America/Chicago',
  // Mountain (AZ does not observe DST; the IANA zone handles that)
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Denver',
  MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver',
  WY: 'America/Denver',
  // Pacific and beyond
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

export const CALL_HOUR_START = 9;
export const CALL_HOUR_END = 19; // exclusive, so the last call starts by 18:59

export function tzForState(state) {
  return STATE_TZ[String(state ?? '').toUpperCase()] ?? null;
}

/**
 * Local hour and weekday for a state, right now (or at `at`).
 * Returns null when the state is unknown, which callers must treat as
 * "cannot call", never as "fine".
 */
export function localTime(state, at = new Date()) {
  const tz = tzForState(state);
  if (!tz) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { tz, hour, weekday };
}

/** Is it a civil hour to ring this state? Unknown state = no. */
export function callableNow(state, at = new Date()) {
  const t = localTime(state, at);
  if (!t) return { ok: false, why: 'unknown state, so the local time is unknown' };
  if (t.weekday === 'Sun') return { ok: false, why: `Sunday in ${t.tz}` };
  if (t.hour < CALL_HOUR_START || t.hour >= CALL_HOUR_END) {
    return { ok: false, why: `${t.hour}:00 local in ${t.tz}, outside ${CALL_HOUR_START}-${CALL_HOUR_END}` };
  }
  return { ok: true, why: `${t.hour}:00 local in ${t.tz}` };
}
