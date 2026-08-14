// Which builders on the roster can actually reach a given house, so a VA
// booking a viewing is never one drag-and-drop away from sending someone
// four hours up the motorway. Pure module, safe to import into the browser.

export interface BuilderRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  coverage: string[];
  active: boolean;
}

/**
 * Builders whose coverage list matches a property's postcode outcode: exact
 * outcode first (e.g. "LE7"), falling back to a bare area prefix (e.g. "LE"
 * covering the whole Leicester area) only when nobody covers the outcode
 * exactly. Inactive builders and non-matches are dropped outright rather
 * than ranked in — silence over a guessed "nearest" builder.
 */
export function matchBuildersForOutcode(builders: readonly BuilderRow[], outcode: string | null): BuilderRow[] {
  if (!outcode) return [];
  const active = builders.filter((b) => b.active);
  const exact = active.filter((b) => b.coverage.includes(outcode));
  if (exact.length) return exact;
  const areaLetters = outcode.match(/^[A-Z]{1,2}/)?.[0] ?? '';
  if (!areaLetters) return [];
  return active.filter((b) => b.coverage.includes(areaLetters));
}
