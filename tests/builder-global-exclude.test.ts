// A builder who said no to ANY house must not reappear as a fresh lead.
//
// Pedro, 2026-09-10: he rang builders who had already told him they were not
// interested on a different property, and Find builders showed their numbers
// again with no flag. Same day he asked to mark builders who charge to view so
// he can skip them forever.
//
// Per-property `not_interested` stays exactly that. The two new outcomes write
// onto the builder roster itself, and every desk that lists builders must
// honour the flag.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CALL_OUTCOMES,
  GLOBAL_EXCLUDE_OUTCOMES,
  isCallOutcome,
  excludeReasonLabel,
  isGloballyExcluded,
} from '../api/lib/builder-outreach';

const TABLE = readFileSync('src/features/crm/components/builders/BuilderTable.tsx', 'utf8');
const ROUTE = readFileSync('api/crm/find-builders.ts', 'utf8');
const LIB = readFileSync('api/lib/builder-outreach.ts', 'utf8');

describe('global exclude outcomes', () => {
  it('offers both forever-flags Pedro asked for', () => {
    expect(CALL_OUTCOMES.map((o) => o.id)).toContain('not_interested_any');
    expect(CALL_OUTCOMES.map((o) => o.id)).toContain('charges_to_view');
    expect(isCallOutcome('not_interested_any')).toBe(true);
    expect(isCallOutcome('charges_to_view')).toBe(true);
  });

  it('keeps per-property not_interested separate from the forever flag', () => {
    expect(CALL_OUTCOMES.map((o) => o.id)).toContain('not_interested');
    expect(GLOBAL_EXCLUDE_OUTCOMES.has('not_interested')).toBe(false);
    expect(GLOBAL_EXCLUDE_OUTCOMES.has('not_interested_any')).toBe(true);
    expect(GLOBAL_EXCLUDE_OUTCOMES.has('charges_to_view')).toBe(true);
  });

  it('names the reason in words Pedro can read on the next house', () => {
    expect(excludeReasonLabel('not_interested_any')).toMatch(/not interested/i);
    expect(excludeReasonLabel('charges_to_view')).toMatch(/charg/i);
    expect(excludeReasonLabel(null)).toBeNull();
  });

  it('treats any stored exclude_reason as globally excluded', () => {
    expect(isGloballyExcluded({ exclude_reason: 'charges_to_view' })).toBe(true);
    expect(isGloballyExcluded({ exclude_reason: null })).toBe(false);
    expect(isGloballyExcluded({})).toBe(false);
  });

  it('the screen and the server offer the same outcome ids', () => {
    const ids = (src: string) =>
      (src.match(/id: '([a-z_]+)', label:/g) ?? []).sort().join('|');
    expect(ids(TABLE)).toBe(ids(LIB));
    expect(ids(TABLE)).toMatch(/not_interested_any/);
    expect(ids(TABLE)).toMatch(/charges_to_view/);
  });

  it('recording a forever outcome writes the builder roster, not only the row', () => {
    expect(LIB).toMatch(/GLOBAL_EXCLUDE_OUTCOMES\.has\(outcome\)/);
    expect(LIB).toMatch(/exclude_reason: outcome/);
    expect(LIB).toMatch(/\.from\('brrr_builders'\)/);
  });

  it('Find builders surfaces the flag and will not invite an excluded builder', () => {
    expect(ROUTE).toMatch(/exclude_reason/);
    expect(ROUTE).toMatch(/excludeReasonLabel|isGloballyExcluded|excluded/);
    expect(TABLE).toMatch(/excludeReason|excluded|Not interested, any|Charges to view/);
  });

  it('drafting invites skips builders already marked forever', () => {
    expect(LIB).toMatch(/exclude_reason/);
    // The draft loop must not create a fresh invite for a forever-flagged builder.
    const draft = LIB.slice(LIB.indexOf('export async function draftOutreachForProperty'));
    expect(draft.slice(0, 2500)).toMatch(/exclude_reason|isGloballyExcluded|GLOBAL_EXCLUDE/);
  });
});
