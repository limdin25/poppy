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
const STRIP = stripComments(read('src/features/crm/components/live-call/OfferStrip.tsx'));
const OUTCOME = stripComments(read('api/crm/property-outcome.ts'));
const ASSIGN = read('scripts/assign-properties-to-pedro-houses.mjs');
const COACH = read('supabase/functions/wk-voice-transcription/index.ts');
const SCRIPT = read('src/core/content/property-call-script.html');
const DRAFT = stripComments(read('api/crm/draft-offer-email.ts'));
const CHECK = stripComments(read('api/crm/knowledge-check.ts'));
const REVIEW = stripComments(read('api/crm/call-review.ts'));

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

  it('has an AI drafter, and it is property only', () => {
    expect(SENDER).toMatch(/data-testid="ai-draft-offer"/);
    expect(SENDER).toMatch(/\{isPropertyCall && \(/);
    expect(SENDER).toMatch(/\/api\/crm\/draft-offer-email/);
  });
});

describe('the offer drafter', () => {
  it('is given every figure it may use, and told never to invent one', () => {
    expect(DRAFT).toMatch(/NEVER invent a number/);
    expect(DRAFT).toMatch(/OUR OFFER, use this figure and no other/);
  });

  it('reads what was actually said on the call', () => {
    expect(DRAFT).toMatch(/wk_live_transcripts/);
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
    expect(stepForOutcome('figure_obtained')).toBe(STEP.numbers);
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
    expect(ASSIGN).toMatch(/next_step: 'Call the agent'/);
    expect(tags).toContain('Call the agent');
  });

  it('a facts refresh never rewinds a branch to step one', () => {
    // The queue script rewrites custom_fields wholesale on --refresh. Without
    // this, a branch already at "Confirm the numbers" would be told to ring
    // again from scratch.
    expect(ASSIGN).toMatch(/prevStep/);
    expect(ASSIGN).toMatch(/facts\.next_step = prevStep/);
  });

  it('is on the strip, on the card, and in the left column', () => {
    expect(STRIP).toMatch(/data-testid="offer-strip-next-step"/);
    expect(PAGE).toMatch(/<NextStepPanel/);
    expect(PAGE).toMatch(/nextStep=\{contact\?\.customFields\?\.next_step/);
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
    expect(COACH).toMatch(/custom_fields\?\.next_step/);
    expect(COACH).toMatch(/PROPERTY_STEP_PROMPT/);
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
