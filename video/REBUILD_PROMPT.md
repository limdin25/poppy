# REBUILD PROMPT — HeyElsie Reviews VSL, vertical (9:16), "Google says it themselves"

## What you're building

A **1080×1920 vertical MP4** (30fps, ~2:24) — a personalised sales video for UK
trades businesses. An AI presenter (circle, Loom-style) narrates over visuals
that always match his words. This is a REBUILD of a horizontal version that
failed review — every defect listed below must be fixed.

The video's logic: competitors rank above you on Google because they have more
reviews → Google itself says reviews affect ranking → here's how we fix it
(3 steps, dead simple) → reviews double in month one → £1-for-10-days offer.

## Assets (all exist — do not regenerate)

| What | Path |
|---|---|
| Presenter video (master) | `/Users/hugo/Downloads/2nd_version_pedro.mp4` (1920×1080, 25fps, 2:24, full script + audio) |
| Caption timings (SOURCE OF TRUTH for sync) | `/Users/hugo/Downloads/2nd_version_pedro_caption.srt` (31 cues, exact seconds) |
| Extracted presenter audio | `/Users/hugo/Whats/Poppy/video/public/audio/pedro-full.m4a` |
| Lead + live competitor pack | `/Users/hugo/Whats/Poppy/video/src/data/lead.json` (15 Glossop businesses; lead = "Energywise Heating Limited", 5.0★, 59 reviews, position 11, 4 entries below it) |
| Real client website recording | `/Users/hugo/Whats/Poppy/video/public/clips/07-website.webm` (The Boiler Club homepage, 9s, 1080p) |
| Real Google support page | `/Users/hugo/Whats/Poppy/video/public/support-page.png` (1680×2580 full-page capture of support.google.com/business/answer/7091, "Prominence" expanded; the REAL sentence is "More reviews and positive ratings can HELP your business's local ranking.") |
| Quote position | `/Users/hugo/Whats/Poppy/video/src/data/support-quote.json` ({y:1836, h:48, x:211, w:653} in the 1680-wide image) |
| Existing Remotion project | `/Users/hugo/Whats/Poppy/video` (remotion 4 installed; human-motion lib at `src/lib/human.ts`, cursor at `src/comps/Cursor.tsx`, Google SERP markup at `src/comps/GoogleScroll.tsx` + `src/comps/kimi.tsx`) |

Render: `cd /Users/hugo/Whats/Poppy/video && npx remotion render src/index.ts FlowVideo out/flow.mp4`
Preview frame: `npx remotion still src/index.ts FlowVideo out/x.png --frame=N`

## Timing map (from the .srt — the voice drives every cut)

- 0.0–9.7 — HOOK: "Quick video. I'll show you how your competitors are making more money — just because they rank higher on Google."
- 9.7–13.7 — "Have a look — these are the businesses in your area."
- 13.7–17.1 — "The ones at the top get all the calls."
- 17.1–24.8 — "Scroll down… Down …Down …Down …Down, and there you are, near the bottom."
- 24.8–30.4 — "So the best jobs go to the ones up top. Simple as that."
- 30.6–35.9 — "And the only reason they're up there is more reviews…"
- 37.3–47.5 — "Don't take my word for it — this is Google's own page: 'More reviews and positive ratings can improve your business's local ranking.' More reviews, higher up."
- 47.7–49.6 — "Higher up, more jobs."
- 50.0–66.2 — WHY: "why isn't it happening… the customer forgets… that five-star review never happens."
- 67.6–71.7 — "So here's what we do, and it's dead simple — three steps."
- 71.9–74.6 — "One, we connect to your jobs."
- 74.8–86.1 — "Two, soon as you finish one, your customer gets a friendly text asking for a review, their name right on it, with a reminder or two so it actually gets done."
- 86.1–90.1 — "Three, that review lands on your Google and you climb."
- 90.1–97.7 — "You don't lift a finger — and we start with the customers you've already worked for, so it kicks off fast."
- 97.9–113.3 — "So here's the deal. Reviews go up, you climb Google, and the calls start coming to you instead of them. Most businesses double their reviews in the first month."
- 115.6–120.9 — "Try it for ten days for just one pound — and watch the reviews start rolling in."
- 120.9–126.1 — "After that it's ninety-nine a month — less than a single job — cancel any time."
- 126.1–135.5 — "We only take five businesses per city… so don't let the one above you grab your spot."
- 135.5–144.3 — "It takes less than five minutes to set up, and you never have to worry about this again. Tap the button, and let's get you started."

## NON-NEGOTIABLE RULES (the reasons the last version failed)

1. **Late reveal.** During "Scroll down… Down …Down …Down" the lead's card is
   NOT yet visible — the scroll keeps moving through the ENTIRE down-sequence.
   The lead card enters the frame only as he stops saying "down" (~24s), and
   **only then does it get the red ring + "YOU" badge** — the selection happens
   AT the reveal, never before. Before that moment the card must look identical
   to every other listing.
2. **Longer scroll.** Pad the pack with ~8 extra plausible businesses above the
   lead (fake names fine — plain names like "Peak Plumbing Services"; ratings
   4.3–4.9, 8–200 reviews) so the glide visibly travels.
3. **Support page: straight to the right section.** Never show the top of the
   article or collapsed accordions — open directly on the expanded "Prominence"
   section with the quote visible. **The yellow highlight animates IN after the
   page is on screen** (draw it over ~12 frames like someone marking it live) —
   a pre-highlighted screenshot looks fake. Highlight the REAL sentence.
4. **Subtitles, not typography scenes.** The voice is carried by clean subtitles
   (one or two lines, max ~38 chars/line, bottom-left, white 700-weight on a
   subtle dark pill, following the .srt timings ±0.2s). NO full-screen text
   scenes, NO kinetic typography.
5. **Images with white backgrounds represent the beats**, sliding in from the
   left/right or from the bottom and settling (spring, ~20 frames). One image
   per beat: the friendly-text beat (74.8–86.1) MUST be a phone mock showing
   the SMS thread with the customer's first name on the message/image ("Hi
   Kate!"). Other beats: review-star visuals, a "2×" review-count counter,
   the offer card.
6. **One palette, no brown/cream.** White backgrounds, Google blue (#1a73e8)
   for actions/accents, red (#d93025) ONLY for the YOU ring and the scarcity
   line. Everything else neutral greys/near-black (#202124).
7. **No camera zooms, no scene repeats.** Motion comes from slides, scrolls
   and reveals only.
8. **Actor circle 330px, presenter = pedro.mp4.** Opening: circle CENTERED
   over the client's website, slides to the corner at ~7s and stays. Face crop
   from the 1920×1080 source: 700×700 at (610,80). In vertical layout put the
   circle bottom-RIGHT (subtitles live bottom-left).
9. **Opening beat** = the client's real website (07-website.webm) behind the
   centered circle. A browser-chrome frame (traffic lights + URL bar) around
   any web content — Playwright screenshots have no chrome, build it.

## Scene skeleton (vertical)

- S1 0–9.7s: browser chrome + real website; circle centered → slides to corner.
- S2 9.7–24.8s: Google-style SERP (kimi.tsx markup), top pack → long glide
  through the padded list; lead arrives plain.
- S3 24.8–30.4s: lead ringed red + YOU badge pops AT 24.8s ("there you are");
  subtle hold; drift back up for "the ones up top".
- S4 30.6–49.6s: support page in chrome, quote section directly; highlight
  animates in at ~37.5s as the quote is read.
- S5 50–66.2s: image slides — customer-at-door photo, "forgotten review" beat.
- S6 67.6–90.1s: three-step cards (white), each lighting up at its cue; step 2
  card contains the phone mock with Kate's SMS.
- S7 90.1–113.3s: "you climb" image + review-count counter doubling (59→118).
- S8 115.6–144.3s: offer card — £1/10 days → £99/mo cancel-any-time → 5-per-city
  scarcity line → "Tap the button" pill (Google-blue, gentle pulse).
- Subtitles overlay the whole video (except while full-screen actor moments, if
  any). Bubble bottom-right, subtitles bottom-left, safe margins ~60px.

## Gotchas already learned (don't rediscover)

- CSS scale() zooms need explicit `transformOrigin: '0 0'` or content drifts.
- The Google Help article lazy-loads; the review sentence sits inside the
  "Prominence" accordion — the provided capture already has it expanded.
- OffthreadVideo `startFrom`/`endAt` are in SOURCE frames (pedro is 25fps).
- No Math.random at render time — seeded rng only (see src/lib/human.ts).

## Acceptance checklist (verify before delivery)

1. Lead card invisible & unstyled until 24.8s; red ring pops exactly on "there you are".
2. Support page opens on the quote section; highlight draws in AFTER ~37.5s.
3. Subtitles match .srt within ±0.2s at five random checkpoints.
4. Step-2 beat shows the phone + Kate's name on the SMS.
5. Palette: white/blue/red only — zero cream/brown pixels.
6. No scene reused; no camera zooms.
7. Transcribe the rendered MP4 at 3 windows (e.g. 18–26s, 39–47s, 120–126s)
   with Whisper and confirm words match the on-screen beat.
