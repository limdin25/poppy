// The two rules the cockpit's server side cannot break, and one bug that must
// never come back.
//
// Written 2026-08-15.
//
//   THE AI DECIDES ATTENTION AND WORDS. CODE DECIDES MONEY AND MOVES.
//
// In code that means two things, and both are structural rather than
// behavioural, so they are checked by reading the source: no route the cockpit
// owns may write a pipeline column, and none may send anything. Cards move
// because api/crm/property-outcome.ts moves them, exactly as they did before
// any of this existed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MANAGER = read('api/crm/deal-manager.ts');
const BRAIN = read('api/lib/deal-brain.ts');

describe('the call history bug, pinned', () => {
  // Found 2026-08-15 while building the cockpit on top of this route, and
  // confirmed against the live database: wk_calls has columns
  // disposition_column_id, duration_sec, direction, created_at, script_key and
  // contact_id. There is no `disposition`.
  //
  // Selecting a column that does not exist is not a null, it is an error.
  // PostgREST refuses the whole query, supabase-js puts it in `error`, and the
  // route's `cls ?? []` turned that into an empty list without a word. So from
  // the day this route shipped, EVERY deal reported zero calls: nobody had ever
  // rung anybody, `clock.lastTouchAt` ignored the phone entirely, and a branch
  // called an hour ago could read as untouched for three days.

  it('never selects a bare `disposition` off wk_calls again', () => {
    const select = MANAGER.match(/from\('wk_calls'\)[\s\S]{0,200}?\)/)?.[0] ?? '';
    expect(select).toContain('disposition_column_id');
    expect(select).not.toMatch(/[^_]disposition[,'\s]/);
  });

  it('resolves the outcome to a board column name', () => {
    // The outcome of a call IS the column the agent dropped it into, so the
    // name needs a lookup rather than a column read.
    expect(MANAGER).toContain('wk_pipeline_columns');
    expect(MANAGER).toMatch(/columnById/);
    expect(MANAGER).toMatch(/disposition: k\.disposition_column_id/);
  });

  it('reads the column table once, not once per call', () => {
    const reads = MANAGER.match(/from\('wk_pipeline_columns'\)/g) ?? [];
    expect(reads.length).toBe(1);
  });
});

describe('there is ONE brain, and both callers use it', () => {
  it('defines assess once, in a lib, so a Node cron never imports an edge route', () => {
    // It lived in the route while one edge route was the only caller. The
    // sweep is a Node function, and importing an edge-configured route into a
    // Node function is a bundler risk not worth taking to save a file.
    expect(BRAIN).toMatch(/export async function assess\(/);
    expect(MANAGER).not.toMatch(/export async function assess\(/);
  });

  it('still reaches assess from the route, so nothing that depended on it moved', () => {
    expect(MANAGER).toMatch(/import \{ assess \} from '\.\.\/lib\/deal-brain\.js'/);
    expect(MANAGER).toMatch(/export \{ assess \}/);
  });

  it('kept the prompt word for word when it moved', () => {
    // A moved prompt that quietly changed is a moved prompt that produces
    // different instructions, and nobody would know which change did it.
    for (const line of [
      'WHAT YOU DECIDE: attention, and words. Nothing else.',
      'NEVER name a figure that is not already in the state you are given',
      'You may NOT move a card, send a message, or promise anything',
      'NEVER use a long dash',
    ]) {
      expect(BRAIN).toContain(line);
    }
    expect(BRAIN).toContain("DEAL_MANAGER_MODEL = 'claude-sonnet-5'");
  });

  it('still answers the Today list, which is what TodayPanel reads', () => {
    // This route is the kill-switch product: deterministic, no model, correct
    // with the brain switched off. It must keep working exactly as it does.
    expect(MANAGER).toMatch(/today: ranked\.map/);
    expect(MANAGER).toMatch(/managerEnabled: on/);
  });

  it('still falls back rather than erroring when the model misbehaves', () => {
    expect(MANAGER).toMatch(/fallbackVerdict\(state\)/);
    expect(MANAGER).toMatch(/source: 'fallback'/);
  });
});
