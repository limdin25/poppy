// Second website gate, for the case Google cannot see.
//
// Google Places only knows the URL an owner typed into their Business Profile.
// Plenty of trades have a real site and never linked it. That is exactly what
// bit Hugo on 2026-07-28: Ghusuddin Jalali of SJC Plumbing Heating and Gas
// (Salisbury) got "I saw you on Google and noticed you dont have a website,
// I built you one" and replied "Look again". His Google listing has no website
// field, but www.sjcplumbingheatingandgas.co.uk is live and has been for years.
// A blank Google field is not proof of anything, so this checks the open web too.
//
// Deliberately STRICT. It only reports a site when the lead's OWN mobile number
// appears on the page, which is proof of ownership. Measured on Maria's 100:
// 21 name-matching domains resolved, only 2 were actually the lead's business
// (the other 19 were namesakes, mostly in the US: jb-plumbing.com is in
// Illinois, blackmoreplumbing.com is in Sacramento, miplumbingheating.com is a
// Michigan directory). A looser name-or-town match would have thrown away 19
// good leads. The phone test flagged both real sites and nothing else.
//
// Costs nothing: DNS first, and HTTP only for domains that actually resolve.

import dns from 'node:dns/promises';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PATHS = ['', 'contact', 'contact-us', 'about'];

const alnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s) => String(s || '').toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(ltd|limited|llp)\b/g, ' ')
  .split(/\s+/).filter(Boolean);

/** Domains a UK trade plausibly owns, derived from its trading name. */
export function candidateDomains(name, town) {
  const w = words(name);
  if (!w.length) return [];
  const noAnd = w.filter((x) => x !== 'and');
  const noSvc = w.filter((x) => x !== 'services' && x !== 'service');
  const stems = new Set([w.join(''), noAnd.join(''), noSvc.join(''), (w.join('') + alnum(town))]);
  const hyphens = new Set([w.join('-'), noAnd.join('-')]);
  const out = [];
  for (const s of stems) if (s.length >= 5 && s.length <= 55) for (const t of ['co.uk', 'com', 'uk']) out.push(`${s}.${t}`);
  for (const s of hyphens) if (s.length >= 5 && s.length <= 55) for (const t of ['co.uk', 'com']) out.push(`${s}.${t}`);
  return [...new Set(out)];
}

async function resolves(domain) {
  try { await dns.resolve4(domain); return true; } catch { /* try cname */ }
  try { await dns.resolveCname(domain); return true; } catch { return false; }
}

async function page(url, timeoutMs) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    // Strip scripts and styles BEFORE truncating. Wix and Squarespace bury a
    // megabyte of JS above the visible copy, so slicing first hides the
    // contact details we are looking for.
    const html = (await r.text())
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .slice(0, 900000);
    return { url: r.url, html };
  } catch {
    return null;
  }
}

/**
 * Does this lead have a live website of its own, whatever Google says?
 * Proof required: the lead's own mobile number printed on the site.
 * Returns { url, domain } or null. Never throws.
 */
export async function findOwnWebsite({ name, town, phone, timeoutMs = 9000 }) {
  const national = String(phone || '').replace(/\D/g, '').replace(/^44/, '');
  if (national.length < 9) return null;
  for (const domain of candidateDomains(name, town)) {
    if (!(await resolves(domain))) continue;
    for (const proto of ['https', 'http']) {
      const home = await page(`${proto}://${domain}/`, timeoutMs);
      if (!home) continue;
      let digits = home.html.replace(/\D/g, '');
      if (digits.includes(national)) return { url: home.url, domain };
      for (const p of PATHS.slice(1)) {
        const sub = await page(new URL('/' + p, home.url).href, timeoutMs);
        if (!sub) continue;
        digits = sub.html.replace(/\D/g, '');
        if (digits.includes(national)) return { url: home.url, domain };
      }
      break; // https answered, no need to retry over http
    }
  }
  return null;
}
