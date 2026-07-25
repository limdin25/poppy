# VSL HANDOFF — per-lead video pipeline

For the developer building the per-lead render pipeline on top of the finished
v12 video. Read this file end-to-end before touching anything. The companion
spec with the design rules the comps cite ("rule 4", "rule 6"…) is
[REBUILD_PROMPT.md](REBUILD_PROMPT.md).

## 1. Current state (2026-07-25)

- **Master render: `video/out/flow-v12.mp4`** — 1080×1920 @30fps, 155.05s
  (2:35), 42MB, Hugo-approved. (`out/flow.mp4` is one cut STALE — v11. The
  npm `render` script still writes to `out/flow.mp4`; use the explicit
  command below.)
- Composition: `FlowVideo`, 4650 frames = 152.08s of speech + a 3s end-card
  hold. TypeScript is clean (`npx tsc --noEmit` → 0 errors). Node v22.x,
  Remotion 4.0.497.
- The voice is **one permanent recording** (Hugo's HeyGen actor, played at
  1.2x). It contains **zero** business names, towns or trades — that is the
  design contract that makes per-lead rendering cheap. Never re-time scenes
  per lead; only the visuals of S1+S2 change.

## 2. Render

```bash
cd /Users/hugo/Whats/Poppy/video
npx tsc --noEmit                                   # must stay at 0 errors
npx remotion render src/index.ts FlowVideo out/flow-v12.mp4 --codec=h264 --concurrency=8
```

~10 min on this Mac (Margarita — the chosen render host, £0/video; throttle
so the Rightmove scraper never starves). Verify by extracting stills:
`ffmpeg -i out/flow-v12.mp4 -vf "select='eq(n,FRAME)'" -frames:v 1 x.png`.

## 3. Scene map (what is per-lead vs permanent)

| Frames | Scene (src/comps/) | Per-lead? |
|---|---|---|
| 0–246 | `OpeningWebsiteV` — lead's mobile site in a phone | **YES** |
| 246–940 | `GoogleScrollV` — SERP, 5 down-flicks, name selection | **YES** |
| 940–1268 | `SupportSceneV` — Google's own page, mouse selection | no |
| 1268–1684 | `WhySceneV` — door photo + review-that-never-happens | no |
| 1684–3110 | `StepsSceneV` — logos → customer list → SMS phone → Google-legit → review typed + MiniLadder | no |
| 3110–4650 | `OfferSceneV` — momentum → £1 → £99 → owner-reply → scarcity → CTA + end card | no |

Full-length overlays: `Audio` (audio/pedro-full.m4a), `SubtitlesV`
(src/data/captions.ts), `PedroBubbleV` (public/pedro.mp4 in the 330px circle;
freezes on its last frame from f4548 — never let OffthreadVideo seek past the
source's end).

## 4. THE PER-LEAD SWAP LIST (everything the pipeline must change)

### S1 — the lead's website
1. **`public/client-mobile.png`** — recapture per lead with
   `video/capture-mobile-site.mjs` (Playwright, iPhone 13 @2x, fullPage).
   The target URL is **hardcoded at line 18** — parameterize it first.
   Playwright resolves from the REPO-ROOT node_modules, not video/'s.
   Gotchas baked into that script: use `www.` + `waitUntil: 'domcontentloaded'`
   (bare domain / networkidle can die with ERR_CONNECTION_CLOSED), and it
   DOM-removes cookie-banner containers — but only ones containing the
   literal text "We use cookies"; other consent wordings survive, so eyeball
   each capture.
2. **`src/comps/OpeningWebsiteV.tsx:99`** — the Safari pill URL text is
   hardcoded `theboilerclubonline.co.uk`. Parameterize from lead data.
3. Same file — scroll range `[50, 235] → [0, 880]` assumes a tall capture;
   880px of scroll (in 780-wide source pixels) must exist. Clamp to
   `imageHeight − viewport` if a lead's site is short.

### S2 — the Google SERP (`src/comps/GoogleScrollV.tsx` + `src/data/lead.json`)
4. **`src/data/lead.json`** — `business / town / rating / reviews` are read at
   GoogleScrollV.tsx:22 and rendered on the lead's row + search pills
   ("plumbers in {town}", "Serves {town}"). `rank`/`pack` in that file are
   **legacy** — v12 does NOT read them; the pack lives in ROWS (next item).
5. **`ROWS` (GoogleScrollV.tsx:28-52)** — the 23-row pack is HARDCODED for
   Glossop: real competitors (GasCare, Screwfix Glossop, …) interleaved with
   8 invented locale-flavoured pads (High Peak, Dinting, Simmondley,
   Hadfield…). Per lead: fetch the real pack from
   **`GET https://app.heyelsie.com/api/leads/rank-frame?contact=<wk_contacts id>`**
   (live; response is `{ ok, lead, pack }` from Google Places, sorted by
   review count, lead spliced at its real rank, 24h edge cache, public by
   design; local runs need `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GOOGLE_PLACES_KEY`/`VITE_GOOGLE_PLACES_KEY` — the Places key is
   referer-restricted, the endpoint sends the poppy-henna.vercel.app referer
   itself). **Data prerequisite:** it reads `contact.name` +
   `custom_fields.owner_name/town/rating/reviews/rank/google_search_url`,
   which only the plumber-leads import populates
   (docs/PLUMBER_LEADS_PIPELINE.md) — validate `town` and `rank` exist or
   the pack silently degrades ("plumbers in ", lead appended last). Then pad
   with invented locale-plausible names so the lead sits at **index ≈18** —
   deep enough that exactly **5 flicks** reach it (the recording says "Down"
   5 times; that count can never change), with 2–4 real rows below so the
   lead isn't visibly last. Keep review-counts of rows ABOVE the lead higher
   than the lead's (that's the story).
6. **`SEL_W = 362` (GoogleScrollV.tsx:113)** — pixel width of
   "Energywise Heating Limited" at 27px Arial. The blue drag-selection stops
   at this width. **Re-measure per lead name** (canvas `measureText` at 27px
   Arial, or opentype.js) or the selection under/overshoots the name.
7. **`FLICKS` targets (GoogleScrollV.tsx:75-81)** — `at` frames are locked to
   the audio (never touch); the 4 intermediate `to` targets (780/1620/2520/
   3400) are tuned for Y_LEAD≈4128. Recompute as even fractions of `Y_LEAD`
   (which auto-derives from LEAD_INDEX) when the pack changes.
8. **`scrollY` fly-back midpoint `2100` (GoogleScrollV.tsx:93-94)** — use
   `Y_LEAD/2` instead of the constant when the pack changes.
9. **Area code (GoogleScrollV.tsx:61)** — ghost listings' phone numbers are
   `01457 …` (Glossop). Substitute the lead town's STD code.
10. **Trade strings** — "plumbers in {town}" (:244), pill `value="plumber"`
    (:248), "· Plumber" row label (:162). Fine for the current plumber
    campaign; parameterize when another trade is targeted.
11. The signed-in Google avatar in the SERP header (:238) is a hardcoded "M"
    monogram — a **generic mock**, not the lead's initial (it coincidentally
    matches the demo lead's owner "Michael"). Leave it or randomize; don't
    wire it to lead data.

### The "generic" back half — one caveat
The voice never says a trade, but three visual props are plumbing-flavoured
(fine for the plumber CSV, swap for other trades):
- `StepsSceneV.tsx` `REVIEW_TEXT` — "new boiler fitted next day…"
- `ClimbSceneV.tsx` `CUSTOMERS` — job labels (New boiler, Radiators…)
- `OfferSceneV.tsx` `REVIEWS` — "sorted the leak", "radiators"

## 5. If the voice recording ever changes (the retime recipe)

1. 1.2x the new file: `ffmpeg -filter_complex "[0:v]setpts=PTS/1.2[v];[0:a]atempo=1.2[a]" …`
   → replace `public/pedro.mp4` + extract `public/audio/pedro-full.m4a`.
2. Whisper word timings on the sped audio: OpenAI `whisper-1`,
   `response_format=verbose_json`, `timestamp_granularities[]=word`
   (key lives in `/Users/hugo/Whats/Lemlin/.env.local`).
3. Scale the HeyGen SRT timestamps ÷1.2 → `src/data/pedro.srt`, run
   `node scripts/gen-captions.mjs`, **then re-time the generated chunks to
   the whisper words** — HeyGen spreads long cues evenly and drifts ~2s
   (v12 used a Needleman-Wunsch token alignment; normalize 10/ten,
   99/ninety-nine). Do NOT ship gen-captions output raw.
4. Re-derive every scene window + in-scene cue from the word dump; update
   `Root.tsx` duration (speech frames + ~90 hold) and `PedroBubbleV`
   FREEZE_AT. Actor circle crop is 700×700 @ (610,80) of 1920×1080 — re-check
   if the HeyGen template changes.

## 6. Codebase gotchas (each one cost real debugging time)

- Remotion `interpolate` inputRange must be INCREASING — a decreasing range
  crashes the render with opaque scheduler errors.
- No `Math.random()` / `Date.now()` in scene code — parallel render workers
  must be deterministic (use `src/lib/human.ts` seeded rng).
- CSS scale needs explicit `transformOrigin: '0 0'` or content drifts.
- Subtitle lines need `whiteSpace: 'nowrap'` or CSS re-wraps to 3 lines.
- `OffthreadVideo` must never seek past the source's end — wrap in
  `<Freeze frame={…}>` (see PedroBubbleV).
- Legacy comps: the SCENE comps without the `V` suffix (GoogleScroll,
  OpeningWebsite, IntroWebsite, StepsScene, OfferScene, SupportScene,
  DealScene, EndCard, ActorBubble, ActorLayer, DashboardClips, Footage,
  PedroBubble) are from the old horizontal cuts — not in the render tree,
  reference only. **Exceptions that ARE live: `Cursor.tsx` and `kimi.tsx`**
  (imported by the V scenes) plus `Wordmark.tsx`. Same legacy status for
  `public/` heavy media (cinematic*.mp4, actor*/, clips/, r*-.m4a, voice/)
  and the `gen_voice*` TTS experiments.
- `public/support-page-clean.png` (S3's base) came from
  `capture-v8-assets.mjs` + hand retouching (PIL: yellow highlight
  chroma-removed, frozen sticky bar erased). **Do not recapture it** — the
  selection rects L1/L2 and the 1680px width are hardcoded in
  SupportSceneV.tsx for this exact image (support-quote.json is legacy,
  ignored). The scene is lead-independent; there is no reason to touch it.

## 7. Git / deploy status

- `video/` source is **committed** on branch `reviews` (commit 516aa83).
  `.gitignore` excludes renders and heavy media (`video/out/`,
  `video/public/*.mp4`, actor clips, TTS venv); the light assets are in
  (logos, PNGs, audio/pedro-full.m4a: 3.5MB, needed to render).
- `public/pedro.mp4` (the actor video, needed for the actor circle) is
  git-excluded. **Download it from the repo's release:**
  https://github.com/limdin25/poppy/releases/tag/vsl-v12-assets
  → `pedro-actor-1.2x-SEND-THIS.mp4`, save it as `video/public/pedro.mp4`.
  Verify before rendering: **71,262,096 bytes, 2:32 duration,
  MD5 `193bd850164cc2cf0bf68d08eef0476c`** — this is the 1.2×-speed cut the
  scene timings are built on; the original 3:02 recording will put every
  scene off-beat.

## 8. What already EXISTS vs what to build

**Already LIVE (shipped 2026-07-25, launched dark — do NOT rebuild):**
- `api/vsl/page.ts` — the per-lead video page at `heyelsie.com/{slug}`
  (headline, vertical video player, tier sheet).
- `api/vsl/checkout.ts` — the £1-today + subscription Stripe session.
- `api/vsl/track.ts` — funnel beacons (tapped→page→checkout) into
  `wk_vsl_events`.
- `api/lib/vsl-provision.ts` — account provisioning from the Stripe webhook.
- `api/cron/vsl-automation.ts` — the SMS follow-up automation.
- The CRM side: `api/crm/vsl-page.ts` +
  `src/features/crm/components/live-call/VideoLinkButton.tsx` — the dialer's
  "Send video" button already creates the page and texts the link.

**The ONE missing piece — the render pipeline (§4 is its spec):**
given a `wk_contacts` id → capture the mobile site → regenerate lead.json +
ROWS (rank-frame API + pads) + SEL_W + area code + URL pill → render on this
Mac (§2) → upload the MP4 (Supabase storage is the obvious home — also
solves §7's pedro.mp4 problem) → **write its URL into
`wk_vsl_pages.video_url`**. That column is the contract: the live page plays
`page.video_url || settings.default_video_url`, and
`api/lib/vsl-settings.ts` explicitly marks `default_video_url` as
"placeholder until the render pipeline lands". Optional second piece:
Hugo's agent review-before-send step (render → agent watches → then send).
