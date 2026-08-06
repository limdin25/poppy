# onboarding-funnel

The gated onboarding at `/onboarding`. Five steps, strictly ordered, ONE open
at a time: connect Instagram, join the community, get the Skool link, add a
profile photo, put the sentence and link in the bio. Done steps collapse to a
green row (a native `<details>`, tappable to reread), future steps sit locked
and dimmed, and fireworks fire once when the last step goes green.

Replaces both the old sector-picking wizard (`features/onboarding`, deleted)
and the `/brochure` leaflet (`features/creator-brochure`, now a redirect).

## How it decides what is open

The server does. `lib/data/onboarding.ts` computes every step's state fresh on
each render (`getOnboardingData`), so a creator can leave to Instagram, Gmail
or Skool and come back to the exact same step. `resolveFunnel` picks the first
step that is neither done nor blocked; blocked steps (Instagram switched off,
bio waiting on its prerequisites) never trap the funnel, but completion is
strict: all five must be done before `onboarding_complete` is stamped.

## Tracking

`stampOnboardingProgress` writes `onboarding_progress` (one row per creator
per step: `first_seen_at`, `completed_at`) on every page render. Those stamps
are what the nudge brain in `/api/funnel/tick` reads to decide who is stuck
where and for how long. Timestamps are forward-only.

## Pictures

`shots.ts` maps the annotated phone screenshots in `public/guide/` (red-arrow
annotations, generated from Hugo's own phone). Slots with no picture yet ship
as words: the `fallback` text must teach the step on its own. `shots.test.ts`
fails the build if a declared `src` is missing from `public/`.

## Self-declared steps

Community ("I have joined") because Skool has no event for a free member
joining; photo because no API can judge a photo; bio only as an escape hatch
when the Outstand metrics read fails. The bio step otherwise verifies itself
by reading the live bio back.
