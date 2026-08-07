# HeyPubli funnel: where we are

Live status of the creator funnel and everything fixed while running it.
Updated as things happen. Newest first.

---

## 07 Aug 2026, later that night: on the funnel's number, the number is the product

Hugo, seeing the inbox still full of unanswered threads two hours after the
session above: "No reads can be neglected like this. We are spending money on
this." The pile turned out to be the earlier session's own blind spot.

### Why threads were still sitting there

The product stamp was CONTENT-matched (a Meta form message) with +91 skipped on
purpose. So every Indian form-fill arriving after the door closed created a CRM
thread that nothing would ever look at: not stamped, not relayed, not counted
by the monitor (whose universe is stamped threads), no badge. Eight arrived in
one evening because the Meta ad was still delivering to India; the "we are not
running ads there anymore" premise behind the afternoon delete was wrong. Hugo
found the mis-set ad location and fixed it himself.

### The once-for-all rule

Audited 7 days of WhatsApp on +447460035763: 100 percent heypubli traffic. So
wk-sms-incoming now stamps EVERY inbound on that number, whatever the message
says (the form regex stays as a net for any future second number). Country
policy is the reply brain's decision, recorded in funnel_replies; it is never
again made by hiding a thread from the brain. A closed-country lead with no
account and no lead row gets a recorded silence claim ("closed country, blocked
on purpose"), nothing sent. Hugo was offered one polite goodbye per Indian
lead, chose it, then reversed within minutes ("just block and delete the
indians"); the goodbye code was written and removed in the same session.

### Deleted

84 more +91 CRM threads (tonight's 9 arrivals plus every no-account leftover
from the morning), verified against BOTH HeyPubli tables first: the only +91
numbers with a profile or lead row are Marry, Prem, Bhupender, Ashwini (plus
one lead number with no thread), and exactly those 4 threads remain. Child rows
were removed via the FK map (15 referencing tables), then the contacts.

### A reply that failed to send is not an answer

Thread +2579038539225729 wore a green "answered" badge while its reply had
status `failed`: the "phone" is a 16-digit WhatsApp privacy ID (Meta LID) that
Twilio cannot address, so the person received nothing. Two fixes: the badge
maps a failed newest reply to a red REPLY FAILED, and the monitor email carries
a standing "Replies that FAILED to send" list (newest-claim-per-phone, last
48h, 'undelivered' excluded because that count exists already). Deliberately
NOT an urgent re-alarm: autoReply.failed already alarms in the window the
failure happens; the standing list rides the hourly email instead of paging
every 5 minutes. Both privacy-ID threads (+257..., +179...) are claimed,
failed, and honestly labelled; they are unreachable and no retry is possible
(one action per inbound).

### Verified live, 20:15 UTC

Monitor: waiting 5, neverLooked 0, replyFailed 2, undelivered 0, heartbeats
reply 1 min / tick 2 min. Browser check of the inbox: zero India threads, new
Bangladeshi arrivals answered (Sanat 17 min, badge ANSWERED), REPLY FAILED
rendering, and the drip chased SM Omar Faruk with his short coded link at
20:12 while his handover badge still says NEEDS YOU (the badge reads the reply
brain only, drip sends do not clear a handover, which is correct: a human
should still glance).

---

## 07 Aug 2026, night: India is out, the brain answers in 30 seconds, and silence is now visible

Hugo: "the inbox must be perfect and clean, with intelligence." Built in one
session, deployed to production on both apps.

### India: deleted, and the door is shut

Hugo, when told the payouts-blocked pile (about 70 percent of ad flow) was
getting total silence: **"just block and delete everyone, we are not running ads
there anymore."** Scope he confirmed: keep every creator with an account
(Bhupender, Marry Jain, Prem finished; Ashwini mid-way), delete the rest.

- **56 Indian no-account leads deleted** across two rounds, plus their CRM
  threads on the Elsie side (33 first round, then 29 more because THE SHEET
  RE-IMPORTS DELETED LEADS: their rows live in the Google Sheet forever, and
  deleting the signup_leads row deletes the dedupe that kept them out. That
  re-import also re-emailed 28 Skool invites before the door closed. Lesson:
  **never delete sheet-fed leads before the door that refuses them is live**).
- **The door**: sheet-sync and the fb-leads webhook refuse any
  `pitchBlockedForPhone()` number at import. No lead row, no CRM contact, no
  invite, no drip. Counted per run in
  `funnel_monitor_state.sheet_sync_last_refused_blocked` (32 on the first live
  run) and shown in the monitor email.
- The 4 kept creators still never get recruited (reply-brain guard unchanged);
  their questions still get answered.

### Speed: triggered, not polled. Webhook -> 20 to 45 second settle -> one reply

Hugo: "every time a new message comes the AI has to be triggered and reply
within like 30 seconds. Not one second, but 30 seconds, to sound natural."

- wk-sms-incoming's relay to heypubli is now **fire-and-forget**
  (`EdgeRuntime.waitUntil`), so Twilio's webhook is never held. It used to be
  awaited inside Twilio's request: past ~15s Twilio retries, which means
  duplicate inbounds.
- `/api/webhooks/whatsapp-inbound` answers 200 immediately, then (via
  next/server `after()`, maxDuration 120) sleeps `settleDelayMs()` = 20 to 45
  seconds varied, and runs `runTriggeredReply` for that one thread.
- **The debounce**: each inbound starts its own settled invocation; when the
  pause ends, `stillOwnsThread()` lets only the invocation whose trigger is
  still the NEWEST inbound act, and splitThread already gathers everything
  since our last outbound, so "hi" + "i saw your ad" + "how does it work" get
  ONE answer. Tested pure in reply-runner.test.ts.
- The every-minute cron stays as the safety net. The claim-first unique index
  on in_reply_to is what makes webhook + cron on one message safe.

### The invisible-lead class that had Hugo watching a 10 minute wait

Angelica filled the form with one number and messaged from another. Her contact
was never stamped product=heypubli, so she was invisible to inbox_summary, the
relay, and the brain: not parked, not handed over, simply NEVER SEEN. Six more
(+91) sat in the same hole. Fixes, all live:

- wk-sms-incoming stamps any WhatsApp contact whose message carries a Meta lead
  form (labels or "filled in/out your form"), +91 excluded.
- The reply runner **adopts the lead by the form's own email/phone**
  (`formDetails` + `adoptLeadByFormDetails`) and heals `whatsapp_e164` to the
  number they actually message from, which also redirects the drip and gives
  them their watch code.
- Angelica was answered at 17:55, replied, and got the signup link at 17:57.

### Problem B is dead: every decision leaves a row, and the inbox shows it

- Skips now claim too: opted-out and do-not-text threads get a `silence` row
  with the reason instead of a bare `continue`, so "deliberately quiet" is
  recorded, not inferred.
- **The CRM inbox badge** (Elsie repo: `api/crm/heypubli-brain.ts`,
  `useHeypubliBrain.ts`, InboxPage): per creator thread, ANSWERED (green),
  QUIET ON PURPOSE / REFUSED / OPTED OUT (grey, reason in the tooltip), NEEDS
  YOU (amber, reason), DECIDING (under 3 min old), **NEVER LOOKED AT** (red,
  the alarm), and BRAIN: CANNOT CHECK when the cross-project lookup fails.
  Three answers, never two, same rule as the journey panel.
- **The monitor now counts a precise miss**: a waiting thread whose newest
  inbound has NO funnel_replies row and whose lead is not opted out, with 3
  minutes of grace. Subject line becomes "IGNORED: N threads the brain never
  looked at" and it emails urgently on every run until zero. Handovers stay a
  separate, calmer count: "handed to you on purpose".

### The watcher is watched

- `/api/funnel/reply` and `/api/funnel/tick` stamp heartbeats
  (`reply_last_ok_at`, `tick_last_ok_at`, migration 032). The monitor alarms
  ("DEAD BEAT") when reply is quiet over 10 minutes or tick over 20.
- **The dead man's switch lives on the Elsie app** (`api/cron/heypubli-deadman.ts`,
  Vercel project poppy, every 10 minutes), a different Vercel project with its
  own cron system, reading the heartbeat stamps straight from the HeyPubli
  Supabase and emailing through Resend from Elsie. If heypubli's crons die, the
  funnel's own monitor dies with them; this one does not. Re-alarms at most
  every 30 minutes (gate stored in Elsie's platform_settings).
- **Proven, not assumed**: fired with `?threshold=0&force=1` on 07 Aug 18:28,
  and "HEYPUBLI FUNNEL DOWN: sheet-sync stopped" shows `delivered` in Resend.

### Delivery is not sending

`whatsapp_undeliverable_code` had readers and no writers. The tick's new phase
4 (`sweepDeliveryStatus`) polls `message_status` for the newest nurture sends
and brain replies; `undelivered`/`failed` flips the send row, writes the code
on the lead (the drip's channel pick reads it), and the monitor counts
"messages Twilio accepted and then never delivered" over 48h.

### Two ladders, one voice

The same-day check-ins (15/90 min) and the slow nudges (2h/22h/44h) could both
fire around the 2 hour mark. runOnboardingNudges now treats the newest
check_in row as its own last touch, so the gap rule spaces the two ladders
together. And nobody falls between them silently any more: the monitor email
lists **"Nobody is chasing these"**, leads whose drip finished or never armed
(pre-signup only) and creators whose nudge ladder stopped, each with why. The
14 "idle" leads from the audit are that list now; most were India (deleted),
the rest are post-signup (nudge ladder owns them) or QA rows.

### Short watch links

Hugo: "we dont need a url this big." New links are
`heypubli.com/watch?u=XXXXXX` (first 6 characters of the lead id). The token is
opaque to every consumer, old long links keep working.

### Still open, said plainly

- `check-creators.mjs` (live Instagram verification) is still hand-run, not on
  a schedule. Not built tonight; it needs its own careful hour.
- The LLM fallback's system prompt still names the bare /watch link; the coded
  link is injected per-lead at call time, so this only matters if a lead has no
  code at all.
- New +91 numbers can still text the WhatsApp number directly (nothing imports
  or stamps them now); they land as plain CRM contacts. Ads are off, so this
  tapers to zero.

### The posting pipeline: built, empty, waiting for content

`campaign_items = 0`, `scheduled_posts = 0`, while 4 creators sit finished.
The machinery EXISTS end to end: admin campaigns fan out per-creator
`scheduled_posts` rows (with a 0 to 90 min anti-coordination jitter), and the
`/api/instagram/publish` cron (every 15 min, already live) publishes via
Outstand. Nothing has ever filled it because no campaign with real media has
been created. First real post = one campaign + one video + the finished
creators as members. Content generation (UGC factory) is a separate build
Hugo has not asked for yet.

## 07 Aug 2026, night: a lead who just acted is awake, whatever the clock says

Hugo, watching form leads land at 23:00 Dhaka time: "If the leads are coming at
this time, we can reply them any time. If they come in the middle of the night,
we still reply them because they are awake."

Quiet hours were built so WE do not open conversations at 3am. They were never
meant to make a person who submitted the form ninety seconds ago wait until
09:00 for the welcome, which burns the hottest minutes a lead ever has.

`mayContactNow()` in [lib/data/lanes.ts](../lib/data/lanes.ts): inside the
lead's daytime, always send. Outside it, send only when the lead's own last
action is under an hour old, because the nurture sweep re-arms day-old strays
and those owners genuinely are asleep. A fresh action also outruns an unknown
timezone: the fail-closed timezone rule guards against waking somebody, and a
person who just acted is awake wherever on earth they are.

Unchanged on purpose: the check-in ladder ("is everything ok?") and the cold
backlog sends still keep strict local hours, and the payout-block guard still
runs before any clock question, because a blocked lead is blocked at noon too.

Replies never had an hours gate, which is why the auto-reply was already
answering Indian evening messages correctly. First touches were the gap.

---

## 07 Aug 2026, late evening: the form opener gets a tested answer, and the video link carries its code

Found by watching the machine answer its first unsupervised form lead (Sudayan,
17:10). The reply was good, but the decision trail read "no confident reading, a
guess here pitches the wrong person": the message Meta composes when a lead taps
the ad's WhatsApp button, which is the single commonest cold inbound and nearly a
CONSTANT, had no bucket in the brain. Every form lead's first message was LLM
improvisation.

- **`FORM_FILL` bucket in reply-brain.** Anchored on the labels ("First name:",
  "Phone number:"), because the greeting arrives translated into the lead's own
  locale while the labels stay English. Routes to the existing tested
  `explain_then_video` copy with the lead's own link. Never fires twice: a form
  opener arriving AFTER the video already went is handed to a human.
- **The LLM now receives the lead's coded watch link** and is pinned to it
  character for character. Its system prompt names the bare `/watch` URL, which
  works but lands the visit as ANONYMOUS (`features/watch-page/track.ts`: without
  `?u=` the visit ties to nobody), so every fallback reply was quietly throwing
  away the attribution the coded link exists to provide.
- Known crease, accepted: a lead who got the bare link from the old fallback and
  then says yes will get the coded link too, because "never the same link twice"
  matches on `/watch?u=` and the bare link does not contain it. Two video links
  in one thread, once, for the handful of leads answered before this shipped.

---

## 07 Aug 2026, evening: the brain answers by itself now

Supersedes the afternoon entry below where the two conflict.

- **No wait on new leads.** Hugo: "as soon as they come we message them." The 10
  minute grace is gone; sheet-sync arms at NOW and pokes the tick, so the
  welcome leaves within the minute the row lands in the sheet.
- **Auto-reply is LIVE** (`auto_reply_enabled`, `/api/funnel/reply` every
  minute). Two layers: the deterministic reply-brain answers what it can prove;
  the LLM fallback ([lib/data/llm-reply.ts](../lib/data/llm-reply.ts), Sonnet,
  hard guardrails: no cash figures beyond the 40 percent rate, no country
  rulings, max 2 sentences, may always say HANDOVER) writes the rest. First
  live pass: 3 replies sent, 3 refusals opted out, 2 acks silenced, 0 errors.
  Claim-first idempotency in `funnel_replies`: ONE action per inbound message
  ever, one check-in per (profile, step, rung). The 15/90 minute check-in
  ladder is wired, quiet-hours gated, newest signups first.
- **One brain per thread.** wk-sms-incoming no longer enqueues Elsie's own AI
  for heypubli-stamped contacts, and the 139 stale drafts were deleted.
- **Email is hourly, alarms are instant** (shouldEmailNow). The cron stays at 5
  minutes for the circuit breaker.
- **CRM per-user customization, first instance.** Agent hello@heypubli.com owns
  all 125 heypubli contacts; pipeline "HeyPubli Creators" auto-moves cards from
  live funnel state (`api/cron/heypubli-pipeline-sync`, every 10 min, Elsie
  side); /admin/crm/reports gained a HeyPubli tab (`api/crm/heypubli-report`).
  Nothing outside product=heypubli is ever touched.
- **Second adversarial review before enabling**, all confirmed findings fixed:
  claimed threads starving the reply slots, image-only replies filed as
  silence (now a loud handover), 24-72h threads burning their one claim on a
  guaranteed window_closed, refusals invisible to the email-joined nudge
  ladder, creator-state reads failing into "cold lead", the tick poke making
  overlapping ticks routine (tick has a run lock now), check-in scan pinned to
  the 40 oldest profiles forever.
- **Still on the next-build list:** the brain reading Hugo's email replies as
  instructions, and vision on inbound screenshots. Both currently land as
  loud handovers instead.

## 07 Aug 2026, afternoon: the funnel runs itself now

Built after Hugo wired Meta lead ads to a Google Sheet and said "keep moving".

**The new intake path.** Meta lead form -> Google Sheet (Meta's own CRM
integration, zero Zapier tasks) -> `/api/funnel/sheet-sync` (cron, every
minute) -> `signup_leads`. Idempotent on `fb_leadgen_id`. The Skool invite is
queued at import, community first. The sheet had only Meta's test row when this
shipped; the machine is waiting for the ads to switch on.

**The 10 minute rule.** A form lead is supposed to message us on WhatsApp
themselves. Import stamps the CRM contact `product=heypubli` (so their reply is
relayed and stops the drip), then arms nurture at now+10min. Someone already in
a live conversation (inbound within 24h) is handed to the inbox instead, and
the tick re-checks the thread right before sending as the last line of defence.
All three layers exist because a review agent proved each single one leaks.

**The 5 minute email.** `/api/funnel/monitor` emails hugodesouzax@gmail.com
every 5 minutes: new leads, sends, failures, who is waiting on a reply and for
how long, whether the sheet is still being read, which templates Meta still
sits on. It always emails, including "quiet", because a silent report and a
broken reporter look identical. It is also the circuit breaker: 3 failed sends
in 15 minutes flips `nurture_enabled` off and every email keeps shouting the
pause until somebody resumes.

**The drip is ON** (`nurture_enabled=true`, flipped this afternoon). Step 0
(welcome, approved template) sends 10 minutes after a quiet form lead. Steps 1
and 3 point at the Lim-signed onb2 templates, still pending with Meta; the tick
defers them daily until approval, and the monitor announces the approval.

**Phones are strict now.** Both intake paths refuse a number that does not
declare its country (+ or 00). Blindly prefixing "+" onto bare national digits
invents a number in another country (9824840910 in India becomes +9824840910,
Iran) and texts a stranger. Dropped rows are counted and shown in the email.

**Found by adversarial review before it could happen, all fixed:** the webhook
armed at NOW with no checks while sheet-sync armed at +10 with them, so the
race decided whether the safety layer existed; a reply during the grace never
stopped the drip because the relay only matches contacts stamped
`product=heypubli` and the stamp was only written on first OUTBOUND; a crash
between insert and arm stranded the lead in idle forever (arming is a sweep
now, so every run heals strays); a crashed tick collapsed the multi-day drip
into back-to-back sends; kept/conflict sheet rows were re-resolved every
minute forever, filing a fresh conflict row each time; the PAUSED alarm only
existed in the one email that flipped the switch, and a Resend outage
swallowed it entirely.

---

## Scoreboard, 07 Aug 2026, 10:15 UTC

| | |
|---|---|
| Leads reopened this morning | 110 |
| Replies | ~60 |
| Distinct leads who opened the video | 14 |
| **Signups** | **6** real (Nzama/+447863992555 is Hugo's own test account, excluded) |
| **Fully onboarded, 5 of 5 steps** | **3** |
| Refused and permanently excluded | 7 |

Six signups in one morning, on a funnel that before today **had never been
finished by anybody**. Signup six, Prem Bharti, had his invite 53 seconds after
creating his account.

**"Connected" is not "onboarded".** Four creators have connected Instagram, which
is step 1 of five. One has finished all five. The "New account connected" emails
count connections, not completions.

Before today: **zero** self-serve creators had ever finished onboarding, and the
funnel had a dead end at step 2 that made finishing impossible.

### The three signups

| Creator | Country | Instagram | Steps | Next |
|---|---|---|---|---|
| Bhupender | India | @kaorimodel04 | **5/5** verified, bio link live | done |
| Marry Jain | India | @marry.jain_01 | **5/5** verified, bio link live | done |
| "Discipline X" | Bangladesh | @indiscipline_com | 2/5 | affiliate link |
| Ashwini Agarwal | India | @extramaritalfacts (8,892 followers) | 1/5 | community |
| Ma. Edelyn Cabanlig | Philippines | @lynster123 | 1/5, step 2 ticked for her | the affiliate link |
| Prem Bharti | India | @upharprem | **5/5** verified, bio link live | done |
| Nzama Mo | UK | @ketoqiz | **5/5**, but **WRONG SKOOL LINK** in bio | fix the link |

Every creator has a real email address and every Skool invite is confirmed sent.

Verify any of this yourself, it reads Instagram's live API rather than our own
tables:

```bash
cd heypubli && node scripts/check-creators.mjs
```

---

## What was broken and is now fixed

Everything below was found by running the funnel on real people, not by reading
code.

### The funnel could not be finished at all
A creator who signed themselves up was told to look for an invite email that
**nothing had ever sent**, then asked for a link that only exists inside the
community they had not been invited to. Fixed by adding the "Send me the invite"
button that actually queues and sends one.

### The invite waited up to five minutes
Dispatch only ran on a 5 minute cron. Our first creator pressed the button 21
seconds after signing up and then stared at an empty inbox; his invite only left
because it was run by hand. It now sends **on the button press**, with the cron
kept as the retry. Measured on the next real creator: **26 seconds**.

### "Send it again" sent nothing
It collided on a duplicate key, returned success, and the page said "on its way
to you" while nobody had been emailed. It now really re-sends.

### The signup email was in Portuguese
Every lead is in India, the UK, the US, Bangladesh or the Philippines, and the
sign-in email arrived entirely in Portuguese, including the line telling them
where to type the code. Rewritten in English, code first.

### Nobody had ever proved you could log back in
The emailed sign-in code round trip had never been completed by anyone. Proved
end to end on 07 Aug: code requested, email read, session issued.

### Settings told connected creators they were not connected
It read `instagram_connections`, which is empty and always has been. The live
integration writes `outstand_connections`. Same wrong-table read also produced a
false report that nobody had ever connected an Instagram. Now reads the live
table first.

### The Disconnect button did nothing
Onboarding has always promised "you can disconnect whenever you want from
Settings". The button had no click handler at all, and the only working
disconnect was admin-only. Now built, with a confirmation, and it clears **both**
connection tables, because clearing only one is how somebody keeps getting posts
after asking us to stop.

### We promised a niche we cannot deliver
The landing page said "you tell us your niche" and the FAQ promised content
"aligned with your niche". We cannot niche accounts; it is general AI lifestyle
content. All removed, and a test now forbids the word so it cannot creep back.

### Two of the first three signups typed an unreachable number
One was a single digit out, one kept the local trunk zero after the country code
(`+88001306661213`). The form's only rule was "at least 10 digits", which accepts
both. Numbers are now normalised, corrected in front of the creator, and the
signup link carries the number they message us from so there is nothing to
retype.

### Refusals were being ignored
A lead answered "Not interested" and was pitched again 70 minutes later. Then
"No..thanks" slipped through because every pattern demanded a space between the
words. Then a bare "Close" slipped through, which is the literal answer to
"shall I close your application?". All three now caught, in both the outreach
script and the product, with tests pinning real messages.

### Outreach ran at the wrong hours
A wave went out at 23:50 India time and one message reached Singapore at 03:27,
because the guard compared UTC. Sending now fails closed on an unknown country
and gates on the lead's own local hour.

---

## Mistakes worth remembering

**The first message 110 people ever got was "shall I close your application?"**
Chosen because it was approved and pulled replies, never read as a first touch.
To someone who filled a form and heard nothing for three days it is insulting.
Two replied "Close" and "Please close". The reopen script now **refuses to run**
unless it is pointed at an approved welcome template.

**A monitor that tells you to message someone who said no is worse than none.**
The unanswered-leads check counted a refuser as waiting for a reply. It now
excludes anyone tagged.

**Stopping the loop stops the watchdog.** During an 8.5 hour pause, seven leads
piled up unanswered. One had said "Yeah i would be interested" at 21:59, got no
reply, and withdrew at 22:06. Seven minutes.

---

## Reading what leads send us

Leads send screenshots when they are stuck, and until 07 Aug nobody could see
them. Inbound media was already being captured into `wk_sms_messages.media_urls`,
but those are `api.twilio.com` URLs that need account credentials, so they could
not simply be opened.

`scratchpad/fetch-screenshots.py` downloads them with auth and writes real image
files:

```bash
python3 fetch-screenshots.py                    # last 2 hours
python3 fetch-screenshots.py --phone=+639154288063
```

Asking for a picture ends the guessing. "It's not allowing me to" could be four
different screens; a screenshot is one.

The first image it pulled had been sitting unread since 3 August: a lead had
sent his Instagram profile, 40 followers and no posts, and nobody ever looked.

---

### A creator could loop on a signup they had already finished
Edelyn signed up at 08:33, her Instagram linked, and half an hour later she was
back on the connect step reading "Could not sign in with Instagram. Please try
again", doing exactly that. She had an account, a linked Instagram, and nothing
left but the Skool invite in her inbox. Now, when a connect fails and we
recognise the email, she is sent to sign in with "You already have an account
with us, so there is nothing to sign up for" instead of round the loop again.
The lookup fails to "no", because wrongly telling a new creator they already
have an account is a dead end they cannot argue with.

---

## The brain, written down instead of retyped

Every reply today was hand-written, and the same three mistakes kept nearly
happening. They are now rules in code, with tests naming the real conversation
that caused them: [lib/data/reply-brain.ts](../lib/data/reply-brain.ts).

- **Their state decides, not their words.** A creator with an account who writes
  "I can't sign up" needs `/onboarding`, never `/signup`. A creator at 5/5
  asking "what's next" is finished. The reply queue would have sent Ankit, who
  had finished all five steps eleven minutes earlier, back to the signup page.
- **Only read what they said after our last message.** Re-reading the whole
  thread re-answers questions already answered.
- **Never send a link for a step they are past**, and never the same link twice.
- **A refusal ends it**, and it beats an eager sentence in the same breath.
- **Money is never raised by a machine.** Any message mentioning it goes to a
  human, and a test walks every sentence the file can produce to prove none of
  them brings it up first. Same test forbids long dashes and anything over two
  SMS segments.
- **Anything it cannot place goes to a human.** A guess pitches the wrong person.

### Small follow-ups, timed

Two rungs, the same day: **15 minutes** ("is everything ok?") and **90 minutes**
("I saw you stopped, I am here to help"). Then it stops and the slow ladder at
2h, 22h and 44h takes over. A third message the same day is pestering, and
pestering on a shared WhatsApp sender buys blocks, not signups.

### The invite goes out before they ask for it

`POST /api/funnel/invite`. Until today an invite only existed after a creator
signed up, connected Instagram, reached step 2 and pressed a button. Edelyn did
all of that and then spent an hour asking where her email was. It is free, it
does not expire and it is idempotent, so there was never a reason to make
somebody ask for it.

And the wording now says where to look, not just that it was sent: tap the
search box, type skool, check Spam and Promotions, the sender is Lim Din.

### The four questions everybody asks

Learned by being asked them, in this order of frequency:

| They ask | The answer |
|---|---|
| What does it cost me? | Nothing. It is free for you, we never charge you a penny. |
| Is my Instagram safe? | Instagram's own official login, the same one Meta gives businesses. You never give us your password. Disconnect any time from Settings. |
| Can I choose the niche? | No. The videos are picked at random and your page becomes an AI video page. Saying otherwise buys a signup and loses the creator in week one. |
| What am I actually promoting? | **The community itself.** One product, no catalogue to pick from. |
| Where do I set up my payment? | **skool.com/settings?t=payouts.** Skool pays them directly, we are never in the middle. |
| How much will I earn? | **40 percent of every sale**, and a pointer to the calculator on their own watch page. |

## Where the funnel is actually worked: the Elsie CRM

The HeyPubli funnel is not run from heypubli.com. Every lead conversation happens
in the **Elsie CRM at `app.heyelsie.com/admin/crm/inbox`**, on the WA tab. That is
where Maria answers, and it is the only place the whole thread is visible.

**Two databases, joined on the phone number.** This trips up everyone once.

| | project | holds |
|---|---|---|
| Elsie CRM | `loggyxryrhqsbtqpteog` | `wk_contacts`, `wk_sms_messages`, tags, the conversations |
| HeyPubli | `oouwidqeipibalkjubvw` | `profiles`, the 5 onboarding steps, `signup_leads` |

They are separate Supabase projects. The join is HeyPubli `profiles.whatsapp` to
the Elsie contact phone, normalised to digits. Nothing else links them.

**Sending goes through `wk-partner-api`, never raw Twilio.** That edge function
enforces the do-not-text list, the 24 hour window and idempotency, and it returns
`unrecorded` when a message sent but failed to save. Never retry on `unrecorded`,
that texts the person twice.

**What the inbox shows, built 07 Aug 2026** (code in the Elsie repo, not this one):

- The lead's real name, parsed from the Facebook lead form on the way in, instead
  of a bare phone number.
- A snippet of the last message on each card, like any chat app.
- A step chip, `1/5` to `5/5`, or a dashed `lead` chip for somebody with no
  HeyPubli account yet.
- A **Their journey** pane: signup, each of the five steps with the time it was
  done, the messages, and what happens next.

**The one rule that matters in that pane.** When the cross-project lookup fails
it says **"Cannot check HeyPubli right now"** and shows no chip. It must never
say "they have not signed up", because that is a positive claim about a person
and the first version made it for every finished creator whenever the connection
was down. Not knowing and knowing-they-did-not are different things.

Files: `api/crm/heypubli-journey.ts`, `src/core/heypubli/journey.ts`,
`src/features/crm/components/journey/JourneyPanel.tsx` in the Elsie repo. It needs
`HEYPUBLI_SUPABASE_URL` and `HEYPUBLI_SERVICE_ROLE_KEY` set on the Elsie Vercel
project, and it degrades to "cannot check" without them rather than lying.

---

## We stopped recruiting leads who cannot be paid

Hugo, 07 Aug 2026, after an audit of Meta's own lead export: **"stop pitching
them"**, about Indian leads, because Skool payouts to India are blocked.

The audit is what forced it. Of the Facebook leads captured in early August, the
large majority were Indian, and Skool cannot pay any of them today. Recruiting
somebody into unpaid work is the part that is not defensible.

**The rule.** No video, no signup link, no chasing. They still get a straight
answer to anything they ask, and anyone who already finished onboarding keeps
every bit of help they had. It decides who we APPROACH, not what we tell them.

**It is enforced in two places, because one is not enough.** The decision engine
(`pitchBlocked` in [lib/data/reply-brain.ts](../lib/data/reply-brain.ts)) returns
"hand to a human" before any recruiting branch can run, and the hand-run send
script carries the same guard, since that script is what actually sends. Tests
pin both, including that the flag changes nothing for anyone else.

**The flag is not called `isIndian` on purpose.** The reason is the payout block,
not the country. When India reopens, or somewhere else closes, it is one list of
dialling codes and not a rewrite.

**This does not soften the older rule.** No message may still ever RULE on
whether a country can be paid. That was Bhupender, told Stripe India was off,
who then went quiet. Deciding who we approach is a business call Hugo made with
the numbers in front of him. Telling a creator their country is barred is still
not ours to say.

---

## What the creator is actually selling, and who pays

Hugo, 07 Aug 2026, correcting an answer that was right but incomplete:

> "The product is the community. The community that teaches people how to do AI
> videos, which he's gonna have free access, so he has his referral link but the
> people who comes through his referral link gonna have to pay. That's the whole
> thing."

Say all three parts or the offer sounds worse than it is:

1. **There is one product, the community.** No catalogue, nothing to choose,
   nothing to manage. Rajen asked "can u tell me the kind of products", plural,
   which is what somebody expects when they hear the word affiliate.
2. **The creator's own access is free.** They are a member, not a customer.
3. **The people who join through their link pay**, 108 dollars a year, and the
   creator keeps 40 percent of that, 43.20 dollars a sale.

Point 2 is the one that keeps getting dropped, and it is the reassuring one. Told
that they are promoting a paid subscription, a lead reasonably assumes they are
about to be asked for the 108 dollars themselves. Twice on 07 Aug a lead was
given the price and the commission with no sentence saying who actually pays it.

---

The money rule was narrowed **three times on the same day**, every time because
my version was too blunt, and every time it cost a real creator a real answer.

The third: Rajen watched the video and asked "And earning??". He was given the
mechanism, his own link, Skool tracks it, Skool pays him, and no number, because
this file said how-much was never ours to answer. Hugo, 07 Aug: **"on the watch
page, there is the earning calculator."**

We print **40 percent** on the page we send every single lead. Refusing to repeat
it in the chat was never discretion, it was making a lead work for a number we
had already shown them, in a conversation whose whole job is to answer questions.

It is answered now, and the rate is **imported from `lib/earnings.ts`**, the same
constant the watch page renders from, so the chat cannot drift from the page a
lead is reading while they message us. What is still never done is quoting a cash
figure: the calculator shows a range with "careful estimates, not promises"
printed under it, and that sentence does not survive being retyped into WhatsApp.

The self-check that forbade every reply from mentioning money is now an
**allowlist naming the one reply allowed to**, rather than a ban that got deleted.
A new reply still cannot quietly start talking about earnings.

First, everything with a money word went to a human, including "I will be
charged 9 dollars?", which has a one word answer. That is not caution, it is a
stall.

Then, worse: Bhupender asked twice how he would be paid and was told Stripe
payouts to India are switched off. Hugo, 07 Aug: **"It's not your job to say
that Indians cannot receive whatever, because if they have a company they can
set up the Stripe. You don't have to say this country is allowed or not
allowed. You just have to say where they must go."** Our first finished creator
was told he could not be paid, and went quiet. That was never ours to rule on.

**Everyone gets the same answer.** There is no country branching anywhere in the
reply brain, and a test fails the build if any sentence it can produce names a
country or rules one out.

### Sending pictures on WhatsApp

`wk-partner-api` now takes `media_url` on a free-form send. Proven on a live
lead: `num_media: 1`, delivered.

**This is not the SMS restriction.** MMS `MediaUrl` only reaches the US and
Canada, which is why `wk-sms-send` appends a link instead. On the `whatsapp:`
channel Twilio delivers the image itself, anywhere.

### A message could send and leave no trace

Ankur was answered at 09:56, read it, and the inbox still listed him as waiting,
because the row insert returned null and the error was thrown away. Whoever
looks next sees an unanswered lead and writes again. The send now logs
`SENT BUT NOT RECORDED` and returns `unrecorded` in the response, and callers
must not retry on it: a retry texts the person twice.

**That logging caught its own author within the hour.** Adding `media_urls` to
the insert, I wrote `null` for text-only sends. The column is NOT NULL, so for
eleven minutes every plain WhatsApp message reached its lead and none of them
was recorded. Without the new error line it would have looked exactly like a
quiet morning. Three messages were restored from Twilio, which is the only
place they still existed. The value is `[]`, never `null`.

### Pictures for the steps

`STEP_IMAGES` in reply-brain names a file per step and describes what it has to
show. `available` stays false until the file is really in `public/help/`, and a
test enforces that, because a promised picture that 404s in a creator's chat is
worse than no picture.

---

## Skool hands out TWO different referral link shapes

Both are real and both came from the same instruction ("three dots, Invite
people, COPY"):

```
https://www.skool.com/ai-influencer-flywheel-5612/about?ref=CODE   Bhupender, Marry Jain
https://www.skool.com/@prem-bharti-3375?g=ai-influencer-flywheel-5612   Prem
```

The verifier only looked for `ref=`, so Prem, whose link was live in his bio and
whose page was finished, was reported as **CLAIMED, NOT FOUND**. Acting on that
would have meant telling a creator to redo work he had already done, which is
the exact mistake that cost Edelyn twenty minutes the same morning. It now
matches the distinctive part of whatever link we stored for that creator.

**Open question for Hugo, not decided here:** whether the `@handle?g=group`
shape attributes a signup the same way `?ref=CODE` does. If it does not, Prem
gets credited for nothing and neither he nor we would find out until somebody
joined through him. Worth one check inside Skool before more creators use it.

---

## A creator can answer a step and still be recorded as stuck on it

07 Aug, 12:50. Edelyn was showing 2 of 5 and had been silent for 98 minutes, which
reads exactly like somebody who gave up. The check-in ladder said send rung two.

She had not given up. At 11:10 she pasted her own referral link and wrote "Then?".
In the same minute we sent her a picture guide showing how to find the link she had
just sent. The two crossed. Her link was never saved, so the page still said step 3
was outstanding, and every automated read of her state agreed with the page.

**She was not stalled, she was blocked on us**, and the ladder would have sent a
"I saw you stopped" nudge to a creator whose last act was doing what we asked.

Two things this proves, both already rules and both nearly broken again:

- **Read the thread, not the step counter.** The counter is our record of what we
  processed, not a record of what the creator did. When those disagree the creator
  is right.
- **Anything a creator pastes into the chat has to be captured.** A link that
  arrives on WhatsApp and is never written to the profile is work the creator did
  and we lost, and it silently converts them into a "stalled" lead.

Same tick, the opposite call on Discipline X: five outbound messages in a row with
no reply (09:08, 10:03, 10:40, 10:45, 11:10). The ladder is two rungs then stop and
he was long past it, so nothing more was sent. A sixth unanswered message is not
persistence, it is what teaches a shared WhatsApp sender's carrier that we are spam.

---

## Known and not fixed

- **Skool free joins CAN be verified. Two ways, neither needs Skool.**
  1. **They hold a `?ref=` link.** It only exists inside the group and nobody
     guesses a 32 character code, so holding one is not a claim about having
     joined, it is a thing that could not have happened without joining.
     `check-creators.mjs` works this out on its own. Hugo, 07 Aug: "you can see
     he has a referral link, that's the proof. He would not guess a referral
     link." He was right and this file had been asking for a second proof while
     holding the first.
  2. **Read the member list** and write down what you saw, in
     `scripts/skool-members.json` with the date. The script reads it.

  **Their Skool display name will not match ours.** Bhupender signed up as
  "Bhyg G". Match on the person, not the string, or you will report a member as
  missing.

  Result: 5 of 6 creators proven inside the community, and Ashwini confirmed
  genuinely absent, where the column used to read "0 verified in Skool".

- **What is still not automatic.** Skool's Zapier app has only
  "New Paid Member" and "Answered Membership Questions" triggers, so nothing
  automated can see a free join, and everything in the codebase still says
  "declared, unverifiable" for that reason.

  **By eye it is verifiable, and that is not a small difference.** The member
  list at `skool.com/ai-influencer-flywheel-5612/-/members` lists everybody.
  Read on 07 Aug 2026 it settled three open questions at once: Discipline X and
  Edelyn were both genuinely in the group while our page still had them stuck
  on step 2, and Ashwini genuinely was not. Two of those three would have been
  chased about something they had already done.

  Check the member list before chasing anybody about step 2.
- **Nothing answers leads automatically.** AI replies are off and the nurture
  drip is disabled. Every reply today was written by hand. Turning the ads back
  on without re-arming that means the next hundred leads rot exactly like the
  last hundred did.
