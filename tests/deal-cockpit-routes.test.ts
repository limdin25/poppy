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
const ACTION = read('api/crm/cockpit-action.ts');
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

describe('THE MACHINE NEVER MOVES A CARD', () => {
  // AI_DEAL_MANAGER_PLAN guardrail 2, read precisely. The rule was never "no
  // card ever moves from the cockpit", it was that the AI decides attention and
  // words while code and humans decide money and moves. Hugo, 2026-08-16: "if
  // the action needed is to move pipeline we can do from the cockpit."
  //
  // So there is exactly ONE pipeline write here, it is `move_stage`, and it can
  // only be reached by a human pressing a button and picking a stage.

  it('the read-only route and the sweep write no column at all', () => {
    for (const src of [COCKPIT, RUN, SWEEP]) {
      expect(src).not.toMatch(/pipeline_column_id/);
    }
  });

  it('the action route writes a column in exactly one place, and it is move_stage', () => {
    // Exactly one mention in the whole file, and it is the update itself.
    const writes = ACTION.match(/pipeline_column_id/g) ?? [];
    expect(writes.length).toBe(1);
    const moveCase = ACTION.match(/case 'move_stage': \{[\s\S]*?break;\n      \}/)?.[0] ?? '';
    expect(moveCase).toMatch(/pipeline_column_id: body\.columnId/);
    // It refuses rather than guessing when the human has not picked one.
    expect(moveCase).toMatch(/refused: 'no_stage'/);
  });

  it('no assessment can reach it: the AI has no move_stage to choose', () => {
    // The contract is the closed list of what the model may pick. move_stage is
    // deliberately not in it, so the only route to a pipeline write is a press.
    const contract = read('api/lib/deal-manager-contract.ts');
    expect(contract).not.toMatch(/move_stage/);
  });

  it('leaves the one place cards move on an outcome exactly where it was', () => {
    const outcome = read('api/crm/property-outcome.ts');
    expect(outcome).toMatch(/pipeline_column_id/);
  });
});

describe('the stage picker cannot move a house onto another business\'s board', () => {
  // Caught in a screenshot on 2026-08-16: the picker offered SIXTEEN stages
  // where there are fifteen. `Not interested` exists on the property board AND
  // on the HeyPubli Creators board, so filtering columns by NAME alone offered
  // both, and picking the wrong one would have moved a house onto a completely
  // different business's pipeline.

  it('scopes the stages to one pipeline, found by a column unique to it', () => {
    expect(COCKPIT).toMatch(/c\.name === 'Ballpark agreed'/);
    expect(COCKPIT).toMatch(/propertyPipelineId/);
    expect(COCKPIT).toMatch(/c\.pipeline_id === propertyPipelineId/);
  });

  it('still filters by the property stage list as well', () => {
    expect(COCKPIT).toMatch(/PROPERTY_STAGES\.includes\(c\.name\)/);
  });

  it('offers no VSL video-funnel column as somewhere to put a house', () => {
    const list = COCKPIT.match(/const PROPERTY_STAGES = \[[\s\S]*?\];/)?.[0] ?? '';
    for (const vsl of ['Rendering', 'Video sent', 'Watched video', 'Checkout started', 'Paid']) {
      expect(list, vsl).not.toContain(vsl);
    }
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

  it('speaks in orders, not essays (Hugo, 16 Aug: "small texts")', () => {
    // "just tell exactly what the intelligence is asking us to do for next
    // step ... the brain has to run the show". The instruction is an order of
    // at most 2 short sentences, and the prompt carries worked examples of the
    // shape so the model copies it.
    expect(BRAIN).toMatch(/an ORDER, not an explanation/);
    expect(BRAIN).toMatch(/at most 2 short sentences and under 40 words/);
    expect(BRAIN).toContain('Send it for call two, the ballpark is 62,000');
    expect(BRAIN).toContain('Reply with the counter at 99,000');
    // The backstop when it rambles anyway lives in the contract, tightened
    // from 600 with the same change. A bumped prompt re-judges the board.
    const contract = read('api/lib/deal-manager-contract.ts');
    expect(contract).toMatch(/instruction\.length > 320/);
    // The number itself bumps freely; what is pinned is that it exists and is
    // folded into the hash, so a prompt rewrite can never sit invisible.
    expect(contract).toMatch(/export const PROMPT_VERSION = \d+/);
    expect(read('api/lib/deal-manager-run.ts')).toMatch(/promptVersion: PROMPT_VERSION/);
  });

  it('has ears: the transcript is ground truth, a callback is an appointment, the process is two calls', () => {
    // Paterson Road, 16 Aug. A 12 minute recorded discovery call, Pedro's own
    // note saying "call back monday", and the brain ordered a Sunday re-ring
    // to re-ask all twelve questions, because the checklist was never typed up
    // and the checklist was all it could see.
    expect(BRAIN).toMatch(/THE TRANSCRIPT IS THE GROUND TRUTH/);
    expect(BRAIN).toMatch(/NEVER order anyone to ring and re-ask something the transcript already answers/);
    expect(BRAIN).toMatch(/A CALLBACK PROMISE IS AN APPOINTMENT/);
    expect(BRAIN).toMatch(/THE PROCESS IS TWO CALLS WITH HOMEWORK IN BETWEEN/);
    // The ears themselves: the RPC ships the note and the transcript, the
    // state carries them, and the contract lets the brain order the homework.
    const ears = read('supabase/migrations/20260816000002_cockpit_hears_the_call.sql');
    expect(ears).toMatch(/'agent_note', k\.agent_note/);
    expect(ears).toMatch(/wk_live_transcripts/);
    expect(ears).toMatch(/'transcript', tx\.lines/);
    const state = read('api/lib/deal-state.ts');
    expect(state).toMatch(/conversation:/);
    expect(state).toMatch(/TRANSCRIPT_CAP/);
    const contract = read('api/lib/deal-manager-contract.ts');
    expect(contract).toMatch(/'get_the_ballpark'/);
  });

  it('sees the whole office, not just the named contact (Lexi\'s rejection)', () => {
    // Orion Way, 16 Aug: lexi@ddmresidential.co.uk rejected the offer and the
    // deal said "no reply", because inbound routing files unknown senders onto
    // twin contacts and the branch card had no email. Messages now include
    // SATELLITES: same company domain, no properties of their own.
    const sql = read('supabase/migrations/20260816000003_satellite_email_contacts.sql');
    const ts = read('api/lib/satellite-contacts.ts');

    // The freemail lists are the same list in two languages. Drift here means
    // the brain and the timeline disagree about whose emails belong to a deal.
    const tsList = [...ts.matchAll(/'([a-z0-9.-]+\.[a-z.]+)'/g)].map((m) => m[1]);
    const sqlBlock = sql.match(/not in \(([\s\S]*?)\)/)?.[1] ?? '';
    const sqlList = [...sqlBlock.matchAll(/'([a-z0-9.-]+\.[a-z.]+)'/g)].map((m) => m[1]);
    expect(tsList.length).toBeGreaterThan(5);
    expect(new Set(sqlList)).toEqual(new Set(tsList));

    // Same-domain contacts holding properties are sibling BRANCHES, never
    // merged, in both implementations.
    expect(sql).toMatch(/not exists \(\s*select 1 from brrr_properties pb where pb\.wk_contact_id = c2\.id/);
    expect(ts).toMatch(/brrr_properties/);

    // And the timeline actually uses the rule.
    expect(read('api/lib/deal-timeline.ts')).toMatch(/satelliteContactIds/);
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
