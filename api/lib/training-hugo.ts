// Hugo's side of the training system: the owner's PIN and the trainee key.
//
// SERVER ONLY, and this one genuinely matters. Nothing under src/ may import
// this file, and tests/training-answer-key.test.ts fails the build if anything
// does.
//
// Why it is split out from api/lib/training.ts at all: that file IS imported by
// the browser (the page needs the video list and Pedro's gate PIN), so anything
// in it ships in the client bundle. Pedro's 1176 being public is fine and
// deliberate, the same as /script and /blueprint. Hugo's PIN is not the same
// kind of thing: it opens the ANSWER KEY. If it were bundled, Pedro could read
// it out of the JavaScript, open /hugo-training, and the timed quiz would be
// pointless.
//
// So Hugo's page never compares the PIN in the browser. It posts whatever was
// typed to the server, and the server decides. The browser is never told the
// right answer, only whether the one it sent was right.
//
// Hugo asked for the same PIN as Pedro's. That was refused on purpose, for
// exactly the reason above, and he has been told it is 8642 and that he can
// change it by setting HUGO_TRAINING_PIN.

import { pinMatches } from './training.js';

/** One row per trainee in training_video_progress / training_quiz_attempts.
 *  Hugo's practice attempts are filed under his own key so they can never be
 *  mistaken for Pedro's real ones in the admin view. */
export const HUGO_TRAINEE_KEY = 'hugo';

/** The fallback exists so the page works the moment it deploys, without
 *  anybody having to set a variable first. It is not a credential to any
 *  system: the worst a leak does is show somebody the quiz answers. Set
 *  HUGO_TRAINING_PIN in Vercel to override it, which is what Hugo should do if
 *  he ever wants it changed. */
const FALLBACK_PIN = '8642';

export function hugoPin(): string {
  const fromEnv = (process.env.HUGO_TRAINING_PIN ?? '').trim();
  return fromEnv.length > 0 ? fromEnv : FALLBACK_PIN;
}

/**
 * The one gate on the answer key.
 *
 * Deliberately checks ONLY Hugo's PIN. Pedro's 1176 must not open this, and a
 * test asserts it, because "the other PIN also works" is exactly the kind of
 * convenience that would quietly undo the whole point of the timed quiz.
 */
export function hugoPinOk(supplied: unknown): boolean {
  return pinMatches(supplied, hugoPin());
}
