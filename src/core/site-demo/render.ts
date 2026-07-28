// Renders the content document to one standalone HTML document.
//
// WHAT THIS PAGE IS FOR
// A plumber opens it on his phone, thirty seconds after a text, and decides
// whether this is worth ninety seven pounds a month. It has to look like a
// website he would have paid a local agency for. Everything here serves that:
// a solid header, a hero that states who he is and what he covers, his Google
// rating where he can see it, services as cards with their own icons, and the
// phone number never more than a thumb away.
//
// THE CONSTRAINT THAT SHAPES THE DESIGN
// We have no photography of these businesses and the truth rules forbid
// inventing any. So the visual weight has to come from colour, depth, type and
// shape rather than from imagery: a deep blue hero with a light pattern, white
// cards lifted over its edge, generous radii and real shadows.
//
// WHY A STRING AND NOT REACT
// api/tsconfig.json is ES2023 + node16 with no DOM lib and no JSX, and
// react-dom/server is not a dependency anywhere in this repo. The page is also
// served by a Vercel node function that must emit real OG tags before any
// client JS runs. A string is the honest shape for both.
//
// SELF-CONTAINED, NON-NEGOTIABLE
// No CDN, no webfont, no icon package, no external image. Every external host
// is a round trip on a phone on mobile data and a privacy leak on a lead's
// page. Icons are inline SVG. Type is the system stack.

import { tradePhotos, type SitePhoto } from './photos.js';
import type { SiteContent } from './types.js';

export interface RenderOptions {
  /** Public slug, used for the canonical URL. */
  slug: string;
  /** wk_site_pages.id. Printed in the page so beacons can identify it. */
  pageId: string;
  /** HMAC beacon token. Empty string disables all beacons (staff view). */
  beaconToken: string;
  /** True when one of us is looking, not the lead. Suppresses every beacon. */
  staff?: boolean;
  canonicalUrl: string;
  ogImageUrl?: string;
  /** Renders the chat launcher. */
  chatEnabled?: boolean;
  /** Renders the "Get started" close. Off until the funnel is armed. */
  checkoutEnabled?: boolean;
}

/**
 * HTML escape. Applied at emission, never to the ingredients: escaping a value
 * and then escaping the string that contains it double-encodes ampersands,
 * which shows up as "&amp;amp;" in an SMS link preview.
 */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe to drop inside a <script> string literal. */
function jsSafe(v: unknown): string {
  return JSON.stringify(v ?? null).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// Icons.
//
// Drawn on a 24 unit grid, stroked with currentColor so one path works on a
// blue tile and on a white header alike.
// ---------------------------------------------------------------------------

export const ICONS: Record<string, string> = {
  drop: '<path d="M12 3s6 6.6 6 10.5A6 6 0 0 1 6 13.5C6 9.6 12 3 12 3Z"/>',
  flame:
    '<path d="M12 3c3 3.5 1 5 1 6.5C13 11 14 12 15 12s2-1 2-2.5c2 2 2.5 4 2.5 5.5a7.5 7.5 0 0 1-15 0C4.5 10.5 9 8 12 3Z"/>',
  shower:
    '<path d="M5 21V7a3 3 0 0 1 6 0v1M9 12h11M9 12a1 1 0 0 0-1 1v1a5 5 0 0 0 10 0v-1a1 1 0 0 0-1-1"/>',
  bath: '<path d="M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 12V5.5A2.5 2.5 0 0 1 10.5 4M7 19l-1.5 2M17 19l1.5 2"/>',
  waves: '<path d="M3 8c3-2 5 2 8 0s5-2 8 0M3 14c3-2 5 2 8 0s5-2 8 0M3 20c3-2 5 2 8 0s5-2 8 0"/>',
  bolt: '<path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 1 3.5 10.9V16h-7v-2.1A6 6 0 0 1 12 3Z"/>',
  panel: '<path d="M4 3h16v18H4z"/><path d="M8 7.5h8M8 12h3M13 12h3M8 16.5h3M13 16.5h3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>',
  house: '<path d="m3 10 9-7 9 7M6 9.5V21h12V9.5M10 21v-6h4v6"/>',
  paving: '<path d="M3 6h8v5H3zM13 6h8v5h-8zM3 13h5v5H3zM10 13h11v5H10z"/>',
  // A plasterer's float, blade on and handle above. Drawn as a pointed trowel
  // it read as a magnifying glass.
  trowel: '<path d="M3 15h14a2 2 0 0 0 2-2v-2.5H5a2 2 0 0 0-2 2Z"/><path d="M8.5 10.5V8a1.75 1.75 0 0 1 3.5 0v2.5"/>',
  beam: '<path d="M3 6h18M3 18h18M7 6v12M17 6v12M7 12h10"/>',
  tiles: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  floor: '<path d="M3 7h18v10H3z"/><path d="M3 12h18M9 7v5M15 12v5"/>',
  rodent:
    '<ellipse cx="10" cy="14.5" rx="6" ry="5"/><circle cx="6" cy="8.5" r="3"/><path d="M16 16c2.6 0 4.5-1.2 4.5-3.6"/><circle cx="12.5" cy="13" r=".7"/>',
  wasp:
    '<path d="M12 2.5v3.5M9.8 4 12 6l2.2-2"/><ellipse cx="12" cy="13.5" rx="3.4" ry="5.8"/><path d="M8.7 11.5h6.6M8.7 15h6.6M5 10.5c-2 1-2 4.5 0 5.5M19 10.5c2 1 2 4.5 0 5.5"/>',
  // Two birds in flight, the shape everyone reads instantly. Drawn as a
  // detailed side-on bird it came out looking like a leaf, then like a tool.
  bird: '<path d="M2.5 10c3-4 6-4 8.5 0 2.5-4 5.5-4 8.5 0"/><path d="M6 17c2.2-3 4.5-3 6.5 0 1.8-3 3.8-3 5.5 0"/>',
  bed: '<path d="M3 19V6M3 12h16a2 2 0 0 1 2 2v5M3 19h18M7 12V9.5h4V12"/>',
  clipboard:
    '<path d="M9 3h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 12h6M9 16h4"/>',
  // Roof line and gutter only. Drawn as a whole house it was indistinguishable
  // from the extensions card sitting next to it.
  roof: '<path d="m2 12 10-7 10 7"/><path d="M4.5 15h15M4.5 15v3.5M19.5 15v3.5M12 15v3.5"/>',
  brick: '<path d="M3 4h18v5H3zM3 9v5h18V9M3 14v5h18v-5M9 4v5M15 9v5M9 14v5"/>',
  // A paint roller. The old brush shape read as a lollipop at 23px.
  brush:
    '<path d="M3 4.5h11v5H3z"/><path d="M14 7h4a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-6V15"/><path d="M10 15h4v6h-4z"/>',
  hammer: '<path d="M14.5 3.5 21 10l-3 3-2.4-2.4L7 19.2a2.1 2.1 0 1 1-3-3l8.6-8.6L10.2 5.2Z"/>',
  square: '<path d="M4 4h16v16H4zM4 10h16M10 4v16"/>',
  // Laid on its side with the teeth pointing down. Drawn upright with a
  // diagonal shaft it reads as a magnifying glass at 23px, which is what the
  // locksmith cards shipped with.
  key: '<circle cx="6.5" cy="12" r="3.5"/><path d="M10 12h10.5M17.5 12v3.6M14 12v3"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18"/><circle cx="15.5" cy="12.5" r=".9"/>',
  vault:
    '<path d="M4 4h16v16H4z"/><circle cx="12" cy="12" r="3.6"/><path d="M12 8.4V5.6M12 18.4v-2.8M15.6 12h2.8M5.6 12h2.8"/>',
  bug: '<path d="M8 8a4 4 0 0 1 8 0M6 12h12M8 8h8v5a4 4 0 0 1-8 0ZM4 9l2 1M20 9l-2 1M4 17l2-1M20 17l-2-1M12 17v4"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6ZM9 12l2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  phone:
    '<path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.2 2 2 0 0 1 6 3Z"/>',
  wrench: '<path d="M20 5a5 5 0 0 1-6.8 6.8L6 19a2.1 2.1 0 0 1-3-3l7.2-7.2A5 5 0 0 1 17 2l-3 3 2 2 3-3Z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 9.5l6.1-.9Z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
};

/**
 * Which icon a service line gets.
 *
 * Matched on the WORDS, not on a fixed per-trade list, because the owner
 * renames these lines in the editor after the sale and a positional map would
 * hand a renamed service the wrong picture. First match wins, so the more
 * specific patterns are listed first.
 */
const SERVICE_ICONS: Array<[RegExp, string]> = [
  // --- Locks. A locksmith's six lines are all about locks, so they split
  // further or four of the six cards carry the identical key.
  [/\bev\b|charger|charging/i, 'plug'],
  [/burglar|break-?in|forced entry/i, 'shield'],
  [/\bsafes?\b|vault/i, 'vault'],
  [/lockout|upvc|\bdoors?\b|\bwindows?\b/i, 'door'],
  // Word-bounded, and it has to be. A bare /lock/ matches "Blocked drains",
  // which shipped a padlock icon onto a plumber's drain-clearing card.
  [/\block(s|smith)?\b|\bkeys?\b/i, 'key'],

  // --- Pests, each to its own, before the generic proofing rule.
  [/rodent|mice|mouse|\brats?\b/i, 'rodent'],
  [/wasp|hornet|\bbees?\b|nest/i, 'wasp'],
  [/bed ?bugs?/i, 'bed'],
  [/bird/i, 'bird'],
  [/cockroach|\bants?\b|insect|flea|silverfish|pest/i, 'bug'],
  [/proof|prevent|protect/i, 'shield'],

  // --- Heat and water.
  [/boiler|heating|radiator|\bgas\b|furnace|warm/i, 'flame'],
  [/blocked|drain|sewer|unblock|gutter clear/i, 'waves'],
  [/leak|burst|pipe|water|plumb/i, 'drop'],
  [/bathroom|wet room|\bsuite\b/i, 'bath'],
  [/shower|\btaps?\b|toilet|basin|sink/i, 'shower'],

  // --- Building.
  [/extension|loft|conversion|new build/i, 'house'],
  [/roof|chimney|gutter|slate|fascia/i, 'roof'],
  [/driveway|patio|paving|tarmac|landscap/i, 'paving'],
  [/plaster|render|screed|skim/i, 'trowel'],
  [/structural|beam|underpin|subsid|joist/i, 'beam'],
  [/brick|repoint|\bwall/i, 'brick'],

  // --- Interiors.
  [/tiling|\btiles?\b/i, 'tiles'],
  [/floor|laminate|carpet/i, 'floor'],
  [/paint|decorat/i, 'brush'],
  [/carpentry|joinery|\bwood|\bshelv|\bstud\b/i, 'hammer'],
  [/kitchen|worktop|\bunits?\b/i, 'square'],

  // --- Paperwork before power, or "Electrical inspections" reads as a socket.
  [/inspect|test|certificat|report|survey|quote|assessment/i, 'clipboard'],

  // --- Electrical.
  [/fault|diagnos|trip(ping)?\b/i, 'search'],
  [/fuse|consumer unit|rewir|\bboards?\b|distribution/i, 'panel'],
  [/lighting|\blights?\b|bulb|downlight/i, 'bulb'],
  [/socket|\bpower\b|outdoor|garden|electric/i, 'bolt'],

  // --- Anything the owner types in for himself.
  [/emergency|callout|call-?out|24|out of hours/i, 'clock'],
  [/install|\bfit\b|fitting|upgrade|\bnew\b/i, 'spark'],
  [/repair|maintenance|service|fix/i, 'wrench'],
];

export function iconFor(service: string): string {
  for (const [re, name] of SERVICE_ICONS) if (re.test(service)) return name;
  return 'wrench';
}

function svg(name: string, size = 24, cls = 'ico'): string {
  const d = ICONS[name] || ICONS.wrench;
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`
  );
}

/** The trade's own mark, used in the header lockup. */
function brandMark(key: string): string {
  const d = ICONS[key] || ICONS.wrench;
  return (
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `focusable="false">${d}</svg>`
  );
}

function styles(accent: string, blue: string): string {
  return `
:root{
  --paper:#FFFFFF; --soft:#F4F7FB; --tint:#EDF3FA;
  --ink:#0B1B2D; --muted:#58687C; --line:#E4EAF2;
  --blue:${esc(blue)}; --navy:#0C2138; --deep:#12304F; --accent:${esc(accent)};
  /* Matches the tint baked into public/site/*.webp by
     scripts/build-site-photos.mjs. A trade with no photograph falls back to
     this as a solid plane, so the page keeps its colour either way. */
  --duo-base:#0E2E52;
  --r:16px; --r-sm:12px; --pill:999px;
  --shadow:0 1px 2px rgba(12,28,46,.05), 0 12px 32px rgba(12,28,46,.07);
  --shadow-lg:0 2px 4px rgba(12,28,46,.06), 0 24px 60px rgba(12,28,46,.12);
  --s1:8px; --s2:16px; --s3:24px; --s4:36px; --s5:56px; --s6:84px;
  --bar:0px; --head:64px;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%; scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){ html{scroll-behavior:auto} }
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:1.0625rem; line-height:1.6; -webkit-font-smoothing:antialiased;
  padding-bottom:var(--bar);
}
a{color:inherit}
img,svg{display:block}
:focus-visible{outline:3px solid var(--accent); outline-offset:2px; border-radius:4px}
.wrap{width:100%; max-width:1120px; margin:0 auto; padding:0 20px}
@media(min-width:760px){ .wrap{padding:0 32px} }
.eyebrow{font-size:.75rem; letter-spacing:.14em; text-transform:uppercase;
  font-weight:700; color:var(--muted); margin:0 0 12px}
.h2{font-size:clamp(1.75rem,4.4vw,2.6rem); line-height:1.12; letter-spacing:-.022em;
  font-weight:800; margin:0 0 var(--s2)}
.lede{color:var(--muted); max-width:56ch; margin:0}

/* ---- Header. Transparent over the opening photograph, solid once it moves. */
.head{position:fixed; top:0; left:0; right:0; z-index:30; background:transparent;
  border-bottom:1px solid transparent; transition:background .25s ease, border-color .25s ease}
.head.stuck{background:var(--paper); border-bottom-color:var(--line)}
.headin{height:var(--head); display:flex; align-items:center; justify-content:space-between; gap:16px}
.brand{display:flex; align-items:center; gap:10px; min-width:0; color:#fff}
.head.stuck .brand{color:var(--ink)}
.brand .bm{width:32px; height:32px; flex:none; display:grid; place-items:center;
  background:rgba(255,255,255,.16); color:#fff}
.head.stuck .brand .bm{background:var(--tint); color:var(--blue)}
.brand b{font-size:1rem; font-weight:800; letter-spacing:-.015em; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis}
.headcall{display:none}
@media(min-width:620px){
  .headcall{display:inline-flex; align-items:center; gap:8px; color:#fff; text-decoration:none;
    font-weight:700; font-size:1rem; font-variant-numeric:tabular-nums; flex:none}
  .head.stuck .headcall{color:var(--blue)}
}

/* ---- BEAT 1. Hero: a full-bleed photograph, title low-left.
   The photograph is an <img>, not a CSS background, so it can carry alt text
   and fetchpriority. Its absence must cost nothing: --duo-base matches the
   tint baked into the files, so a trade with no photograph reads as a solid
   plane of the same colour rather than as a broken page. */
.hero{position:relative; overflow:hidden; color:#fff; background:var(--duo-base);
  min-height:92svh; display:flex; align-items:flex-end;
  padding:calc(var(--head) + var(--s5)) 0 var(--s5)}
@media(min-width:760px){ .hero{min-height:88vh; padding-bottom:var(--s6)} }
.shot{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0}
/* One directional source with deep falloff. This is the film reference and it
   is also the only reason white type is legible over an unknown photograph. */
.scrim{position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(to top, rgba(9,26,45,.95) 0%, rgba(9,26,45,.84) 36%,
    rgba(9,26,45,.48) 66%, rgba(9,26,45,.22) 100%)}
.hero .wrap{position:relative; z-index:2; width:100%}
.rating{display:flex; align-items:center; gap:9px; margin:0 0 var(--s3);
  font-size:.92rem; font-weight:600}
.rating .stars{display:flex; gap:2px; color:#FFC24A}
.rating .stars svg{fill:currentColor; stroke:none}
.rating b{font-variant-numeric:tabular-nums}
.rating span{color:rgba(255,255,255,.72); font-weight:500}
.kicker{font-size:.76rem; letter-spacing:.18em; text-transform:uppercase; font-weight:700;
  color:rgba(255,255,255,.74); margin:0 0 12px}
.name{font-size:clamp(2.6rem,9vw,5.2rem); line-height:1.0; letter-spacing:-.035em;
  font-weight:800; margin:0 0 var(--s3); text-wrap:balance;
  text-shadow:0 2px 30px rgba(0,0,0,.28)}
.blurb{font-size:clamp(1rem,2vw,1.15rem); color:rgba(255,255,255,.86);
  max-width:46ch; margin:0 0 var(--s4)}
.acts{display:flex; flex-wrap:wrap; gap:12px}
.btn{display:inline-flex; align-items:center; justify-content:center; gap:10px;
  padding:16px 26px; text-decoration:none; font-weight:700;
  font-size:1.02rem; border:1px solid transparent; cursor:pointer; font-family:inherit;
  transition:transform .16s ease, background .18s ease, filter .18s ease}
.btn:active{transform:translateY(1px)}
.btn-call{background:var(--accent); color:#fff; font-variant-numeric:tabular-nums}
.btn-call:hover{filter:brightness(1.08)}
.btn-ghost{background:rgba(255,255,255,.08); color:#fff; border-color:rgba(255,255,255,.42)}
.btn-ghost:hover{background:rgba(255,255,255,.18)}
@media(prefers-reduced-motion:reduce){ .btn{transition:none} }

/* ---- BEAT 2. Territory: the one solid rest, and deliberately image-free.
   We cannot honestly show HIS town, and a generic town captioned with his town
   is a quiet lie. Colour carries this beat instead. */
.territory{background:var(--blue); color:#fff; padding:var(--s6) 0}
.territory .row{display:flex; gap:18px; align-items:flex-start; max-width:24ch}
.territory .ico{flex:none; opacity:.7; margin-top:6px}
.territory p{margin:0; font-size:clamp(1.4rem,3.6vw,2.1rem); font-weight:700;
  line-height:1.25; letter-spacing:-.018em}

/* ---- BEAT 3. Inventory: an editorial list beside a tall photograph.
   NOT cards. The rejected version made these cards and it read as a template. */
.sec{padding:var(--s6) 0}
.inv{display:grid; gap:var(--s5); align-items:start}
@media(min-width:900px){ .inv{grid-template-columns:.85fr 1.15fr; gap:var(--s6)} }
.invshot{position:relative; background:var(--duo-base); overflow:hidden; aspect-ratio:16/11}
@media(min-width:900px){ .invshot{aspect-ratio:4/5; position:sticky; top:calc(var(--head) + 24px)} }
.invshot img{width:100%; height:100%; object-fit:cover; display:block}
/* SIGNATURE COMPOSITION, instance one: a solid slab overlapping the corner of
   a photograph, carrying exactly one fact. A card grid cannot do this. */
.slab{position:absolute; z-index:2; background:var(--blue); color:#fff;
  padding:18px 22px; max-width:80%}
.slab.bl{left:0; bottom:24px}
.slab .k{margin:0 0 4px; font-size:.68rem; letter-spacing:.15em; text-transform:uppercase;
  color:rgba(255,255,255,.72); font-weight:700}
.slab p{margin:0; font-weight:700; font-size:1.02rem; line-height:1.35}
.eyebrow{font-size:.75rem; letter-spacing:.16em; text-transform:uppercase;
  font-weight:700; color:var(--muted); margin:0 0 12px}
.h2{font-size:clamp(1.75rem,4.4vw,2.6rem); line-height:1.1; letter-spacing:-.024em;
  font-weight:800; margin:0 0 var(--s2)}
.lede{color:var(--muted); max-width:52ch; margin:0 0 var(--s4)}
.index{list-style:none; margin:0; padding:0}
.item{display:flex; gap:18px; align-items:center; padding:18px 0;
  border-bottom:1px solid var(--line)}
.item:first-child{border-top:1px solid var(--line)}
.item .n{font-size:.75rem; color:var(--muted); font-variant-numeric:tabular-nums;
  font-weight:700; min-width:2ch}
.item .ico{color:var(--blue); flex:none}
.item h3{margin:0; font-size:1.05rem; font-weight:650; letter-spacing:-.01em}

/* ---- BEAT 4. Proof: a white slab over the outcome photograph.
   Mirrors beat 3, so the two instances of the signature read as a pair. */
.proof{position:relative; background:var(--soft); overflow:hidden;
  aspect-ratio:4/3; display:flex; align-items:flex-start; justify-content:flex-end}
@media(min-width:760px){ .proof{aspect-ratio:21/9} }
.proof img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0}
.proof .slab{position:relative; background:var(--paper); color:var(--ink);
  padding:30px 34px; margin:var(--s4) var(--s3) 0 0; text-align:center; max-width:none}
@media(min-width:760px){ .proof .slab{margin:var(--s5) var(--s5) 0 0; padding:36px 48px} }
.proof .stars{display:flex; justify-content:center; gap:5px; color:#F5A623; margin-bottom:10px}
.proof .stars svg{fill:currentColor; stroke:none}
/* Scoped to .proof deliberately. As a bare .score it lost to the .slab p rule,
   which is one class more specific, and the rating rendered at 16px instead of
   48px. Specificity, not cascade order.
   (No backticks in these comments: the whole stylesheet is a template literal
   and a stray backtick ends it mid-file.) */
.proof .score{font-size:clamp(3rem,8vw,4.2rem); font-weight:800; letter-spacing:-.038em;
  line-height:1; margin:0 0 6px; font-variant-numeric:tabular-nums}
.proof .sub{color:var(--muted); margin:0; font-weight:600; font-size:.95rem}

/* ---- BEAT 5. The reckoning: the number, as the largest type on the page. */
.close{background:var(--deep); color:#fff; padding:var(--s6) 0 calc(var(--s6) + 40px);
  text-align:center}
.close .eyebrow{color:rgba(255,255,255,.6)}
.close .tel{display:inline-block; font-size:clamp(2.2rem,8vw,3.6rem); font-weight:800;
  letter-spacing:-.035em; text-decoration:none; font-variant-numeric:tabular-nums;
  margin:0 0 var(--s2); line-height:1}
.close .tel:hover{color:var(--accent)}
.close .where{color:rgba(255,255,255,.72); margin:0 auto var(--s4); max-width:34ch}
.getstarted{display:inline-block; background:var(--paper); color:var(--ink);
  border:0; padding:16px 30px; font:inherit; font-weight:700; font-size:1rem;
  cursor:pointer; transition:background .18s ease, color .18s ease}
.getstarted:hover{background:var(--accent); color:#fff}
.getstarted[disabled]{opacity:.7; cursor:default}

/* ---- Footer. Extra clearance so the launcher never sits on the last line. */
.foot{background:var(--navy); color:rgba(255,255,255,.6);
  padding:var(--s4) 0 calc(var(--s4) + 56px); font-size:.88rem}
.footin{display:flex; flex-wrap:wrap; gap:10px 24px; align-items:center; justify-content:space-between}
.foot b{color:#fff; font-size:.98rem; letter-spacing:-.01em}
.foot a{text-decoration:none; font-variant-numeric:tabular-nums}
.foot a:hover{color:#fff}

/* ---- Persistent call bar, small screens only. */
.callbar{position:fixed; left:0; right:0; bottom:0; background:var(--blue);
  color:#fff; display:flex; align-items:center; justify-content:center;
  gap:10px; padding:15px; text-decoration:none; font-weight:700; z-index:40;
  font-variant-numeric:tabular-nums;
  box-shadow:0 -1px 0 rgba(12,28,46,.08), 0 -10px 28px rgba(12,28,46,.10)}
@media(min-width:620px){ .callbar{display:none} }

/* ---- Chat. */
/* The launcher stays out of the opening frame. It would otherwise sit on top of
   the hero call button on a phone, covering the one thing the page is for.
   Chat needs JS regardless, so hiding it until JS reveals it costs nothing. */
.chatbtn{position:fixed; right:16px; bottom:calc(var(--bar) + 16px); z-index:50;
  background:var(--ink); color:#fff; border:0; border-radius:var(--pill);
  padding:13px 20px; font:inherit; font-weight:700; font-size:.92rem; cursor:pointer;
  display:inline-flex; align-items:center; gap:9px;
  box-shadow:0 10px 30px rgba(12,28,46,.24);
  opacity:0; pointer-events:none; transform:translateY(10px);
  transition:opacity .3s ease, transform .3s ease}
.chatbtn.show{opacity:1; pointer-events:auto; transform:none}
.chatbtn:hover{background:var(--blue)}
@media(prefers-reduced-motion:reduce){ .chatbtn{transition:none} }
.chat{position:fixed; inset:auto 12px calc(var(--bar) + 12px) 12px; z-index:60;
  background:var(--paper); border:1px solid var(--line); border-radius:var(--r); display:none;
  flex-direction:column; max-height:min(72vh,580px); overflow:hidden; box-shadow:var(--shadow-lg)}
.chat[open]{display:flex}
@media(min-width:620px){ .chat{left:auto; width:390px} }
.chat header{display:flex; align-items:center; gap:12px; padding:14px 16px;
  background:var(--blue); color:#fff}
.chat header .tile{width:32px; height:32px; border-radius:9px; display:grid; place-items:center;
  background:rgba(255,255,255,.18); flex:none}
.chat header strong{font-size:.95rem; flex:1; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap}
.chat .x{background:none; border:0; font:inherit; font-size:1.4rem; line-height:1;
  cursor:pointer; color:rgba(255,255,255,.85); padding:2px 6px}
.chat .x:hover{color:#fff}
.log{flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px;
  background:var(--soft)}
.msg{max-width:84%; padding:11px 15px; font-size:.95rem; line-height:1.5; border-radius:16px}
.msg.them{align-self:flex-start; background:var(--paper); border:1px solid var(--line);
  border-bottom-left-radius:5px}
.msg.you{align-self:flex-end; background:var(--blue); color:#fff; border-bottom-right-radius:5px}
.msg.wait{align-self:flex-start; color:var(--muted); font-style:italic; background:none; padding-left:4px}
.chat form{display:flex; border-top:1px solid var(--line); background:var(--paper)}
.chat input{flex:1; border:0; padding:15px 16px; font:inherit; background:transparent; color:var(--ink)}
.chat input:focus{outline:none}
.chat button.send{border:0; background:var(--blue); color:#fff; padding:0 22px;
  font:inherit; font-weight:700; cursor:pointer}
.chat button.send:hover{background:var(--deep)}

/* ---- Motion.
   Baseline is VISIBLE. Every start state is applied by JS only, behind .js, so
   a dropped script can never hand a lead a blank sales page.

   NOTHING HERE CLIPS AN OBSERVED ELEMENT. Chromium counts an element's own
   clip-path when deciding whether it intersects, so clipping the node the
   observer is watching means it never reveals. The first version of this page
   shipped an invisible band for exactly that reason. Opacity, transform and
   scale only. */
.js .r{opacity:0; transform:translateY(14px)}
.js .r.in{opacity:1; transform:none;
  transition:opacity .6s ease, transform .6s cubic-bezier(.22,.7,.24,1)}
/* beat 1: the scrim lifts while the title rises. Load only. */
.js .scrim{opacity:.42}
.js .scrim.in{opacity:1; transition:opacity .9s ease}
/* beat 3: the camera settles on the work photograph. */
.js .invshot img{transform:scale(1.06)}
.js .invshot.in img{transform:scale(1); transition:transform 1.1s cubic-bezier(.2,.6,.2,1)}
/* beat 4: the only lateral move on the page. */
.js .proof .slab{opacity:0; transform:translateX(26px)}
.js .proof .slab.in{opacity:1; transform:none;
  transition:opacity .5s ease, transform .7s cubic-bezier(.2,.7,.2,1)}
/* beat 5: one step of scale, terminal emphasis. */
.js .z{opacity:0; transform:scale(.97)}
.js .z.in{opacity:1; transform:none;
  transition:opacity .5s ease, transform .6s cubic-bezier(.2,.7,.2,1)}
@media(prefers-reduced-motion:reduce){
  .js .r,.js .z,.js .scrim,.js .proof .slab{opacity:1 !important; transform:none !important;
    transition:none !important}
  .js .invshot img{transform:none !important}
}
`.trim();
}

/** Five stars at a fixed size, for the hero pill and the proof card. */
function starRow(n = 5, size = 15): string {
  return Array.from({ length: n }, () => svg('star', size, 'st')).join('');
}

/**
 * BEAT 4. The one spectacle. Renders only when Google gave us the numbers,
 * unchanged rule: absence deletes the section rather than substituting
 * anything. The photograph behind it is optional too, and its absence leaves
 * the slab on the soft plane with the section's shape intact.
 */
function proofSection(content: SiteContent, photo?: SitePhoto): string {
  if (!content.proof) return '';
  const full = Math.max(0, Math.min(5, Math.round(content.proof.rating)));
  const img = photo
    ? `<img src="${esc(photo.src)}" alt="${esc(photo.alt)}" loading="lazy" decoding="async">`
    : '';
  return `
<section class="proof">
  ${img}
  <div class="slab">
    <div class="stars" aria-hidden="true">${starRow(full, 20)}</div>
    <p class="score">${esc(content.proof.rating.toFixed(1))}</p>
    <p class="sub">${esc(content.proof.reviews)} Google reviews</p>
  </div>
</section>`;
}

/** The whole page. */
export function renderSite(content: SiteContent, opts: RenderOptions): string {
  const tel = content.phoneE164;
  const title = content.town
    ? `${content.businessName} | ${content.tradeLabel} in ${content.town}`
    : `${content.businessName} | ${content.tradeLabel}`;
  const desc = content.about.slice(0, 180);

  // The about paragraph is ONE editable field but it appears in two places, so
  // it is split rather than printed twice. The hero takes the opening sentence
  // (who they are and where), the contact block takes the rest (how to reach
  // them). Printing the whole thing in both spots read as padding.
  const sentences = content.about.split(/(?<=\.)\s+/).filter(Boolean);
  const heroBlurb = sentences.length > 1 ? sentences[0] : content.about;
  const aboutRest = sentences.length > 1 ? sentences.slice(1).join(' ') : content.about;

  // Photographs. A document written before photography existed has none, so it
  // falls back to the neutral set rather than to a page with no images, which
  // is the version that was rejected twice.
  const photos = content.photos ?? tradePhotos(null);

  const services = content.services
    .map(
      (s, i) =>
        `<li class="item r"><span class="n">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="ico">${svg(iconFor(s), 21)}</span><h3>${esc(s)}</h3></li>`,
    )
    .join('');

  const ratingPill = content.proof
    ? `<p class="rating r"><span class="stars" aria-hidden="true">${starRow(5, 14)}</span>` +
      `<b>${esc(content.proof.rating.toFixed(1))}</b>` +
      `<span>${esc(content.proof.reviews)} Google reviews</span></p>`
    : '';

  const askBtn = opts.chatEnabled
    ? `<button class="btn btn-ghost" id="askbtn" type="button">Ask a question</button>`
    : '';

  const chat = opts.chatEnabled
    ? `
<button class="chatbtn" id="chatbtn" aria-haspopup="dialog" aria-controls="chat">
  ${svg('spark', 17, 'ico')}Ask a question</button>
<div class="chat" id="chat" role="dialog" aria-modal="false" aria-label="Chat with ${esc(content.businessName)}">
  <header><span class="tile">${brandMark(content.glyph)}</span>
    <strong>${esc(content.businessName)}</strong>
    <button class="x" id="chatx" aria-label="Close chat">&times;</button></header>
  <div class="log" id="chatlog" aria-live="polite"></div>
  <form id="chatform" autocomplete="off">
    <input id="chatin" name="m" placeholder="Type your question" aria-label="Your message" maxlength="500" required>
    <button class="send" type="submit">Send</button>
  </form>
</div>`
    : '';

  const getStarted = opts.checkoutEnabled
    ? `<button class="getstarted z" id="getstarted" type="button">Get started</button>`
    : '';

  // Built from parts, never interpolated into a fixed string, so a missing town
  // shortens the line instead of leaving a hole in it.
  const bandHeading = content.town
    ? `Need ${/^[aeiou]/i.test(content.tradeLabel) ? 'an' : 'a'} ${content.tradeLabel.toLowerCase()} in ${content.town}?`
    : `Need ${/^[aeiou]/i.test(content.tradeLabel) ? 'an' : 'a'} ${content.tradeLabel.toLowerCase()}?`;

  const staffBanner = opts.staff
    ? `<div style="background:#0C2138;color:#fff;padding:8px 16px;font-size:.8rem;text-align:center">` +
      `Internal preview. Nothing on this view is tracked.</div>`
    : '';

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="${esc(content.colours.blue)}">
<link rel="canonical" href="${esc(opts.canonicalUrl)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(opts.canonicalUrl)}">
${opts.ogImageUrl ? `<meta property="og:image" content="${esc(opts.ogImageUrl)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${content.logoUrl ? `<link rel="icon" href="${esc(content.logoUrl)}">` : ''}
<style>${styles(content.colours.accent, content.colours.blue)}</style>
</head>
<body>
${staffBanner}
<header class="head" id="head">
  <div class="wrap headin">
    <div class="brand">
      <span class="bm">${brandMark(content.glyph)}</span>
      <b>${esc(content.businessName)}</b>
    </div>
    <a class="headcall" href="tel:${esc(tel)}" data-tap="1">${svg('phone', 17)}${esc(content.phoneDisplay)}</a>
  </div>
</header>

<main>
  <!-- BEAT 1. Silent labour: the work, photographed, with his name on it. -->
  <section class="hero">
    <img class="shot" src="${esc(photos.hero.src)}" alt="${esc(photos.hero.alt)}"
      fetchpriority="high" decoding="async">
    <div class="scrim"></div>
    <div class="wrap">
      ${ratingPill}
      <p class="kicker r">${esc(content.tagline)}</p>
      <h1 class="name r">${esc(content.businessName)}</h1>
      <p class="blurb r">${esc(heroBlurb)}</p>
      <div class="acts r">
        <a class="btn btn-call" href="tel:${esc(tel)}" data-tap="1">${svg('phone', 19)}Call ${esc(content.phoneDisplay)}</a>
        ${askBtn}
      </div>
    </div>
  </section>

  <!-- BEAT 2. The claim on territory. The one solid rest, no photograph: we
       cannot honestly show HIS town. -->
  <section class="territory">
    <div class="wrap">
      <div class="row"><span class="ico">${svg('pin', 26)}</span>
        <p>${esc(content.bands[0])}</p></div>
    </div>
  </section>

  <!-- BEAT 3. The inventory, counted off beside the work. -->
  <section class="sec">
    <div class="wrap inv">
      <div class="invshot">
        ${
          photos.work
            ? `<img src="${esc(photos.work.src)}" alt="${esc(photos.work.alt)}" loading="lazy" decoding="async">`
            : ''
        }
        <div class="slab bl"><p class="k">Availability</p><p>${esc(content.bands[1])}</p></div>
      </div>
      <div>
        <p class="eyebrow r">Services</p>
        <h2 class="h2 r">What we take care of</h2>
        <p class="lede r">${esc(aboutRest)}</p>
        <ul class="index">${services}</ul>
      </div>
    </div>
  </section>

  ${proofSection(content, photos.outcome)}

  <!-- BEAT 5. The reckoning: the number, as the largest type on the page. -->
  <section class="close">
    <div class="wrap">
      <p class="eyebrow z">${esc(bandHeading)}</p>
      <a class="tel z" href="tel:${esc(tel)}" data-tap="1">${esc(content.phoneDisplay)}</a>
      <p class="where z">${esc(content.bands[0])}${
        // Only ever what the owner typed into the editor. Nothing seeds this at
        // generation: see the note in api/lib/site-demo-generate.ts.
        content.address ? `. ${esc(content.address)}` : ''
      }</p>
      ${getStarted}
    </div>
  </section>
</main>

<footer class="foot">
  <div class="wrap footin">
    <b>${esc(content.businessName)}</b>
    <a href="tel:${esc(tel)}" data-tap="1">${esc(content.phoneDisplay)}</a>
  </div>
</footer>

<a class="callbar" href="tel:${esc(tel)}" data-tap="1">${svg('phone', 18)}Call ${esc(content.phoneDisplay)}</a>
${chat}
<script>
(function(){
  var PAGE=${jsSafe(opts.pageId)}, TOKEN=${jsSafe(opts.beaconToken)}, STAFF=${jsSafe(!!opts.staff)};
  var d=document, root=d.documentElement;
  root.className+=' js';

  // Bottom bar overlaps content on small screens; reserve exactly its height.
  function bar(){
    var b=d.querySelector('.callbar');
    var h=(b && getComputedStyle(b).display!=='none') ? b.offsetHeight : 0;
    root.style.setProperty('--bar', h+'px');
  }
  bar(); addEventListener('resize', bar);

  // The header sits over the opening photograph until the page moves.
  var head=d.getElementById('head');
  function stick(){ if(head) head.classList.toggle('stuck', scrollY > 40); }
  stick(); addEventListener('scroll', stick, {passive:true});

  // Entrances. Never leaves anything hidden: if IntersectionObserver is
  // missing, everything reveals immediately.
  var animated=[].slice.call(d.querySelectorAll('.r,.z,.invshot,.proof .slab'));
  if(!('IntersectionObserver' in window)){
    animated.forEach(function(el){ el.classList.add('in'); });
    var s0=d.querySelector('.scrim'); if(s0) s0.classList.add('in');
  } else {
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var el=e.target, p=el.parentNode;
        // The service list counts itself off; nothing else staggers.
        var listed=p && p.classList.contains('index');
        var delay=listed ? ([].indexOf.call(p.children, el)*55) : 0;
        setTimeout(function(){ el.classList.add('in'); }, delay);
        io.unobserve(el);
      });
    },{rootMargin:'0px 0px -8% 0px', threshold:.08});
    animated.forEach(function(el){ io.observe(el); });
    // Beat 1 is above the fold: the scrim lifts and the title rises on load
    // rather than waiting for a scroll that may never come.
    requestAnimationFrame(function(){
      var above=d.querySelectorAll('.hero .r,.scrim');
      for(var i=0;i<above.length;i++) above[i].classList.add('in');
    });
  }

  // Beacons. Staff views carry no token and send nothing at all.
  function beacon(type, meta){
    if(STAFF || !TOKEN) return;
    try{
      var body=JSON.stringify({page_id:PAGE, token:TOKEN, type:type, meta:meta||{}});
      if(navigator.sendBeacon){
        navigator.sendBeacon('/api/site-demo/track', new Blob([body],{type:'application/json'}));
      } else {
        fetch('/api/site-demo/track',{method:'POST',body:body,headers:{'content-type':'application/json'},keepalive:true});
      }
    }catch(e){}
  }
  beacon('open');
  d.addEventListener('click', function(e){
    var a=e.target && e.target.closest && e.target.closest('[data-tap]');
    if(a) beacon('phone_tap');
  });

  // Chat.
  var btn=d.getElementById('chatbtn'), panel=d.getElementById('chat');
  if(btn && panel){
    // The launcher floats over the page, so it has to get out of the way of
    // anything it would otherwise cover. It stays down until the opening frame
    // is behind us, and it hides again whenever a real call or checkout button
    // is on screen: on a phone the pill sat exactly on top of both.
    var ctas=[].slice.call(d.querySelectorAll('.btn-call,.getstarted')), ctaOn=0;
    function reveal(){
      if(panel.hasAttribute('open')) return;
      if(scrollY > innerHeight*0.7 && !ctaOn) btn.classList.add('show');
      else btn.classList.remove('show');
    }
    if('IntersectionObserver' in window && ctas.length){
      var cio=new IntersectionObserver(function(es){
        for(var i=0;i<es.length;i++) es[i].target.ctaVisible=es[i].isIntersecting;
        ctaOn=0;
        for(var j=0;j<ctas.length;j++) if(ctas[j].ctaVisible) ctaOn++;
        reveal();
      },{threshold:.35});
      ctas.forEach(function(el){ cio.observe(el); });
    }
    reveal(); addEventListener('scroll', reveal, {passive:true});
    var log=d.getElementById('chatlog'), form=d.getElementById('chatform'), input=d.getElementById('chatin');
    var sid=String(Date.now())+Math.random().toString(36).slice(2,8);
    var started=false, busy=false;
    function add(role, text){
      var p=d.createElement('div');
      p.className='msg '+(role==='you'?'you':'them');
      p.textContent=text; log.appendChild(p); log.scrollTop=log.scrollHeight;
      return p;
    }
    function open(){
      panel.setAttribute('open','');
      btn.classList.add('show');
      if(!started){ started=true; add('them', ${jsSafe(content.chatGreeting)}); }
      input.focus();
    }
    function close(){ panel.removeAttribute('open'); reveal(); }
    btn.addEventListener('click', open);
    var ask=d.getElementById('askbtn');
    if(ask) ask.addEventListener('click', open);
    d.getElementById('chatx').addEventListener('click', close);
    d.addEventListener('keydown', function(e){ if(e.key==='Escape' && panel.hasAttribute('open')) close(); });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var text=(input.value||'').trim();
      if(!text || busy) return;
      input.value=''; add('you', text); busy=true;
      var wait=d.createElement('div'); wait.className='msg wait'; wait.textContent='Typing';
      log.appendChild(wait); log.scrollTop=log.scrollHeight;
      fetch('/api/site-demo/chat',{
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({page_id:PAGE, token:TOKEN, session_id:sid, message:text})
      }).then(function(r){ return r.json(); }).then(function(j){
        wait.remove(); busy=false;
        add('them', (j && j.reply) || 'Sorry, I could not get through just then. Give the number above a ring.');
      }).catch(function(){
        wait.remove(); busy=false;
        add('them', 'Sorry, I could not get through just then. Give the number above a ring.');
      });
    });
  }

  // Checkout.
  var gs=d.getElementById('getstarted');
  if(gs){
    gs.addEventListener('click', function(){
      gs.disabled=true; gs.textContent='One moment';
      fetch('/api/site-demo/checkout',{
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({page_id:PAGE, token:TOKEN})
      }).then(function(r){ return r.json(); }).then(function(j){
        if(j && j.url){ location.href=j.url; return; }
        gs.disabled=false; gs.textContent='Get started';
      }).catch(function(){ gs.disabled=false; gs.textContent='Get started'; });
    });
  }
})();
</script>
</body>
</html>`;
}
