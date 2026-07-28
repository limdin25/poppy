// The site-demo content model.
//
// TWO TYPES, DELIBERATELY SEPARATE:
//   SiteDemoData  — what we know about the lead. Raw facts, straight off the
//                   wk_contacts row. Nothing here is presentational.
//   SiteContent   — the typed content document that actually gets rendered and,
//                   after the sale, edited. One field here = one field in the
//                   owner's editor, which is the whole reason the model fills a
//                   document instead of writing HTML.
//
// WHY THE TRADE ARRIVES PRE-RESOLVED
// resolveTrade() lives in api/lib/trades.ts, which the Vite build cannot see
// (tsconfig.app.json covers src/ only). So the CALLER resolves the trade and
// passes the three strings in. That keeps this module importable by the api
// routes, the unit tests and the post-sale editor alike.

/** Everything we know about the lead, before any presentational decision. */
export interface SiteDemoData {
  /** wk_contacts.name — this is the COMPANY, not the person. */
  businessName: string;
  /** custom_fields.owner_name, first word only. The person. */
  ownerFirst?: string;
  /** Resolved by the caller via resolveTrade(). */
  tradeKey: string;
  /** "Plumber", "Electrician". Trade.label. */
  tradeLabel: string;
  /** "plumbers", "electricians". Trade.plural. */
  tradePlural: string;
  /** Trade.profile_key — picks the service list and accent. May be null. */
  profileKey?: string | null;
  town?: string;
  address?: string;
  /** Nearby towns, resolved by api/lib/uk-areas.ts. Never invented. */
  areas?: SiteArea[];
  /**
   * THE NUMBER THE SITE SHOWS AND VISITORS DIAL. Not necessarily the lead's own
   * number. Before the sale this is the shared demo receptionist line, because
   * the whole demo is the owner ringing it and hearing their own AI answer for
   * their own business. After the sale the editor swaps it for their real line.
   * The lead's actual mobile stays on the wk_contacts row, where the caller-ID
   * lookup needs it.
   */
  phoneDisplay: string;
  /** E.164 form of the same number, for the tel: href. */
  phoneE164: string;
  /**
   * Google review count and rating. ONLY pass these when they came from Google.
   * See reviewsAreGoogleSourced below — the fill step refuses them otherwise.
   */
  reviews?: number | null;
  rating?: number | null;
  /** custom_fields.reviews_source. Must be exactly 'google' for proof to render. */
  reviewsSource?: string | null;
}

import type { TradePhotos } from './photos.js';
import type { PageKey } from './sitemap.js';

/** A single service line in the index. */
export type SiteService = string;

/**
 * A town the business covers. Resolved from Google's geocoder and never
 * invented: see api/lib/uk-areas.ts. An empty list deletes the areas pages
 * rather than substituting anything.
 */
export interface SiteArea {
  name: string;
  slug: string;
}

/**
 * Per-page copy the owner can override after the sale. Absent fields fall back
 * to the generated default, so an owner who edits one heading does not have to
 * rewrite a page, and a page he has never opened still reads properly.
 */
export interface PageCopy {
  heading?: string;
  blurb?: string;
  /** Body paragraphs, in order. */
  body?: string[];
}

/**
 * Google proof. Present ONLY when we actually pulled it from Google.
 * Its absence deletes the entire proof section rather than substituting
 * anything, which is the truth rule expressed as structure.
 */
export interface SiteProof {
  rating: number;
  reviews: number;
}

export interface SiteColours {
  /** The one saturated accent. Per-trade, and the only hue the trade map sets. */
  accent: string;
  /** The flat plane blue. Overridable post-sale, fixed pre-sale. */
  blue: string;
}

/** The typed content document. Rendered by render.ts, edited post-sale. */
export interface SiteContent {
  /** Schema version, so a later migration can upgrade stored documents. */
  v: 1;
  businessName: string;
  tradeLabel: string;
  town?: string;
  /** The hero line under the name. */
  tagline: string;
  phoneDisplay: string;
  phoneE164: string;
  address?: string;
  services: SiteService[];
  /** The three pillow bands, in order. Exactly one short line each. */
  bands: [string, string, string];
  about: string;
  contactHeading: string;
  /** Absent unless Google-sourced. Never synthesised. */
  proof?: SiteProof;
  colours: SiteColours;
  /** Which line-drawn mark to set as the printer's mark. */
  glyph: string;
  /**
   * The trade's photographs, resolved at fill time and stored on the document
   * so the post-sale editor can replace them one by one with the owner's own.
   *
   * OPTIONAL because documents written before photography existed do not carry
   * it. render.ts falls back to the neutral set rather than dropping to a page
   * with no images, which is the version the client rejected twice.
   */
  photos?: TradePhotos;
  /**
   * Towns near the business, nearest first. Drives the areas pages and the
   * areas dropdown. Empty or absent removes both entirely.
   */
  areas?: SiteArea[];
  /** Owner overrides, keyed by page. Everything falls back to the default. */
  pages?: Partial<Record<PageKey, PageCopy>>;
  /**
   * E.164 number for click-to-chat. Pre-sale this is the shared demo line, so
   * a lead pressing WhatsApp reaches us rather than a dead number.
   */
  whatsapp?: string;
  logoUrl?: string;
  /** Opening line the chat widget greets with. */
  chatGreeting: string;
}

/**
 * The single gate on review proof. Google is the only source we trust, because
 * it is the only one we actually pulled. The CSV count that shipped with the
 * lead list was unreliable and is stored separately as reviews_csv.
 */
export function reviewsAreGoogleSourced(data: SiteDemoData): boolean {
  return (
    data.reviewsSource === 'google' &&
    typeof data.rating === 'number' &&
    data.rating > 0 &&
    typeof data.reviews === 'number' &&
    data.reviews > 0
  );
}
