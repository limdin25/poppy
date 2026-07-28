// Small shared pieces: escaping, the icon set, and the keyword matcher that
// decides which icon a service line gets.
//
// SPLIT OUT so chrome.ts and pages.ts can both use them without importing each
// other. Nothing here knows anything about the page or the business.

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
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  tick: '<path d="M20 6 9.5 17 4 11.5"/>',
  calendar:
    '<path d="M4 6h16v15H4zM4 10h16M8 3v4M16 3v4"/><path d="M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2"/>',
  people:
    '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.4A5.6 5.6 0 0 1 21.5 20"/>',
  book: '<path d="M4 4h7a2.5 2.5 0 0 1 2.5 2.5V21A2 2 0 0 0 11.5 19H4Z"/><path d="M20 4h-7a2.5 2.5 0 0 0-2.5 2.5V21a2 2 0 0 1 2-2H20Z"/>',
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
export const SERVICE_ICONS: Array<[RegExp, string]> = [
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

export function svg(name: string, size = 24, cls = 'ico'): string {
  const d = ICONS[name] || ICONS.wrench;
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`
  );
}

/** The trade's own mark, used in the header lockup. */
export function brandMark(key: string): string {
  const d = ICONS[key] || ICONS.wrench;
  return (
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `focusable="false">${d}</svg>`
  );
}


/** Five stars at a fixed size, for the rating row and the proof card. */
export function starRow(n = 5, size = 15): string {
  return Array.from({ length: n }, () => svg('star', size, 'st')).join('');
}

/** Safe to drop inside a <script> string literal. */
export function jsSafe(v: unknown): string {
  return JSON.stringify(v ?? null).replace(/</g, '\\u003c');
}
