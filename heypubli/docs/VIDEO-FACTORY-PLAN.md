# The video factory: the plan, the numbers, and what is actually done

Written 26 Aug 2026. **This file is the source of truth for the ramp.** Update the
status table when something changes; do not keep it in your head.

---

## What the machine is

Every post is three pieces glued together:

```
[ ~4.7s blurred opening, three beats of text ]   unique per post
[ the account's body render                  ]   built once per master x account
[ one of 640 pre-rendered end cards          ]   picked per post
```

Only the middle piece is expensive, and it is never rebuilt. The two ends are
cheap. **A finished post takes 2.6 seconds to assemble** against 90 to 160
seconds to re-render the whole thing in Remotion. That ratio is the only reason
3,700 posts a day is possible at all.

Four things already run on their own every 2 minutes and are what the factory is
built out of. This was never a new machine, it is a retargeted one:

| Part | Where | Job |
| --- | --- | --- |
| Conductor | `/api/cron/video-pipeline` | enrol accounts, queue bodies, schedule posts |
| Render worker | VPS, systemd `heypubli-render` | build the per-account body renders |
| Publisher | `/api/instagram/publish` | post at the scheduled minute, via Outstand |
| Metrics | `/api/cron/metrics` | pull views back in hourly |

---

## The ramp

Hugo, 26 Aug 2026: ten today, twenty tomorrow, forty, then fifty, then cull the
weak accounts.

**74 accounts can post.** (87 were connected, 13 had dead Instagram auth and were
disconnected on 26 Aug.)

| Step | Per account | Posts that day | Outstand cost |
| --- | --- | --- | --- |
| 1 | 10 | 740 | $7.40 |
| 2 | 20 | 1,480 | $14.80 |
| 3 | 40 | 2,960 | $29.60 |
| 4 | 50 | **3,700** | $37/day |
| A month at 50 | | **111,000** | **$1,110** |

**Move the ramp by editing `VIDEO_POSTS_PER_DAY` in Vercel. Never by a deploy.**
Absent or nonsense values fall back to 3. It refuses to exceed 50, because
Instagram's own ceiling is 100 per account per 24 hours and half of it means a
double-scheduled day still cannot get an account rate limited.

### Views, projected from real data

Baseline measured 26 Aug: 60 still-connected accounts, 301 posts with metrics,
14,608 views, **48.5 views per post**. The spread is brutal: best account
averages 296, and 25 of 92 accounts have never had a single view.

Per-post reach falls as volume rises, because the follower base does not grow
with it. Use the middle column.

| | Posts | If reach holds | Likely | If it collapses |
| --- | --- | --- | --- | --- |
| Step 1 (10) | 740 | 36,000 | **~22,000** | 11,000 |
| Step 2 (20) | 1,480 | 72,000 | **~37,000** | 15,000 |
| Step 3 (40) | 2,960 | 144,000 | **~53,000** | 24,000 |
| Step 4 (50) | 3,700 | 180,000 | **~55,000/day** | 30,000/day |
| Step 4, monthly | 111,000 | 5.4M | **~1.7M** | 900,000 |

**Stop rule: if views per post halve when you double the volume, the ceiling has
been found and it is below 50.** Hold each step 3 to 5 days.

### Sales, at $9/month

94 members today = $846 MRR. The community is **$9/month, not free**, and the
about page says the price rises to $50 soon. At 1.7M views a month: roughly 0.2%
reach Skool, roughly 2% pay, so **~68 new members a month, +$612 recurring**.
Range 13 to 255 members.

Month one loses money ($612 in against $1,110 of fees). Month two breaks even.
Month three compounds, if churn stays low. **`skool_members` is empty, so those
two rates are industry ranges, not Hugo's numbers.** Step 3 of the ramp replaces
them with facts.

---

## The 15 August failure, and why it must never recur

**The pipeline was silent for eleven days and nothing said so.**

The sequence used to be a straight line: master 1, 2, ... 9, then nothing. 94 of
108 accounts reached `next_seq` 10, there is no master 10, the conductor found
nothing and broke out of its loop. No error. No alert. It was not broken, it had
run out of material.

Fixed by `masterIndexForCursor`: the library is a **ring**. Position 10 of a
9-master library is master 1 again. The cursor keeps climbing forever, so the
openings, captions and end cards keep moving even while the body repeats.

**The lesson is the monitoring one, not the code one.** Add an alert for "nothing
scheduled in 24 hours" before the ramp starts. See Open Risks.

---

## Uniqueness: what is true and what is not

| Piece | Unique? | How |
| --- | --- | --- |
| Opening picture | **yes** | 511 clips (11 Hugo's + 500 Pexels), every start second a different window |
| Opening look | **yes** | 10 fonts x 4 treatments x 4 centred positions x 2 aligns x 2 cases = **640** |
| Opening words | **yes** | AI-written bank, drawn in order, no account ever repeats one |
| Caption | yes | existing combos x per-account geo pack |
| End card | **yes** | 10 reveals x 8 offers x 4 layouts x 2 CTAs = **640**, plus duration jitter |
| Cover frame | available, unused | `reelThumbOffset` in the Outstand client, nobody calls it |
| **The body** | **NO** | 9 approved masters. This is the real risk. |

**At 10 a day an account laps the whole library every day. At 50 a day, five
times a day.** The intro is new, the card is new, the 30 seconds people actually
watch is not. No amount of render variation fixes this. **More master clips is
the only fix.** Two are sitting in `pending_approval` right now.

---

## Design decisions worth not relitigating

- **Black and white openings only.** Hugo, 26 Aug. Vary font, treatment,
  position, not colour. The blurred background is desaturated too, so the cut to
  the actor in full colour lands harder.
- **The hook never mentions AI, filming, cameras, or anything being fake.** The
  end card is the only reveal. This is enforced in code by `validateHook`, not in
  a prompt, because a prompt is a request.
- **The hook draw is oldest-first, not random.** A random draw repeats for an
  account long before the bank is exhausted (birthday problem). In order means
  every line is used once before any line twice.
- **End cards are pre-rendered PNGs.** The VPS then needs nothing but ffmpeg. No
  Python, no fonts, no design toolchain to keep alive on a server.
- **`media_url` keeps the plain body render until assembly succeeds.** If the
  assembler is down, the machine posts the plain version rather than nothing. A
  pipeline that degrades beats one that stops.
- **Files are served from the VPS, not Supabase.** 3,700 files a day at 15MB is
  55GB/day of egress. Delete after publishing.
- **One permanent geo pack per account.** 40 places. An account whose city moves
  is not anchored anywhere. Honest limit: hashtags are a weak geo signal and
  Outstand has no location field, so this buys differentiation, not local reach.
- **Price stays at $9** until it is proven to convert. Nothing on the card shows
  a price, so changing it later costs one image.

---

## Status

| # | Piece | State |
| --- | --- | --- |
| 1 | Hook bank (tables, validator, writer, draw) | **built**, 28 tests. Tables NOT applied |
| 2 | End card variation, 640 cards | **built**, 60MB, on Hugo's Mac only |
| 3 | Geo packs, 40 places | **built and wired**, tests pass |
| 4 | Ramp dial + derived slots + second-level stagger | **built and wired**, tests pass |
| 5 | Clip pool, 500 Pexels + 11 own | **downloaded**, 2.2GB, on Hugo's Mac only |
| 6a | Assembler core (`video/scripts/lib/assemble.mjs`) | **built and proven**, 2.6s/post |
| 6b | Worker loop: poll, assemble, upload, mark | **not written** |
| 6c | Janitor: delete published files | **not written** |
| 6d | Ship pool + cards + fonts to the VPS | **not done** |
| 6e | Hook writer cron | **not written** |
| — | Library ring (15 Aug fix) | **built and wired**, tests pass |

**Nothing is live. Nothing has posted since 15 August.**

### Blocked on Hugo

1. **Apply migrations `043_hook_bank.sql` and `044_assembled_posts.sql`.** The
   management token has no rights on project `oouwidqeipibalkjubvw`, and the
   dashboard SQL editor will not render in a background tab so it cannot be
   driven. Either Hugo pastes them into the SQL editor, or he supplies the
   database password once so this never blocks again.
2. **Approve the 2 pending masters** on `/admin/videos`. With the ring fix the
   sequence no longer dead-ends, but 9 masters at 10 posts a day is a full lap
   every day.

### Then, in order

3. Worker loop and janitor (6b, 6c)
4. Ship pool, cards, fonts to the VPS (6d)
5. Fill the hook bank with a first batch (6e)
6. Set `VIDEO_POSTS_PER_DAY=10`
7. **Watch one real post land on a real account before calling any of it working**

---

## Open risks

- **No alert when the machine goes quiet.** This cost eleven days. Nothing should
  ramp before "nothing scheduled in 24 hours" pages somebody.
- **Nine masters.** The single biggest risk to the whole plan.
- **Outstand rate limits are unknown.** 3,700 posts a day is 2.6 a minute, all
  day. Nobody has asked them. Worth an email before going past step 2.
- **Storage.** 55GB/day at step 4. The janitor is not optional, it is the
  difference between the server working and not.
- **Own-footage pool runs dry in ~52 days** at step 4 on its own. Pexels covers
  it, but that ratio is worth rechecking if the mix changes.
