// The stress test must REUSE the fences, never grow its own.
//
// Written 2026-08-15. This file does not test behaviour, it tests structure,
// because the failure it exists to prevent is invisible in behaviour: somebody
// adds a second currency parser or a second checklist to deal-stress-test.ts,
// both parsers agree for a year, and then one day they disagree about
// "GBP 63k" and an offer goes out that nobody authorised.
//
// Two places deciding one fact is the bug this codebase keeps having: the
// comps count (Welwyn Park Road), the size blind valuation (39 Orion Way), the
// duplicate competitor lists (uk-places.ts). Each one was two opinions where
// there should have been one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHECKLIST_KEYS } from '../api/lib/deal-state';
import { COCKPIT_ACTIONS, ACTION_EXECUTION, ACTION_LABEL } from '../api/lib/deal-stress-test';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SRC = read('api/lib/deal-stress-test.ts');

describe('it borrows the fences rather than rebuilding them', () => {
  it('gets the figure fence from deal-state, the one the Manager is judged by', () => {
    expect(SRC).toMatch(/import \{[\s\S]*?figuresIn[\s\S]*?figuresAreOnFile[\s\S]*?\} from '\.\/deal-state\.js'/);
  });

  it('gets the raise, hold or pass decision from counter-position, in code', () => {
    // "A model asked 'should we go up?' finds a reason to say yes." The
    // decision is made in counter-position.ts and nowhere else.
    expect(SRC).toMatch(/import \{ decideCounter, respectsCeiling[\s\S]*?\} from '\.\/counter-position\.js'/);
    // Since 16 Aug the cap the decision respects is the HIGHER of the
    // engine's ceiling and the one Hugo wrote in the pinned note: the engine
    // prices the house, Hugo prices the appetite.
    expect(SRC).toContain('respectsCeiling(decision, cap)');
    expect(SRC).toMatch(/Math\.max\(state\.money\.ceiling \?\? 0, state\.money\.pinnedCeiling \?\? 0\)/);
  });

  it('gets the street from next-step-brief', () => {
    expect(SRC).toMatch(/import \{ streetOf \} from '\.\/next-step-brief\.js'/);
  });

  it('imports the checklist rather than re-listing it', () => {
    expect(SRC).toMatch(/CHECKLIST_KEYS/);
    // Every key it puts into plain English is a key that really exists. A word
    // for a key nobody writes is a check that can never pass.
    const words = SRC.match(/const CHECKLIST_WORDS[\s\S]*?\n\};/)?.[0] ?? '';
    for (const key of CHECKLIST_KEYS) expect(words).toContain(`${key}:`);
  });

  it('does not grow its own currency parser', () => {
    // figuresIn() is the only thing allowed to decide what a figure is. A
    // second regex over pounds here is the exact drift this file prevents.
    const parsers = SRC.match(/\/\([^/]*(?:GBP|£)[^/]*\)?[^/]*\/[gimsuy]*/g) ?? [];
    expect(parsers).toEqual([]);
  });

  it('does not grow its own comps counter', () => {
    // compCount() reads three different shapes valuation.py has written comps
    // in. Counting them again here would be a fourth opinion.
    //
    // The check is on COMPUTATION, not on the word: 'deal.cmv.audit' appears
    // as an `evidence:` label naming a DealState path, which is documentation
    // rather than a second counter.
    expect(SRC).not.toMatch(/n_used/);
    expect(SRC).not.toMatch(/Array\.isArray\([^)]*(?:audit|evidence)/);
    expect(SRC).not.toMatch(/compCount\(/);
    expect(SRC).toContain('state.pack.compsCount');
  });
});

describe('it stays pure, so every check is testable with fixtures', () => {
  it('takes the clock as an argument rather than reading the wall', () => {
    expect(SRC).toContain('now: Date');
    expect(SRC).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });

  it('touches no database and no network', () => {
    // On what it DOES, not on what it mentions: ACTION_EXECUTION.via describes
    // 'supabase.functions.invoke wk-email-send' as prose, because naming where
    // an action really runs is the whole point of that table.
    expect(SRC).not.toMatch(/createClient\(/);
    expect(SRC).not.toMatch(/\bfetch\(/);
    expect(SRC).not.toMatch(/process\.env/);
    expect(SRC).not.toMatch(/from '@supabase/);
    // Its only imports are the three pure modules it borrows fences from.
    const imports = [...SRC.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      './counter-position.js', './deal-state.js', './next-step-brief.js',
    ]);
  });
});

describe('the closed vocabulary is total', () => {
  it('gives every action a label and a place it runs', () => {
    for (const a of COCKPIT_ACTIONS) {
      expect(ACTION_LABEL[a], `${a} has no label`).toBeTruthy();
      expect(ACTION_EXECUTION[a], `${a} has no execution`).toBeTruthy();
    }
    expect(Object.keys(ACTION_LABEL).sort()).toEqual([...COCKPIT_ACTIONS].sort());
    expect(Object.keys(ACTION_EXECUTION).sort()).toEqual([...COCKPIT_ACTIONS].sort());
  });

  it('sends nothing itself: the ones that leave the building are the client\'s', () => {
    // The plan's rule 3: the Manager drafts nothing and sends nothing. A call
    // is placed by the browser's Twilio device and an email by an edge
    // function, so this module can only ever describe them.
    expect(ACTION_EXECUTION.call_branch.by).toBe('client');
    expect(ACTION_EXECUTION.send_email.by).toBe('client');
    expect(ACTION_EXECUTION.compare_comps.by).toBe('none');
  });

  it('routes every draft through the email route that already carries the fences', () => {
    for (const a of COCKPIT_ACTIONS.filter((x) => x.startsWith('draft_'))) {
      expect(ACTION_EXECUTION[a].via).toContain('/api/crm/draft-offer-email');
    }
  });
});

describe('house rules', () => {
  it('ends every relative import with .js, because api/ is node16', () => {
    const rel = SRC.match(/from '(\.[^']+)'/g) ?? [];
    expect(rel.length).toBeGreaterThan(0);
    for (const r of rel) expect(r).toMatch(/\.js'$/);
  });

  it('writes no long dashes and no curly punctuation anywhere', () => {
    // The long-dash DETECTOR has to contain the characters it bans, exactly as
    // deal-manager-contract.ts does. Strip the character class, then the rest
    // of the file must be clean.
    const withoutDetector = SRC.replace(/\/\[–—\]\//g, '/[DASHES]/');
    expect(withoutDetector).not.toMatch(/[–—‘’“”…]/);
    // And the detector is still there, doing its job.
    expect(SRC).toMatch(/\/\[–—\]\/\.test\(text\)/);
  });
});
