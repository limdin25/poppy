# watch-page

The public page at `/watch` that a WhatsApp lead is sent BEFORE onboarding.
Hugo's shape, in order: the explainer video, the earnings section with the
calculator, the "Yes, I want to move forward" button back to WhatsApp with a
pre-written message, the demo videos we actually post, the button again.

## Composition

The calculator and the demo wall already live in `features/landing-page`.
Features never import features, so `app/watch/page.tsx` composes them in as
the `calculator` and `demos` slots. `DemoTracker` wraps the demos slot and
counts plays via capture-phase listeners, so the landing feature stays
untouched.

## The video

`public/watch/explainer.mp4` (720p, ~7MB, faststart) compressed from Hugo's
`Avatar_Video.mp4` (Downloads, 2026-08-06). Poster at `explainer.jpg`. Replace
by re-running the ffmpeg lines in the git history of this feature.

## Tracking

Anonymous session id (random, sessionStorage) + beacons to
`/api/watch/track` -> `watch_events` (migration 026): `view`, `play`,
`watch_50`, `watch_90`, `ended`, `cta_click` (top/bottom), `demo_play`.
Watch percentage is COVERAGE of `video.played` ranges, never the playhead,
for the same reason the Elsie VSL funnel does it that way: a seek bar plus
playhead percent lets a drag register a full watch.

## The WhatsApp button

`wa.me/447460035763` with "I have watched the video and I'm happy to move
forward." pre-filled, so the lead lands back in the thread they came from
with nothing to type. The click beacon uses sendBeacon and survives the
navigation.
