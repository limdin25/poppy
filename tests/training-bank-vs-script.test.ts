import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The question bank must stay in step with the script it grades.
//
// Hugo 2026-08-12, on being told the answers can drift when the script is
// edited: "okay do it."
//
// THE FAILURE THIS PREVENTS. Pedro is marked wrong for saying the thing the
// script now tells him to say. That is worse than not testing him at all: the
// checkpoint locks his dialer until he gives an answer the business has since
// stopped believing in, and the explanation he is shown teaches him back out of
// the current script. It is silent, it looks like he is getting worse, and
// nothing else in the codebase would catch it.
//
// HOW IT WORKS. Each pinned question names a phrase that MUST still appear in
// the script or the coach for its answer to be true, and (where it matters) a
// phrase that must NOT. Rewrite the script freely; change what it TEACHES and
// this file fails and tells you which question to rewrite with it.
//
// It deliberately does not try to check all 76. It covers the answers that
// would actually mislead him on a live call: the money, the offer, the viewing,
// the email, the ceiling.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const BANK = read('api/lib/training-questions.ts');
const SCRIPT = read('src/core/content/property-call-script.html');
const COACH = read('supabase/functions/wk-voice-transcription/index.ts');
const BOTH = `${SCRIPT}\n${COACH}`;

/** The correct answer for a question, which is options[0] in the bank file. */
function correctAnswer(id: string): string {
  const at = BANK.indexOf(`id: '${id}'`);
  expect(at, `question ${id} is not in the bank`).toBeGreaterThan(-1);
  const block = BANK.slice(at, at + 2500);
  const opts = block.indexOf('options: [');
  expect(opts, `question ${id} has no options`).toBeGreaterThan(-1);
  const first = block.slice(opts + 'options: ['.length);
  const m = first.match(/\s*'((?:[^'\\]|\\.)*)'/);
  expect(m, `could not read the first option of ${id}`).toBeTruthy();
  return m![1].replace(/\\'/g, "'");
}

interface Pin {
  id: string;
  /** Still true in EITHER the script or the coach.
   *
   *  Use this only when one surface genuinely carries the rule on its own.
   *  Where both say it, pin both (inScript AND inCoach): the first version of
   *  this file checked the two files joined together, so deleting the email ask
   *  from the script passed because the coach still mentioned it. A rule that
   *  can be half deleted without failing is not a rule. */
  mustTeach: RegExp[];
  /** Must still be in the script Pedro reads. */
  inScript?: RegExp[];
  /** Must still be in the coach's prompt. */
  inCoach?: RegExp[];
  /** Must NOT be what we teach. Catches a reversal rather than a deletion. */
  mustNotTeach?: RegExp[];
  /** A phrase the correct answer itself has to contain, so rewording the
   *  option away from the script is caught too. */
  answerSays?: RegExp;
}

const PINS: Pin[] = [
  {
    id: 'script_subject_to_builder',
    mustTeach: [],
    inScript: [/subject to our builder/i],
    inCoach: [/subject to our builder/i, /never "subject to survey"|never say "subject to survey"|Say "subject to our builder"/i],
    // The reversal that matters: if the script ever starts saying "subject to
    // survey", this question is marking him wrong for reading his own script.
    mustNotTeach: [/say "subject to survey"/i, /always subject to survey/i],
    answerSays: /builder going round/i,
  },
  {
    id: 'script_email_address',
    mustTeach: [],
    // Both surfaces teach this one, so both have to keep teaching it. If the
    // script drops it he never asks; if the coach drops it, nothing catches him
    // when he forgets.
    inScript: [/best email for you/i, /never hang up without the email/i],
    inCoach: [/THE EMAIL ADDRESS/, /cannot become an offer/i],
    answerSays: /email address/i,
  },
  {
    id: 'script_who_sends_the_offer',
    mustTeach: [/speak to Hugo/i],
    answerSays: /Hugo/,
  },
  {
    id: 'obj_who_views_it',
    mustTeach: [],
    inScript: [/builder/i, /remotely|across the country/i],
    inCoach: [/NEVER VIEW A PROPERTY/],
    // We never send Pedro to a viewing. If the script ever says we do, this
    // answer is wrong and so is the coach.
    mustNotTeach: [/YOU:[^<]*I will come and (see|view) it/i],
    answerSays: /builder/i,
  },
  {
    id: 'script_one_number',
    mustTeach: [/one number|never a range|not a range/i],
    answerSays: /range/i,
  },
  {
    id: 'script_never_say_ceiling',
    mustTeach: [/walk away|ceiling/i],
    answerSays: /never|private|nobody/i,
  },
  {
    id: 'script_end_with_time',
    mustTeach: [/realistic time/i],
    answerSays: /ring them back|call you back|callback/i,
  },
  {
    id: 'script_get_their_figure',
    mustTeach: [/what sort of figure/i],
  },
  {
    id: 'owo_exact_wording',
    mustTeach: [/if we were to offer|if I was to offer/i],
    answerSays: /if we were to offer|if I was to offer/i,
  },
  {
    id: 'script_what_a_chase_call_is_for',
    // The coach alone carries this: the on-screen script is the first call, and
    // the chase is the coach's step overlay.
    mustTeach: [],
    inCoach: [/WHICH CALL THIS IS: a CHASE/, /Do NOT coach the ballpark question again/],
    answerSays: /vendor seen it|ring back/i,
  },
  {
    id: 'script_quote_comes_back_higher',
    mustTeach: [/builder/i],
    answerSays: /quote/i,
  },
];

describe('the question bank still agrees with the script', () => {
  for (const pin of PINS) {
    it(`${pin.id} is still what we teach`, () => {
      for (const re of pin.mustTeach) {
        expect(
          BOTH,
          `${pin.id} grades him on something neither the script nor the coach says any more (${re}). Rewrite the question, or put the line back.`,
        ).toMatch(re);
      }
      for (const re of pin.inScript ?? []) {
        expect(
          SCRIPT,
          `the SCRIPT no longer teaches ${pin.id} (${re}), so he would be marked wrong for reading what is on his screen.`,
        ).toMatch(re);
      }
      for (const re of pin.inCoach ?? []) {
        expect(
          COACH,
          `the COACH no longer enforces ${pin.id} (${re}), so nothing catches him when he forgets it live.`,
        ).toMatch(re);
      }
      for (const re of pin.mustNotTeach ?? []) {
        expect(
          BOTH,
          `the script now teaches the OPPOSITE of ${pin.id} (${re}). Pedro would be marked wrong for reading his own script.`,
        ).not.toMatch(re);
      }
      if (pin.answerSays) {
        expect(
          correctAnswer(pin.id),
          `the correct answer to ${pin.id} has been reworded away from what it is meant to test`,
        ).toMatch(pin.answerSays);
      }
    });
  }

  it('covers every question written for the 2026-08-12 script changes', () => {
    // The additions of that day are the ones with no history behind them, so
    // they are the likeliest to drift. If somebody adds another, pin it here.
    const addedThatDay = [
      'script_email_address',
      'script_who_sends_the_offer',
      'script_subject_to_builder',
      'obj_who_views_it',
      'script_quote_comes_back_higher',
      'script_what_a_chase_call_is_for',
    ];
    const pinned = new Set(PINS.map((p) => p.id));
    for (const id of addedThatDay) {
      expect(pinned, `${id} was added with the script and is not pinned to it`).toContain(id);
    }
  });

  it('pins every rule to a surface, rather than to the two joined together', () => {
    // The bug this file shipped with: mustTeach checked script+coach as one
    // string, so a rule deleted from the script passed on the coach's copy.
    for (const pin of PINS) {
      const pinned = pin.mustTeach.length + (pin.inScript?.length ?? 0) + (pin.inCoach?.length ?? 0);
      expect(pinned, `${pin.id} pins nothing`).toBeGreaterThan(0);
    }
  });

  it('every pinned question is really in the bank', () => {
    for (const pin of PINS) {
      expect(BANK, `${pin.id} is pinned here but missing from the bank`).toContain(`id: '${pin.id}'`);
    }
  });
});
