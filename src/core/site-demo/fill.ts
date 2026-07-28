// Fills the typed content document from what we know about the lead.
//
// PURE, AND DELIBERATELY NOT AN LLM CALL.
// A token fill is sub-second, free, deterministic, diffable, and structurally
// incapable of inventing a Gas Safe number. Generation runs inline in the
// request that creates the page, so an LLM round trip would also be the
// slowest thing in the funnel for no gain: there are seven true facts and no
// creative decision left to make once the trade is resolved.
//
// THE ONE RULE THAT MATTERS
// A literal unfilled token must never reach a page a real prospect sees. Every
// optional field either resolves or its sentence is rewritten to not need it.
// That is why there are no "[town]" style placeholders anywhere below: the
// copy is assembled from parts, never interpolated into a fixed string.

import { tradePhotos } from './photos.js';
import { tradeCopy } from './trade-services.js';
import { reviewsAreGoogleSourced, type SiteContent, type SiteDemoData } from './types.js';

const BLUE = '#1D4E89';

/** First word only, trimmed. "Dave Smith" -> "Dave". */
export function firstWord(s?: string | null): string {
  return String(s || '').trim().split(/\s+/)[0] || '';
}

/**
 * Format a UK E.164 number the way a person writes it.
 * +447700900123 -> 07700 900123, +441514960000 -> 0151 496 0000.
 * Anything we do not recognise is returned untouched rather than mangled.
 */
export function formatUkPhone(e164: string): string {
  const raw = String(e164 || '').trim();
  const digits = raw.replace(/[^\d+]/g, '');
  const uk = digits.startsWith('+44') ? '0' + digits.slice(3) : digits;
  if (!/^0\d{9,10}$/.test(uk)) return raw;
  // Mobiles: 07xxx xxxxxx
  if (uk.startsWith('07') && uk.length === 11) return `${uk.slice(0, 5)} ${uk.slice(5)}`;
  // 3-digit area codes (020, 011x, 0151 style handled below)
  if (/^0(2\d)/.test(uk) && uk.length === 11) return `${uk.slice(0, 3)} ${uk.slice(3, 7)} ${uk.slice(7)}`;
  if (uk.length === 11) return `${uk.slice(0, 4)} ${uk.slice(4, 7)} ${uk.slice(7)}`;
  if (uk.length === 10) return `${uk.slice(0, 4)} ${uk.slice(4)}`;
  return uk;
}

/** Title-cases a town the way it is normally written. */
function tidyTown(town?: string): string {
  const t = String(town || '').trim();
  if (!t) return '';
  return t
    .split(/\s+/)
    .map((w) => (w.length <= 2 && w === w.toLowerCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * The hero line. Built from parts so a missing town simply shortens it
 * instead of leaving a hole.
 */
export function buildTagline(tradeLabel: string, town: string): string {
  const trade = tradeLabel || 'Trade services';
  if (town) return `${trade} in ${town}`;
  return trade;
}

/**
 * Pillow band one: the service area. With no town we state coverage without
 * naming a radius we were never told.
 */
export function buildAreaBand(town: string, tradePlural: string): string {
  if (town) return `Covering ${town} and the surrounding area`;
  return `Local ${tradePlural || 'tradespeople'}, and easy to get hold of`;
}

/**
 * The about paragraph. Assembled, never templated, and it claims nothing.
 *
 * Takes the WORK noun, not the trade label. Trade.label is a person noun, so
 * lowercasing it here produced "handles plumber work", which is not English.
 */
export function buildAbout(businessName: string, work: string, town: string): string {
  const what = String(work || 'trade').trim() || 'trade';
  const where = town ? ` around ${town}` : '';
  return (
    `${businessName} takes on ${what} work${where}. ` +
    `Ring the number on this page and you will get a straight answer about what needs doing and what it will take. ` +
    `No call centre, no waiting on hold.`
  );
}

/**
 * Fill the content document.
 *
 * Everything optional degrades to a shorter, still-true sentence. Nothing is
 * invented. Proof renders only when Google gave it to us.
 */
export function fillSiteContent(data: SiteDemoData): SiteContent {
  const copy = tradeCopy(data.profileKey);
  const town = tidyTown(data.town);
  const businessName = String(data.businessName || '').trim() || 'This business';
  const tradeLabel = String(data.tradeLabel || '').trim();
  const phoneDisplay = String(data.phoneDisplay || '').trim() || formatUkPhone(data.phoneE164);

  const content: SiteContent = {
    v: 1,
    businessName,
    tradeLabel: tradeLabel || 'Trade services',
    town: town || undefined,
    tagline: buildTagline(tradeLabel, town),
    phoneDisplay,
    phoneE164: String(data.phoneE164 || '').trim(),
    address: String(data.address || '').trim() || undefined,
    services: copy.services.slice(),
    bands: [buildAreaBand(town, data.tradePlural), copy.availability, phoneDisplay],
    about: buildAbout(businessName, copy.work, town),
    contactHeading: 'Get in touch',
    colours: { accent: copy.accent, blue: BLUE },
    glyph: copy.glyph,
    photos: tradePhotos(data.profileKey),
    chatGreeting: town
      ? `Hi, thanks for stopping by. Do you need a hand with something in ${town}?`
      : 'Hi, thanks for stopping by. What can we help you with?',
  };

  if (reviewsAreGoogleSourced(data)) {
    content.proof = { rating: Number(data.rating), reviews: Number(data.reviews) };
  }

  return content;
}
