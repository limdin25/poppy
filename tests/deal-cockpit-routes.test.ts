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
const COCKPIT = read('api/crm/cockpit.ts');
const RUN = read('api/lib/deal-manager-run.ts');
const SWEEP = read('api/cron/deal-sweep.ts');
const COCKPIT_FILES = { COCKPIT, RUN, SWEEP };

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

describe('THE AI NEVER MOVES A CARD', () => {
  // AI_DEAL_MANAGER_PLAN guardrail 2: "The Manager's route has no code path
  // that touches pipeline_column_id. Stage moves stay with the outcome route
  // and human drags. stage_mismatch is a flag for Hugo, never a correction."
  //
  // Hugo asked for "a seamless pipeline that moves automatically as we
  // execute", and it does: the button calls the route that already moves the
  // card. What must never happen is the machine moving one on its own.

  for (const [name, src] of Object.entries(COCKPIT_FILES)) {
    it(`${name} never writes a pipeline column`, () => {
      expect(src).not.toMatch(/pipeline_column_id[\s\S]{0,80}?\.update\(/);
      expect(src).not.toMatch(/\.update\([\s\S]{0,120}?pipeline_column_id/);
    });
  }

  it('leaves the one place cards do move exactly where it was', () => {
    const outcome = read('api/crm/property-outcome.ts');
    expect(outcome).toMatch(/pipeline_column_id/);
  });
});

describe('THE AI NEVER SENDS ANYTHING', () => {
  // Guardrail 3: "The Manager drafts nothing and sends nothing. A human clicks
  // send, always." A call is placed by the browser's Twilio device and an
  // email by an edge function, so no server file here may reach either.

  for (const [name, src] of Object.entries(COCKPIT_FILES)) {
    it(`${name} sends no email and no text`, () => {
      expect(src).not.toMatch(/wk-email-send/);
      expect(src).not.toMatch(/\bsendEmail\(/);
      expect(src).not.toMatch(/\bsendSMS\(/);
      expect(src).not.toMatch(/wk-sms-send/);
      expect(src).not.toMatch(/wk-calls-create/);
    });
  }
});

describe('a page load is never a model call', () => {
  it('the cockpit read does not import the model at all', () => {
    // The instructions come out of the log, which the sweep fills in the
    // background. Assessing on demand would be a bill that scales with how
    // often somebody glances at the screen.
    expect(COCKPIT).not.toMatch(/callLLM/);
    expect(COCKPIT).not.toMatch(/deal-brain/);
    expect(COCKPIT).not.toMatch(/assess\(/);
  });

  it('reads the log through the CALLER, so RLS applies Hugo\'s lane', () => {
    // A filter in the route could be forgotten by the next person. A policy
    // cannot. Every wk_deal_manager_log read must go through `caller`.
    expect(COCKPIT).toMatch(/dealLog\(caller/);
    expect(COCKPIT).toMatch(/latestAssessments\(caller/);
    expect(COCKPIT).not.toMatch(/latestAssessments\(supabase/);
    expect(COCKPIT).not.toMatch(/dealLog\(supabase/);
  });

  it('lets code set the floor on attention, so a model cannot bury a reply', () => {
    expect(COCKPIT).toMatch(/Math\.max\(floor, assessment\?\.attention \?\? 0\)/);
  });

  it('renders a stale instruction rather than a blank card', () => {
    expect(COCKPIT).toMatch(/stale = Boolean\(assessment && assessment\.state_hash !== hash\)/);
  });
});

describe('the sweep fails closed and loudly', () => {
  it('does nothing at all when the flag is off', () => {
    expect(SWEEP).toMatch(/cfg\.enabled !== true/);
    expect(SWEEP).toMatch(/skipped: 'manager_off'/);
  });

  it('treats unreadable settings as off', () => {
    expect(SWEEP).toMatch(/catch \{ cfg = \{\}; \}/);
  });

  it('logs the budget cap exactly once, so the cap cannot flood the history', () => {
    expect(RUN).toMatch(/refused_reason: 'budget_capped'/);
    const capBlock = RUN.match(/if \(spent >= cap\)[\s\S]*?return \{ \.\.\.base, capped: true \};/)?.[0] ?? '';
    expect((capBlock.match(/logEvent\(/g) ?? []).length).toBe(1);
  });

  it('never lets one bad property stop the run', () => {
    expect(RUN).toMatch(/failed \+= 1;/);
    expect(RUN).toMatch(/One bad property must never stop the run/);
  });

  it('never lets a logging failure break a press', () => {
    expect(RUN).toMatch(/export async function logEvent[\s\S]*?try \{[\s\S]*?\} catch/);
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

  it('gives the model room to think before it answers', () => {
    // MEASURED 2026-08-15 on the live board: at 700 tokens SIX OF SEVEN
    // assessments came back empty. claude-sonnet-5 emits a thinking block
    // before its answer and both come out of the same budget, so a rich deal
    // spent the lot thinking and the text block never arrived. The fences all
    // behaved (every one fell back to the brief and logged model_silent), but
    // a brain that is silent six times out of seven is not a brain.
    expect(BRAIN).toMatch(/DEAL_MANAGER_MAX_TOKENS = 2000/);
    expect(BRAIN).not.toMatch(/\], 700\)/);
  });

  it('is told the three things it got wrong on real data', () => {
    // Found by reading the first live assessments rather than by guessing.
    // Plain English, not field names: it was writing "still_available,
    // why_selling, condition_notes" into an instruction a person reads out.
    expect(BRAIN).toMatch(/NEVER IN FIELD NAMES/);
    // The offer ladder's rungs are legitimately on file, and it was raising
    // figure_mismatch about them.
    expect(BRAIN).toMatch(/INCLUDES the rungs of the offer ladder/);
    // It addressed work to a VA. There is no VA.
    expect(BRAIN).toMatch(/There is no VA on this team/);
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
