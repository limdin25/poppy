import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOSTUNICO_OBJECTIONS, HOSTUNICO_OBJECTIONS_SEED, HOSTUNICO_OBJECTION_PLAYBOOK } from '../supabase/functions/_shared/hostunico-objections';
import { HOSTUNICO_MARKET_FEE_LINE } from '../supabase/functions/_shared/hostunico-pricing';
import { hostunicoCoachRequest } from '../supabase/functions/_shared/hostunico-coach-request';

// The coach playbook and the wk_objections seed are generated from the same
// data by scripts/hostunico-objections.mjs. This fails if they drift apart.

const LONG_DASH = /[‒-―‘’“”…]/;
const seedSql = readFileSync(resolve(__dirname, '../supabase/migrations', HOSTUNICO_OBJECTIONS_SEED), 'utf8');
const seed = JSON.parse(seedSql.split('$seed$')[1]) as { category: string; objection: string; best_rebuttal: string; times_heard: number; example_quotes: string[]; call_ids: string[]; desk: string; sort_order: number }[];

describe('the objections playbook', () => {
  it('matches the seeded table, entry for entry', () => {
    expect(HOSTUNICO_OBJECTIONS.length).toBeGreaterThanOrEqual(15);
    expect(HOSTUNICO_OBJECTIONS.length).toBeLessThanOrEqual(25);
    expect(HOSTUNICO_OBJECTIONS).toEqual(seed.slice(0, HOSTUNICO_OBJECTIONS.length).map((r) => ({ category: r.category, objection: r.objection, rebuttal: r.best_rebuttal, timesHeard: r.times_heard })));
  });
  it('seeds between 20 and 40 categories on the sa desk, most heard first', () => {
    expect(seed.length).toBeGreaterThanOrEqual(20);
    expect(seed.length).toBeLessThanOrEqual(40);
    expect(seed.every((r) => r.desk === 'sa')).toBe(true);
    expect(seed.map((r) => r.times_heard)).toEqual([...seed.map((r) => r.times_heard)].sort((a, b) => b - a));
  });
  it('has no long dashes, curly quotes or contact details anywhere', () => {
    expect(seedSql).not.toMatch(LONG_DASH);
    expect(HOSTUNICO_OBJECTION_PLAYBOOK).not.toMatch(LONG_DASH);
    for (const r of seed) for (const q of r.example_quotes) expect(q).not.toMatch(/\d{5,}|@\w|\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/);
  });
  it('always carries the fee comparison and never contradicts the pricing rules', () => {
    expect(seed.some((r) => r.best_rebuttal.includes(HOSTUNICO_MARKET_FEE_LINE))).toBe(true);
    for (const r of seed) {
      expect(r.best_rebuttal).not.toMatch(/WhatsApp|we guarantee|you.ll definitely|onboarding fee of/i);
      if (/\b15 (?:and|to) 20\b/.test(r.best_rebuttal)) expect(r.best_rebuttal).toContain(HOSTUNICO_MARKET_FEE_LINE);
      if (/percent|%/.test(r.best_rebuttal)) expect(r.best_rebuttal).toMatch(/9 percent plus VAT/);
    }
  });
  it('is in the live coach request and stays short enough not to slow it', () => {
    expect(hostunicoCoachRequest({ model: 'gpt-5.4-mini', userMsg: '{}', latestCaller: 'hi' }).messages[1].content).toBe(HOSTUNICO_OBJECTION_PLAYBOOK);
    expect(HOSTUNICO_OBJECTION_PLAYBOOK.length).toBeLessThan(6000);
  });
});
