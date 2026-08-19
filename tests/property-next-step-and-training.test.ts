import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEAL_STAGES } from '../src/features/crm/components/templates/dealProcessSteps';
import {
  STEP,
  WRITEABLE_STEPS,
  isKnownStep,
  stepForOutcome,
  offerSentFields,
} from '../src/features/crm/lib/nextStep';

// Everything Hugo asked for on 2026-08-12, after seeing the dialer:
//   - the right pane loses Send as video and Build & send their website
//   - the property templates and an AI drafter appear there instead
//   - the SMS history moves to the right, under the message history
//   - the next step is written on the strip, on the card and in the left column
//   - something actually writes next_step
//   - an offer that goes out is recorded
//   - a knowledge checkpoint locks the room every few dials
//   - an AI report after every call says what went wrong
//   - the script and the coach follow the step of the process

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TABS = stripComments(read('src/features/crm/components/live-call/DialerRightTabs.tsx'));
const SENDER = stripComments(read('src/features/crm/components/live-call/MidCallSmsSender.tsx'));
const PAGE = stripComments(read('src/features/crm/dialer-pro/DialerProPage.tsx'));
// The property room moved out of DialerProPage into its own component on
// 2026-08-18, so the INBOUND call screen mounts the same room Pedro dials from.
// These pins follow the code; what they assert is unchanged.
const ROOM = stripComments(read('src/features/crm/components/live-call/PropertyCallRoom.tsx'));
const STRIP = stripComments(read('src/features/crm/components/live-call/OfferStrip.tsx'));
const OUTCOME = stripComments(read('api/crm/property-outcome.ts'));
const ASSIGN = read('scripts/assign-properties-to-pedro-houses.mjs');
const COACH = read('supabase/functions/wk-voice-transcription/index.ts');
const SCRIPT = read('src/core/content/property-call-script.html');
const DRAFT = stripComments(read('api/crm/draft-offer-email.ts'));
const CHECK = stripComments(read('api/crm/knowledge-check.ts'));
const REVIEW = stripComments(read('api/crm/call-review.ts'));
const TOPICS_SRC = read('api/lib/knowledge-topics.ts');
const BANK = read('api/lib/training-questions.ts');

describe('the property call pane', () => {
  it('drops the two buttons that sell the plumber product', () => {
    expect(TABS).toMatch(/!isPropertyCall && <VideoLinkButton/);
    expect(TABS).toMatch(/!isPropertyCall && <SendSiteButton/);
  });

  it('keeps both of them on a plumber call', () => {
    // The guard is the property flag, not a deletion: a plumber call still
    // renders each one exactly as before.
    expect(TABS).toMatch(/VideoLinkButton contact=\{contact\} compact/);
    expect(TABS).toMatch(/SendSiteButton contact=\{contact\} compact/);
  });

  it('offers the deal process templates instead of the Elsie ones', () => {
    expect(SENDER).toMatch(/isPropertyCall \? propertyTemplates : templates/);
    expect(SENDER).toMatch(/DEAL_STAGES\.flatMap/);
  });

  it('has an AI drafter, and it only appears on an OFFER-stage call', () => {
    expect(SENDER).toMatch(/data-testid="ai-draft-offer"/);
    // 2026-08-15: on a discovery call this button was one click from putting
    // our figure in writing. It must be gated on the call mode, not merely on
    // the call being a property call. The room's computed mode (step +
    // ballpark + board column) wins when passed; the fields derivation is
    // the fallback for mounts outside the room.
    expect(SENDER).toMatch(/isPropertyCall && \(callMode \?\? callModeForStep\(currentContact\?\.customFields\?\.next_step, currentContact\?\.customFields\)\) === 'offer' && \(/);
    expect(SENDER).toMatch(/\/api\/crm\/draft-offer-email/);
  });

  it('only stamps offer_sent on an offer-stage email', () => {
    expect(SENDER).toMatch(/channel === 'email' && offerHouse\?\.offerPrice\s*\n\s*&& \(callMode \?\? callModeForStep\(currentContact\?\.customFields\?\.next_step, currentContact\?\.customFields\)\) === 'offer'/);
  });
});

describe('the offer drafter', () => {
  it('is given every figure it may use, and told never to invent one', () => {
    expect(DRAFT).toMatch(/NEVER invent a number/);
    expect(DRAFT).toMatch(/OUR OFFER, use this figure and no other/);
  });

  it('reads what was actually said on the call', () => {
    // Through the one shared reader, which prefers the accurate after-call
    // transcript and falls back to Twilio's realtime rows mid-call.
    expect(DRAFT).toMatch(/readCallTranscript/);
    expect(DRAFT).toMatch(/THERE IS NO TRANSCRIPT/);
  });

  it('says subject to our builder, never subject to survey', () => {
    expect(DRAFT).toMatch(/subject to our builder going round/i);
    expect(DRAFT).toMatch(/NEVER write "subject to survey"/);
  });

  it('refuses to write an offer with no offer figure', () => {
    expect(DRAFT).toMatch(/No offer figure on this property/);
  });

  it('strips long dashes out of whatever the model wrote', () => {
    expect(DRAFT).toMatch(/replace\(\/\[–—\]\/g, ','\)/);
  });
});

describe('the next step, written and shown', () => {
  it('every tag this code writes is a real step', () => {
    for (const tag of WRITEABLE_STEPS) {
      expect(isKnownStep(tag), `${tag} is not a step in dealProcessSteps.ts`).toBe(true);
    }
  });

  it('maps a call outcome to a step, or leaves it alone', () => {
    expect(stepForOutcome('figure_obtained')).toBe(STEP.homework);
    expect(stepForOutcome('deciding')).toBe(STEP.chase);
    expect(stepForOutcome('no_answer')).toBe(STEP.call);
    expect(stepForOutcome('not_qualified')).toBe('');
    expect(stepForOutcome('something_else')).toBeNull();
  });

  it('the server writes the same tags the UI reads', () => {
    const tags = DEAL_STAGES.map((s) => s.tag);
    // Only the STEP_FOR_OUTCOME block. BOARD_COLUMN_FOR sits in the same file
    // and maps the same outcomes to CRM column names, which are a different
    // vocabulary ("Ballpark", "Deciding") and must not be checked against this.
    const block = OUTCOME.slice(
      OUTCOME.indexOf('const STEP_FOR_OUTCOME'),
      OUTCOME.indexOf('};', OUTCOME.indexOf('const STEP_FOR_OUTCOME')),
    );
    const written = [...block.matchAll(/: '([^']+)'/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(3);
    for (const tag of written) {
      expect(tags, `${tag} is not a step in dealProcessSteps.ts`).toContain(tag);
    }
    expect(ASSIGN).toMatch(/next_step: 'Discovery call'/);
    expect(tags).toContain('Discovery call');
  });

  it('a facts refresh never rewinds a branch to step one', () => {
    // The queue script rewrites custom_fields wholesale on --refresh. Without
    // this, a branch already at "Do the homework" would be told to ring
    // again from scratch.
    expect(ASSIGN).toMatch(/prevStep/);
    expect(ASSIGN).toMatch(/facts\.next_step = prevStep/);
  });

  it('is on the strip, on the card, and in the left column', () => {
    expect(STRIP).toMatch(/data-testid="offer-strip-next-step"/);
    expect(ROOM).toMatch(/<NextStepPanel/);
    expect(ROOM).toMatch(/const nextStep = contact\?\.customFields\?\.next_step/);
  });

  it('records an offer that has gone out, with the figure and the date', () => {
    const fields = offerSentFields(76000, '2026-08-12T10:00:00.000Z');
    expect(fields.offer_price).toBe('76000');
    expect(fields.offer_sent_at).toBe('2026-08-12T10:00:00.000Z');
    expect(fields.next_step).toBe(STEP.chase);
    expect(SENDER).toMatch(/offerSentFields\(offerHouse\.offerPrice/);
  });
});

describe('the knowledge checkpoint', () => {
  it('never puts the right answer in the browser bundle', () => {
    // The bank is server-only. draw returns shuffled options with no correct
    // index; grade compares the text server side.
    expect(CHECK).toMatch(/from '\.\.\/lib\/training-questions\.js'/);
    expect(CHECK).toMatch(/action === 'grade'/);
    const client = read('src/features/crm/components/live-call/KnowledgeCheckpoint.tsx');
    expect(client).not.toMatch(/training-questions/);
  });

  it('locks: no close button, no escape, no click outside', () => {
    const client = stripComments(read('src/features/crm/components/live-call/KnowledgeCheckpoint.tsx'));
    expect(client).not.toMatch(/onClose|Escape/);
    expect(client).toMatch(/data-testid="knowledge-checkpoint-continue"/);
  });

  it('fires between calls, on property calls only, and resets its counter', () => {
    expect(PAGE).toMatch(/CHECKPOINT_EVERY/);
    expect(PAGE).toMatch(/!isHousesCall \|\| state\.phase !== 'wrap_up'/);
    expect(PAGE).toMatch(/dialer_calls_since_check/);
    expect(PAGE).toMatch(/checkpointDue && \(/);
  });

  // Hugo 2026-08-12: "make wrong answers come back after 10 rounds until he
  // gets them right."
  it('brings a wrong answer back, and only when it is due', () => {
    expect(CHECK).toMatch(/REPEAT_AFTER_ROUNDS = 10/);
    expect(CHECK).toMatch(/nextIn = Math\.min\(REPEAT_AFTER_ROUNDS/);
    expect(CHECK).toMatch(/\.lte\('due_round', round\)/);
    expect(CHECK).toMatch(/\.order\('due_round', \{ ascending: true \}\)/);
  });

  it('stops asking once he gets it right', () => {
    expect(CHECK).toMatch(/const now = new Date\(\)\.toISOString\(\)/);
    expect(CHECK).toMatch(/\.is\('resolved_at', null\)/);
    expect(CHECK).toMatch(/resolved_at: now/);
  });

  it('follows the person, not the browser', () => {
    const client = stripComments(read('src/features/crm/components/live-call/KnowledgeCheckpoint.tsx'));
    expect(client).toMatch(/agentKey = user\?\.id/);
    expect(client).toMatch(/action: 'grade'.*agentKey/s);
    expect(CHECK).toMatch(/agent_key: agentKey/);
  });

  it('says out loud that a repeat is a repeat', () => {
    const client = read('src/features/crm/components/live-call/KnowledgeCheckpoint.tsx');
    expect(client).toMatch(/You got this one wrong before/);
    expect(CHECK).toMatch(/repeat: true/);
  });

  it('never lets a history failure stop him dialling', () => {
    // The marking is what he sees; the row is a nice-to-have. Every database
    // call sits inside a try/catch, so an unreachable table costs him nothing.
    const raw = read('api/crm/knowledge-check.ts');
    expect(raw).toMatch(/try \{[\s\S]*wk_knowledge_checks[\s\S]*\} catch/);
    expect(raw).toMatch(/The marking above is what he sees/);
    expect(raw).toMatch(/fall through to a fresh one/);
  });

  // Hugo 2026-08-12: "did you find a good strategy?" This is it, in four rules.
  describe('the repetition strategy', () => {
    it('pulls a repeatedly wrong question towards him, not away', () => {
      expect(CHECK).toMatch(/REPEAT_AFTER_ROUNDS \* \(wrongsBefore \+ 1\)/);
      expect(CHECK).toMatch(/MAX_WRONG_GAP = 30/);
      expect(CHECK).toMatch(/Math\.min\(/);
    });

    it('does not retire a question just because he got it right once', () => {
      expect(CHECK).toMatch(/CONFIRM_AFTER_ROUNDS = 30/);
      expect(CHECK).toMatch(/owed\.length > 0 && !confirming/);
    });

    it('retires it only when the confirmation is answered right', () => {
      expect(CHECK).toMatch(/retired: correct && confirming/);
      const client = read('src/features/crm/components/live-call/KnowledgeCheckpoint.tsx');
      expect(client).toMatch(/That one is done/);
    });

    it('never leaves two open rows asking the same question twice', () => {
      expect(CHECK).toMatch(/if \(owed\.length > 0\) \{[\s\S]{0,320}resolved_at: now/);
    });

    it('a question he has never got wrong schedules nothing', () => {
      // nextIn stays null, so the row carries no due_round and never comes back.
      expect(CHECK).toMatch(/let nextIn: number \| null = null/);
      expect(CHECK).toMatch(/due_round: nextIn === null \? null : round \+ nextIn/);
    });
  });

  describe('the checkpoint asks about his own calls', () => {
    it('every question a topic points at is really in the bank', () => {
      const ids = new Set([...BANK.matchAll(/id: '([^']+)'/g)].map((m) => m[1]));
      const block = TOPICS_SRC.slice(TOPICS_SRC.indexOf('export const TOPICS'));
      const used = [...block.matchAll(/questionIds: \[([^\]]+)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
      expect(used.length).toBeGreaterThan(8);
      for (const id of used) {
        expect(ids, `topic points at a question "${id}" that does not exist`).toContain(id);
      }
    });

    // Hugo 2026-08-12: the script grew an email ask, a remote-buyer
    // explanation and a subject-to-our-builder clause, and the bank tested none
    // of them. "yes pls."
    it('tests the parts of the script that were added today', () => {
      for (const id of [
        'script_email_address',
        'obj_email_general_inbox',
        'script_who_sends_the_offer',
        'script_subject_to_builder',
        'obj_who_views_it',
        'script_quote_comes_back_higher',
        'script_what_a_chase_call_is_for',
      ]) {
        expect(BANK, `${id} is missing from the question bank`).toContain(id);
      }
    });

    it('teaches subject to our builder, never subject to survey', () => {
      const q = BANK.slice(BANK.indexOf("id: 'script_subject_to_builder'"));
      const opts = q.slice(q.indexOf('options: ['), q.indexOf(']', q.indexOf('options: [')));
      // options[0] is the correct one in this file, and the survey is a wrong
      // answer sitting right underneath it.
      expect(opts).toMatch(/'Our builder going round/);
      expect(opts).toMatch(/satisfactory survey/);
    });

    it('reads the review in its own words', () => {
      expect(TOPICS_SRC).toMatch(/topicsForMistakes/);
      expect(CHECK).toMatch(/action === 'flag'/);
      expect(CHECK).toMatch(/origin: 'call_review'/);
      expect(CHECK).toMatch(/due_round: round,/);
    });

    it('queues at most three, and one question per mistake', () => {
      expect(TOPICS_SRC).toMatch(/limit = 3/);
      expect(TOPICS_SRC).toMatch(/found\.length >= limit/);
      expect(CHECK).toMatch(/t\.questionIds\.find\(/);
    });

    it('the review posts its mistakes, and cannot queue them twice', () => {
      const card = read('src/features/crm/components/live-call/CallReviewCard.tsx');
      expect(card).toMatch(/action: 'flag'/);
      expect(card).toMatch(/mistakes/);
      // The unique index is what makes a second mount a no-op.
      const mig = read('supabase/migrations/20260812000003_knowledge_checks_from_calls.sql');
      expect(mig).toMatch(/create unique index[\s\S]*agent_key, call_id, question_id/);
    });

    it('tells him on screen why he is being asked it', () => {
      const client = read('src/features/crm/components/live-call/KnowledgeCheckpoint.tsx');
      expect(client).toMatch(/data-testid="knowledge-checkpoint-repeat"/);
      expect(client).toMatch(/q\.because/);
      expect(TOPICS_SRC).toMatch(/because: '/);
    });
  });

  it('asks the same number of calls apart at both ends', () => {
    const server = CHECK.match(/CHECKPOINT_EVERY = (\d+)/)?.[1];
    const client = PAGE.match(/const CHECKPOINT_EVERY = (\d+)/)?.[1];
    expect(server).toBeDefined();
    expect(client).toBe(server);
  });
});

describe('the post-call review', () => {
  it('marks the call against the rules the coach already works to', () => {
    expect(REVIEW).toMatch(/ballpark/i);
    expect(REVIEW).toMatch(/EMAIL ADDRESS/);
    expect(REVIEW).toMatch(/never coach|never|Never/);
    expect(REVIEW).toMatch(/Agreeing to view the property/);
  });

  it('refuses to review a call that barely happened', () => {
    expect(REVIEW).toMatch(/lines\.length < 6/);
    expect(REVIEW).toMatch(/Too little was said/);
  });

  it('shows on the wrap-up card, property calls only', () => {
    expect(PAGE).toMatch(/review=\{isHousesCall \? <CallReviewCard/);
  });
});

describe('the script and the coach follow the step', () => {
  it('the coach reads the step off the branch card', () => {
    expect(COACH).toMatch(/coachFields\.next_step/);
    expect(COACH).toMatch(/PROPERTY_STEP_PROMPT/);
  });

  it('the coach never unlearns a confirmed ballpark', () => {
    // Mirror of callModeForStep (2026-08-18): no_answer demotes next_step to
    // 'Discovery call', so without this the coach walked Pedro through the
    // cold opener while the script pane showed call two. Promote-only.
    expect(COACH).toMatch(/COACH_OFFER_STEPS/);
    expect(COACH).toMatch(/coachOpenFigure > 0/);
    expect(COACH).toMatch(/\? 'Offer call'/);
  });

  it('the coach reads the board column too, same set as callModeForCard', () => {
    // On the first real card both other signals were dead (step demoted,
    // ballpark string blanked); the column was the only one left. Drift-pin
    // the set against the client one in nextStep.ts.
    expect(COACH).toMatch(/COACH_CALL2_COLUMNS/);
    for (const name of ['Ready for call 2', 'Ballpark agreed', 'Viewing booked', 'Offer sent', 'Waiting on their answer', 'Offer accepted']) {
      expect(COACH).toContain(`'${name}'`);
    }
    expect(COACH).toMatch(/columnSaysCall2/);
  });

  it('every step the coach knows about is a real step', () => {
    const tags = DEAL_STAGES.map((s) => s.tag);
    const block = COACH.slice(
      COACH.indexOf('const PROPERTY_STEP_PROMPT'),
      COACH.indexOf('const PROPERTY_SCRIPT_PROMPT'),
    );
    const keys = [...block.matchAll(/^ {2}'([^']+)': \[/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) {
      expect(tags, `coach knows a step "${k}" that the deal process does not`).toContain(k);
    }
  });

  it('a chase call is never coached as a first call', () => {
    expect(COACH).toMatch(/WHICH CALL THIS IS: a CHASE/);
    expect(COACH).toMatch(/Do NOT coach the ballpark question again/);
  });

  it('an unknown or missing step changes nothing', () => {
    expect(COACH).toMatch(/PROPERTY_STEP_PROMPT\[propertyStep\] \?\? ''/);
    expect(COACH).toMatch(/isPropertyCall \? PROPERTY_SCRIPT_PROMPT : ''/);
  });
});

describe('the email address', () => {
  it('is asked for on the live script', () => {
    expect(SCRIPT).toMatch(/What's the best email for you/);
    expect(SCRIPT).toMatch(/Never hang up without the email address/);
  });

  it('is a rule in the coach as well', () => {
    expect(COACH).toMatch(/THE EMAIL ADDRESS/);
    expect(COACH).toMatch(/cannot become an offer/);
  });
});
