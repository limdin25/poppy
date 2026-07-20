# Voicemail Drop — Phase 0 Research

*Written 2026-07-20. Every Twilio claim below was independently re-verified against live Twilio docs the same day (20/20 confirmed, zero refuted). Sources cited per section.*

---

## TL;DR

- **The build is viable and it's the officially supported Twilio pattern.** True "ringless" voicemail (carrier-server deposit, what VoiceDrop/Slybroadcast sell) is explicitly banned on Twilio and needs patented carrier interconnects we don't have. An AMD drop — the call **rings normally**, and the message plays only if voicemail answers — is what Twilio's own docs describe `DetectMessageEnd` being for, and Twilio's caller-reputation guide actively recommends leaving a voicemail instead of hanging up.
- **AMD mode decision: `AsyncAmd=true` + `MachineDetection=DetectMessageEnd`** (full reasoning in §4). Sync mode makes every live human sit through ~4 seconds of dead silence after saying "hello" — the classic robocall tell and a compliance problem. Async lets us act the instant we know who answered.
- **Cost: ~$0.03 per delivered drop, $0 for no-answers.** Cheaper than every RVM provider's standard plans at any volume, and unlike them we convert live answers into a real sales call.
- **The real ceilings are not code**: Twilio's 1-call-per-second account default (fixable with a Business profile), carrier "Spam Likely" analytics (fixable with rotation + Voice Integrity registration), and **TCPA** (see the red box below).
- **⚠️ The one thing to decide before Phase 1**: US law requires **prior express written consent** to play a prerecorded sales message to a mobile phone — B2B is *not* an exemption, and penalty exposure is $500–$1,500 **per call**, class-actionable. This is a property of the recipient list, not the code. The system will be built with the full compliance rail (quiet hours, DNC, opt-out, abandonment caps), but **whose numbers we dial and what consent we hold for them is Hugo's call, ideally with a TCPA lawyer's sign-off** (§7).

---

## 1. What the market actually does (VoiceDrop, Drop Cowboy, Slybroadcast)

All three deliver via carrier voicemail-server deposit — **not replicable and not wanted** (banned on Twilio, legally shakier post-FCC 22-85). What we studied and are adopting is their campaign/pacing/rotation/callback layer.

### Campaign data model (VoiceDrop, from their live Postman collection)

A VoiceDrop campaign is exactly five things — this maps 1:1 onto our schema:

| Concept | Their field | We adopt as |
|---|---|---|
| Audio source | `Voice Clone IDs` + `Script`, or static recording | `audio_url` (Supabase Storage) |
| Sender pool | `From Phone Numbers` (an **array** — the rotation pool) | campaign ↔ numbers join (reuse `wk_campaign_numbers` pattern) |
| Pacing | `Hourly Max Sending Rate` (integer) | `pace_per_number_per_hour` |
| Schedule | `Scheduled Days` + `Sending From`/`Until` + `Schedule Timezone` | days + window + tz columns |
| Status | `Active` / `Paused` / `Archived` | `draft → running → paused → done` state machine |

Other patterns worth stealing:

- **`{{senderPhoneNumber}}` system variable** — the script says "call me back at {{senderPhoneNumber}}", resolved *at send time* to whichever rotation number actually dialed. Ties the spoken callback number to the caller ID. (VoiceDrop)
- **Prospects carry `personalization_variables`, schema-enforced** — variable keys must match the campaign's set exactly, rejected with a 400 otherwise. (VoiceDrop)
- **The pacing folklore corrected**: the "~100/hour" figure is real but it's VoiceDrop's *campaign-wide callback-capacity advice* ("drop 50–100 voicemails per hour... a steady, manageable flow of callbacks your dispatchers can handle"), **not** a published per-number carrier limit. No provider publishes a per-number cap. Per-number hygiene numbers come from carrier-analytics folklore instead (§6).
- **Rotation rationale, verbatim from VoiceDrop**: *"If you overuse a number, carriers will flag it. Advanced software rotates your numbers automatically to prevent 'Spam Likely' labels."* Area-code matching is done by buying pool numbers per area code; their dialer product routes "a lead in Miami (305) through an available (305) number from your pool" — the behaviour our spec item 5 implements.
- **Drop Cowboy's API shape** is the cleanest and is our internal-API model: one `POST /rvm` = one recipient = instant `{"status":"queued"}` ack; **all outcomes arrive async via webhook**; `foreign_id` (your DB record id, ≤256 chars) is echoed back verbatim in every webhook and is the *only* correlation mechanism. Their webhook payload — `{drop_id, phone_number, attempt_date, status: success|failure, reason, dnc, product_cost, network:{name,type}, foreign_id}` — is the shape our `vmdrop_attempts` row terminal state should mirror. Their error taxonomy (3xxx request errors, 4xxx telephony outcomes, 6xxx compliance) is a good internal convention.
- **Compliance is enforced server-side at delivery time, not at submit time** (Drop Cowboy): TCPA-hours violations are auto-held to the next window, frequency caps (3 attempts/3 days) and DNC hits come back as webhook *failures*, not synchronous API errors. Our cron should behave the same way — accept the queue, gate at dial time.
- **Slybroadcast's session control** is the pause/resume model: one campaign submission = one `session_id`; `pause` / `run` (resume) / `cancel` (scheduled-only) / `stop` (running, irreversible) all key on it. Their per-call postback (one POST per number: `session_id|phone|status|fail_reason|delivery_time|carrier`) uses **the identical record shape for push (webhook) and pull (status query)** — a property the Ruby wrapper study confirmed is worth preserving: our attempt row *is* both.
- **Slybroadcast failure vocabulary** worth keeping in our `reason` enum: `Unable to Detect Voice Mail`, `VM may be full or not setup`, `Voicemail Busy`, `Landline Removed`, `Do Not Dial List Removed`.
- **Callbacks**: VoiceDrop's purchased numbers each get a `redirect_to` forwarding target for inbound call-backs, but their API only offers *polling* of call logs. We beat this natively — inbound calls on our campaign numbers already hit our own webhook, so callback attribution (spec item 8) is a join on the called number, in real time.
- **DNC/validation**: VoiceDrop exposes `POST /phone-validations` (line-type + federal `do_not_call` boolean per number) and a send-time account-level DNC suppression list. We already own the line-type half free: the self-hosted NANPA classifier (`/admin/phone-validation`, 1.3M-row table) is our CSV scrub (spec item 6).

Sources: developers.voicedrop.ai (raw Postman collection JSON), voicedrop.ai product pages, drop-cowboy.gitbook.io (API endpoint, webhooks, sending-limits, prerequisites pages), github.com/Drop-Cowboy/dropcowboy-cli (`openapi-spec.yaml`), slybroadcast.com/documentation.php + documentationjson.php + both API PDFs, github.com/riazXrazor/slybroadcast, github.com/maceto/slybroadcast.

---

## 2. Twilio AMD mechanics (all verified against live docs 2026-07-20)

### Modes — `MachineDetection` accepts exactly two values

- **`Enable`** — verdict returned as soon as the called party is identified. For predictive dialers (act fast on humans). On a machine you get the verdict at greeting *start* — useless for drops (message would play over the greeting and only its tail gets recorded).
- **`DetectMessageEnd`** — verdict **immediate for humans**, but for machines it's returned **at the end of the greeting, usually the beep**. This is the voicemail-drop mode, by Twilio's own description.

### `AnsweredBy` values — exact lists per mode

- `Enable` → `machine_start`, `human`, `fax`, `unknown`
- `DetectMessageEnd` → `machine_end_beep`, `machine_end_silence`, `machine_end_other`, `human`, `fax`, `unknown`

`machine_end_other` also fires when `MachineDetectionTimeout` expires mid-greeting. Twilio's FAQ: unless you need the distinction, treat all `machine_end_*` as "a machine answered." Note the Call *resource* property `answered_by` only ever says `human`/`machine` — the granular value arrives on the **webhook** parameter; branch on the webhook.

### Sync vs async

- **Sync (default, `AsyncAmd=false`)**: "Twilio blocks the call" — no TwiML runs until detection completes. Typical verdict **~4 seconds after answer**; a live human hears silence the whole time. Twilio's FAQ flags this explicitly as an abandonment-risk UX.
- **Async (`AsyncAmd=true`)**: call TwiML executes **immediately on answer**; detection runs in the background; the verdict arrives at `AsyncAmdStatusCallback` (POST by default) with `CallSid`, `AccountSid`, `AnsweredBy`, `MachineDetectionDuration` (ms). **The HTTP response to that callback is ignored — it is not TwiML.** To act on the verdict you must update the live call: `client.calls(CallSid).update({url})` or `.update({twiml})`, which replaces the executing TwiML immediately. This is Twilio's own published async-AMD tutorial pattern.
- Support matrix: configurable AMD is Calls-API-only. AMD **cannot** be used on `<Dial><Client>`, `<Dial><Conference>`, `<Dial><Queue>`, or SIP-trunk calls. (Our AMD sits on the outbound REST call — the *bridge* TwiML we return afterwards may freely use `<Dial>`/conference.)
- Async AMD consumes one of the call's four forked audio streams — don't start Media Streams/Real-Time Transcription until the AMD callback fires.

### Tuning parameters (defaults / ranges — units matter)

| Param | Default | Range | Meaning |
|---|---|---|---|
| `MachineDetectionTimeout` | **30 s** | 3–59 **seconds** | give-up point → `unknown`/`machine_end_other`. Only affects `DetectMessageEnd`. FAQ: for *business* voicemail boxes "30 seconds is frequently not enough" — raise it |
| `MachineDetectionSpeechThreshold` | 2400 ms | 1000–6000 ms | utterance shorter ⇒ human, longer ⇒ machine (human greetings usually <1800 ms, machines >3000 ms) |
| `MachineDetectionSpeechEndThreshold` | 1200 ms | 500–5000 ms | silence that ends an utterance |
| `MachineDetectionSilenceTimeout` | 5000 ms | 2000–10000 ms | initial silence → `unknown` |

Accuracy: `DetectMessageEnd` is "close to 100% accurate in US destinations with default settings" (Twilio FAQ); the classic miss is a very short (~2 s) voicemail greeting read as human. More speed-tuning ⇒ more `unknown`. Audit via Voice Insights + dual-channel recordings.

### Pricing, deprecations, testing

- **AMD costs $0.0075 per answered call** (on the live US voice pricing page; busy/failed not charged).
- **`IfMachine` is dead** — the old AMD system was deprecated at the `MachineDetection` launch; error **21207** ("Invalid IfMachine") is what you get for using it. Never send it.
- **Twilio test credentials / magic numbers do NOT exercise AMD** — no call is placed, no TwiML runs, `answered_by` is null. Real AMD verification needs real calls; Twilio's own blog method: a second Twilio number answers and plays a library of labeled human/voicemail greeting recordings while you log verdicts (this is exactly the rosinaa/fvmach `Twilio-AMD-Optimization` harness, §5). Unit tests therefore mock at the webhook-payload layer; live AMD accuracy is a separate manual/scripted pass against real voicemail boxes.

Sources: twilio.com/docs/voice/answering-machine-detection, …/answering-machine-detection-faq-best-practices, …/docs/voice/api/call-resource, …/docs/api/errors/21207, …/docs/voice/tutorials/how-to-modify-calls-in-progress, twilio.com/en-us/blog/async-answering-machine-detection-tutorial, …/blog/answering-machine-detection-generally-available, twilio.com/en-us/voice/pricing/us, …/docs/iam/test-credentials, …/blog/developers/best-practices/automated-amd-tests-voice.

---

## 3. Is this even allowed on Twilio? Yes — with the exact boundary quoted

Twilio help article 15911135028891 (updated 2026-06-15):

> "No, it is not possible to leave ringless voicemails or voicemail drops with Twilio. This practice is not supported by Twilio as it does not align with our Terms of Service…"
>
> "A 'ringless voicemail'… is understood as a 'call' where the intention is **not to ring** and get connected to the 'called' party but instead to connect directly to its voicemail."

The prohibition is defined by *intent to bypass ringing*. Our flow is a normal PSTN call that rings and would happily talk to a human — Twilio's AMD docs describe `DetectMessageEnd` precisely as "if you would like to leave a message on an answering machine," and Twilio's caller-reputation best-practices article goes further: *"If the call is answered by voicemail, do not hang up. Leave a message… plus a call-back number. The call back number should answer 24×7 and include an opt-out mechanism."* We are building the recommended pattern, not the banned one. (Do not market it as "ringless.")

---

## 4. The AMD decision: **`AsyncAmd=true` + `MachineDetection=DetectMessageEnd`**

### The flow

```
wk-vmdrop-run (cron tick)
  └─ claims next attempt, picks sender number (rotation + area-code match),
     checks: campaign running · closer online · pacing budget · quiet hours ·
     killswitch/spend · do-not-call tag
  └─ calls.create({
       to, from,
       url:                    wk-vmdrop-twiml?attempt_id=…      ← runs on answer
       machineDetection:       'DetectMessageEnd',
       machineDetectionTimeout: 45,                              ← business VM headroom
       asyncAmd:               true,
       asyncAmdStatusCallback: wk-vmdrop-amd?attempt_id=…        ← the verdict
       statusCallback:         wk-voice-status (existing),       ← lifecycle + billing chain
       timeout:                30                                ← ≥30s ring per Twilio hygiene
     })

on answer  → wk-vmdrop-twiml: brief natural opener <Play> (~4s, covers the
             detection gap), then <Pause>. Machines record nothing pre-beep,
             humans hear a voice instead of silence.

verdict at wk-vmdrop-amd (AnsweredBy):
  machine_end_beep / _silence / _other / unknown
           → calls.update(twiml: <Play>{drop_audio}</Play><Hangup/>)   [spec #1]
             (fires right at the beep → message lands cleanly in the box)
  human    → closer free?  calls.update(twiml: <Dial>conference…)      [spec #2]
             (closer pre-claimed at dial time, joins instantly — same
              conference-named-after-attempt trick as RobWelbourn)
           → no closer after all?  fallback per spec: play the drop —
             compliance requires it opens with identity + automated
             keypress opt-out (§7 rule 8); log attempt as 'abandoned'
             and count it against the 3% governor
  fax      → calls.update(twiml: <Hangup/>)
```

### Why async (and not sync)

1. **The human path is the whole reason we're not an RVM provider.** Sync means every live answer = ~4 s of dead air after "hello" — the universal "it's a robocall" signal, a hang-up magnet, and it runs straight into the TSR's connect-within-2-seconds abandonment rule. Async + an instant opener + a pre-claimed closer in a conference is the only way to get a human talking to a human fast.
2. **The machine path loses nothing.** The `DetectMessageEnd` verdict still arrives at the beep; `calls.update` redirects in ~1 s; the drop lands.
3. **The extra complexity is real but bounded and fully mapped.** Async costs us: a two-webhook state machine instead of one, and the live-call `update()` call. ghost-dialer (§5) is the cautionary tale of doing async wrong — it returns TwiML from the AMD callback (ignored by Twilio) and branches on `AnsweredBy` in the initial answer webhook (where it's absent in async mode), so its drop never plays. We know both traps; our tests will pin them (behaviour 1's test asserts the drop TwiML comes from a `calls.update` triggered by the AMD callback, not from the answer webhook's response).
4. **Sync `DetectMessageEnd` remains the documented degraded mode** if we ever want a dumb "drops-only, no closer" campaign type: one webhook, verdict included, `<Play>` in the response. Worse human UX, simpler machine. Not the default.

`unknown` policy: RobWelbourn bridges unknowns to humans (fail-open, right for call-forwarding). For a drop campaign we invert: **`unknown` → play the drop** — wasting 30 s of closer time on a false human is worse than a message landing oddly; and `unknown` at timeout usually *is* a slow machine. Logged distinctly so the ratio is tunable.

---

## 5. What the GitHub prior art taught us

| Repo | Verdict | What we take |
|---|---|---|
| **RobWelbourn/Twilio-AMD** (the spec's "most relevant") | Clean 2018 sync-`Enable` reference; predates async AMD and never leaves messages (hangs up on machines) — so we take its *architecture*, not its mode | ① Park-in-**conference named after the call SID**, bridge by joining the same name, `endConferenceOnExit` both legs. ② Smuggle correlation IDs **as query params on the webhook URL** (no shared state). ③ Track pending call SIDs so an orphaned leg can be `status='canceled'`. ④ `tr_with_amd.py`'s reject-and-advance: machine/busy/no-answer → reject reservation, mark closer "temporarily unavailable" with a timer so one voicemail-ing closer isn't hammered in a loop |
| **kaiquelupo/twilio-power-dialer-with-async-amd** (found in sweep — by a Twilio solutions architect) | The cleanest OSS async-AMD human-bridge in existence | On `AnsweredBy=human` → `calls(CallSid).update({twiml: enqueue…})` into an agent queue — our §4 human path is this pattern with a conference instead of TaskRouter. Also: dial concurrency slaved to free-agent count (semaphore), and multi-number-per-lead retry rotation |
| **eskayML/ghost-dialer** (the spec's OSS "SaaS") | **Broken by design** — async AMD + returns TwiML from the AMD callback (ignored) + branches on `AnsweredBy` in the initial webhook (absent in async) + checks `machine_end_*` values that can't occur in its `Enable` mode. Its drop can never play. Also: zero persistence, zero auth, zero pacing, unescaped TwiML interpolation | An anti-pattern checklist — several of our Red tests are direct negations of its bugs. One idea kept: flexible CSV phone-column matching (`Phone`/`Phone Number`/`phone`) |
| **GetUp/Kooragang** (production phone-banking dialer, sweep) | Best pacing/retry prior art (Plivo, transport-agnostic) | Retry hygiene *in the claim query itself*: `last_called_at < now() - cooldown AND call_count < max_attempts` + row-lock — merges with our BRRR cron's atomic-claim pattern. Drop-rate-governed adaptive pacing (AIMD) noted as a v2 upgrade; MVP keeps fixed per-number pacing (spec #3) |
| **zachblume/opendialer** (sweep) | ~100-line gem: binomial dial-ratio solver keeping P(abandon) under the FCC/TSR 3% | The mathematically principled version of the same governor — v2 candidate; the 3% *accounting* ships in MVP (§7 rule 5) |
| **rosinaa + fvmach/Twilio-AMD-Optimization** (sweep) | The only OSS treating AMD as tunable/testable | The live-AMD test harness design (§2 testing) + their baseline config, which is exactly Twilio defaults with `DetectMessageEnd` + dual-channel recording |
| **riazXrazor + maceto slybroadcast wrappers** | maceto (Ruby, not Python as the spec said) is the model client | Internal API surface: narrow named verbs (`createDrop`/`getStatus`/`pause`/`resume`/`cancel`), one uniform result contract, **identical record shape for webhook-push and status-pull**, one campaign handle everything keys on |
| **Twilio blog: iOS 26 call-screening detection** (sweep) | Nothing in OSS handles Apple's call screening | Known future risk: screening prompt ≠ human ≠ voicemail. Their AMD + real-time-transcription state machine is the fix. Out of MVP scope; logged as the first post-launch hardening item since our list is US mobiles |

Also from the sweep: there is **no credible OSS** for number rotation/health scoring, local-presence matching, or DNC scrubbing — ours will be built from scratch per §1/§6/§7 (and that's fine; each is small).

---

## 6. Pacing, rotation, area-code — the real constraints (verified)

- **Twilio hard limit: 1 call per second per account by default.** Excess `calls.create` requests queue (24 h age-out, then cancelled); every create response returns **`QueueTime`** (ms) — the correct back-pressure signal for `wk-vmdrop-run` to throttle on. Raising CPS is self-serve **only with an approved Business Primary Customer Profile** in Trust Hub; new accounts also need it for more than ~3 concurrent calls. **Getting the Business PCP approved is the first operational task of Phase 1** — it also unlocks SHAKEN/STIR "A" attestation and Voice Integrity.
- **Twilio has no per-number voice rate limit** — but its Voice Services Policy prohibits *patterns*: "a high volume of unanswered outbound voice call attempts from a single originating phone number", "a low average outbound voice call duration", complaint generation. A drop campaign is structurally both — **rotation isn't cosmetic, it's ToS survival.**
- **"Spam Likely" is applied by carrier analytics (TNS/First Orion/Hiya), not Twilio.** Published Twilio hygiene guidance: ≤2 calls per recipient/day, ≤5/month; ramp volume gradually, no spikes; same caller ID for repeat contact; one use case per number; rest repurposed numbers 45 days; let it ring ≥30 s (5 cycles); register numbers **before** first dial with **Voice Integrity** (Trust Hub — covers AT&T + T-Mobile analytics, free beta, REST-automatable) + **Free Caller Registry** (Verizon path) + CNAM. New-bought numbers can carry the previous owner's spam label — register immediately.
- **Per-number daily dial caps: no official figure exists.** Dialer-industry folklore says flagging risk rises somewhere around 75–250 dials/day/DID — rumour-grade, but it brackets the spec's `pace_per_number_per_hour` sensibly: default **~20/hour/number** (≈150/day in a 7.5 h window), admin-tunable, enforced per sender number per rolling hour (spec #3).
- **Area-code matching (spec #5)**: at dial time, prefer a pool number whose NPA (and then state) matches the recipient's; fall back to least-recently-used. VoiceDrop sells exactly this as "local presence". Practical note: our current pool is tiny (two US numbers, both toll-free-ish 833/877 — no local presence at all); **buying a handful of local DIDs in target-market area codes is a Phase 1 shopping item**, ~$1.15/mo each.
- **Pacing must also be slaved to closer availability** (kaiquelupo's semaphore insight + the TSR abandonment math): if no closer is online, every human answer is a compliance "abandon" — so a campaign with `bridge to closer` enabled simply doesn't dial while no closer is free. This is a dial-gate, not an AMD-time decision.

Sources: Twilio help articles 223180028, 223183648, 9375068873499, 22311056253723, 1260803371030, 4905619942299; twilio.com/en-us/legal/service-country-specific-terms/voice-sip; docs/voice/trusted-calling-with-shakenstir; CPS + configurable-call-limits changelogs.

---

## 7. Compliance (US) — the rules the system enforces

*(Researched against 47 CFR 64.1200 and the FTC Telemarketing Sales Rule via Cornell LII; this is engineering input, not legal advice — a TCPA lawyer should review scripts + consent flow before launch.)*

**The headline: any prerecorded/artificial-voice call to a US cell requires consent — and if the message sells anything, prior express *written* consent.** This is independent of the autodialer question, independent of B2B status (a business owner's personal cell is fully protected), and voicemail delivery is still legally "a call" (FCC ruled even true ringless voicemail is). AI/cloned voices count as artificial voice. Exposure: $500–$1,500 per call private right of action, uncapped, class-actionable, ~4-year lookback; FCC forfeitures can exceed $20k/call.

What the system will enforce mechanically (each becomes a tested behaviour or an ops checklist item in Phase 1):

1. **Consent gate** — a campaign declares its consent basis; contacts without a recorded consent reference are excluded at ingest *and* re-checked at dial time (double-gate, same as the SMS `do-not-text` pattern).
2. **Scrubs**: national DNC (unless written consent held), internal `do-not-call` tag (new, mirrors `do-not-text` in `wk_contact_tags`), landline scrub via the self-hosted NANPA classifier (spec #6).
3. **Quiet hours by recipient local time, derived from area code: 8 a.m.–8 p.m.** (federal is 8–9 p.m.; FL/OK/WA are 8–8 with 3-attempts-per-24 h caps — simplest is 8–8 + ≤2 attempts/day everywhere, which also matches Twilio's own hygiene guidance).
4. **Message content**: opens with the business name, callback number stated in-message (the `{{senderPhoneNumber}}` pattern), callback line answers 24×7 with an automated keypress opt-out that writes the `do-not-call` tag instantly.
5. **Human-answer path**: closer connected within ~2 s of the greeting (§4 flow); if none, the fallback audio's first seconds must be identity + opt-out (not a naked pitch); every such event logged `abandoned`; **abandonment ≤3% of answered calls per campaign per 30 days** tracked and surfaced — the pacing governor's target.
6. **Ring ≥15 s** (we use 30 s per Twilio hygiene) before giving up.
7. **Opt-out by any reasonable means** — keypress, spoken to closer, STOP text, callback — all feed the same tag; honored immediately.
8. **Evidence logging** on every attempt: dial time in recipient-local time, AMD verdict + duration, seconds-to-closer, message played, abandonment flag — `vmdrop_attempts` *is* the safe-harbor record.

**Open item for Hugo (not a code question): what list will this dial, and what consent exists for it?** Cold purchased lists = the full $500/call risk profile. Existing CRM contacts who submitted a form with the right consent language = defensible. This determines whether Phase 1 ships aimed at cold volume or at the consented segment. Recommend a quick counsel review either way.

---

## 8. Cost model (verified against live pricing 2026-07-20)

Twilio US: outbound $0.0140/min (billed only from *answer* — ring time is free; rounded up to whole minutes), AMD $0.0075/answered call, local DID $1.15/mo.

| Outcome | Arithmetic | Cost |
|---|---|---|
| No answer / ring-out | never answered → no voice charge | **$0.00** |
| Machine, drop delivered (greeting + 30 s message ≈ 45–90 s) | 1–2 min × $0.014 + $0.0075 | **$0.022–0.036** |
| Human, bridged to closer ~3 min | prospect leg 4 min + closer leg 4 min + AMD | **≈ $0.12** |
| Blended (15% ring-out / 75% machine / 10% human) | | **≈ $0.035/attempt** |

Versus the market: Slybroadcast $0.0385–$0.12/drop, VoiceDrop plans $0.025–$0.095, Drop Cowboy plans ~$0.015–0.024 (+$125–$4,000/mo commitments). **Twilio-AMD beats every pay-as-you-go RVM price at any volume**, only committed-plan Drop Cowboy nominally undercuts it — for a product that can't ring a human or hand a live answer to a closer. Cost is not a reason to reconsider; scrubbing is free (self-hosted classifier vs Twilio Lookup's $0.008/number).

---

## 9. The design we'll build (Phase 1 input)

### Schema (new migration; names per spec, `wk_`-prefixed to match every other CRM table)

**`wk_vmdrop_campaigns`** — name; `status` CHECK `draft|running|paused|done|cancelled` (Slybroadcast's cancel-vs-stop distinction collapses into `cancelled`); `audio_url` (+ optional `fallback_audio_url` for the no-closer/live-human message); sender pool via `wk_campaign_numbers` (existing table, existing priority semantics); `pace_per_number_per_hour` (default 20); schedule: `days int[]`, `window_start`, `window_end` (recipient-local enforcement at dial time); `bridge_to_closer bool` + closer agent ids; counters `total/dropped/bridged/abandoned/failed` (atomic tally RPC, same as `wk_broadcast_tally`); `consent_basis text`.

**`wk_vmdrop_attempts`** — `campaign_id`, `contact_id`, `to_e164`, `from_number_id` (rotation actual), `twilio_call_sid` UNIQUE, `attempt_no`, `status` CHECK `queued|dialing|answered|dropped|bridged|abandoned|no_answer|failed|canceled`, `answered_by` (raw webhook value), `amd_duration_ms`, `seconds_to_closer`, `reason`, `scheduled_for`, timestamps. One row per dial (Drop Cowboy's webhook payload shape, kept identical for UI reads and webhook writes). The attempt id rides every webhook URL as a query param (`?attempt_id=` — RobWelbourn's correlation trick, Drop Cowboy's `foreign_id` made internal).

### Functions (Supabase edge, `wk-*` conventions: `PUBLIC_FN_BASE` signature validation, `CRM_JOBS_KEY` cron auth, `wk_webhook_outbox` on DB-write failure)

- **`wk-vmdrop-run`** — cron tick (piggybacks `crm-jobs-pump`): per running campaign, per sender number, checks pacing budget / quiet hours / killswitch (`wk_killswitches` `outbound|all_dialers`) / spend RPC / closer-online gate / `do-not-call` tag, claims attempts atomically (BRRR-cron claim pattern + Kooragang cooldown-and-cap in the claim query), area-code-matched number pick, `calls.create` per §4, `QueueTime` back-pressure.
- **`wk-vmdrop-twiml`** — answer URL: opener `<Play>` + `<Pause>`. **Separate endpoint, not a branch in `wk-voice-twiml-outgoing`** — that function's no-match branch hangs up, and its softphone semantics don't apply; a thin dedicated endpoint is safer than threading vmdrop state through it. (Deviation from the spec's "wk-voice-twiml-outgoing branch" — flagging for OK.)
- **`wk-vmdrop-amd`** — the AsyncAmd verdict webhook: the §4 state machine, acting via `calls.update`. The one function where ghost-dialer's traps live; tested hardest.
- **Status/lifecycle** — reuses existing `wk-voice-status` (already maps `machine_*` → `voicemail`, already feeds the `compute_cost` → spend-guard chain) with a vmdrop branch keyed off the attempt lookup by CallSid.
- **Inbound callback attribution (spec #8)** — branch in `wk-voice-twiml-incoming`: called number ∈ a campaign's sender pool + recent attempt to that caller → tag contact `source='vmdrop_callback'` + `campaign_id`, route as warm inbound (ring closer first, voicemail fallback already exists there).

### UI
`/admin/crm/voicemail-drops` — new route in `CrmApp.tsx` mirroring `BroadcastsPage` (campaign list + progress via Realtime tally, create wizard: audio upload → Supabase Storage, CSV ingest with NANPA scrub report, pacing/schedule, sender-pool picker, pause/resume/cancel). Mobile-first like everything else.

### Testing (per `docs/tdd-log.md` conventions)
Pure logic extracted into vitest-covered libs under `tests/`/`src` outside `features/crm` (the vitest config excludes `src/features/crm/**` — confirmed), mirrored into Deno functions exactly like `buildOutgoingTwiml` already is. The 8 spec behaviours map to: TwiML builders + AMD-branch reducer (1, 2), pacing/rotation/area-code pickers as pure functions over number+attempt fixtures (3, 4, 5), CSV scrub (6), state-machine transitions + tally (7), inbound attribution resolver (8). Twilio interactions mocked at webhook-payload level with the *verified* payload shapes from §2. Gate: `npx tsc -b && npx vitest run`. Live AMD accuracy is explicitly out of unit scope — smoke-tested post-build against real voicemail boxes (§2), no automated test ever dials a real number.

---

## 10. Decision record

| # | Decision | Why |
|---|---|---|
| 1 | Twilio AMD drop, no RVM provider | Ringless is banned on Twilio + patent/interconnect-gated; AMD drop is Twilio's documented, recommended pattern; cheaper than every PAYG RVM price |
| 2 | **`AsyncAmd=true` + `DetectMessageEnd`** | Only combination giving both beep-timed drops *and* a dead-air-free human bridge; sync = 4 s silence to every human (§4) |
| 3 | Act on verdict via `calls.update`, never via AMD-callback response TwiML | The response is ignored by Twilio — ghost-dialer's fatal bug |
| 4 | `unknown` → play the drop | Timeout-unknowns are usually slow machines; closer time is the scarcer resource |
| 5 | Dedicated `wk-vmdrop-twiml`/`wk-vmdrop-amd` endpoints, reuse `wk-voice-status` | Keeps dialer/softphone/Retell paths untouched (spec constraint); status/spend chain already works |
| 6 | Conference-per-attempt bridge, closer pre-claimed at dial time | RobWelbourn's park trick + kaiquelupo's semaphore; `<Dial><Client>` direct is AMD-incompatible timing-wise and gives no park point |
| 7 | Fixed per-number hourly pacing (default 20/hr), rotation LRU + area-code preference, dial-gate on closer availability | Spec #3–5; adaptive AIMD/binomial governors documented as v2 |
| 8 | Full compliance rail in MVP (consent gate, DNC, quiet hours 8–8, ≤2/day, opt-out tag, abandonment ledger) | $500–$1,500/call exposure makes it load-bearing, not optional; consent basis of the list = Hugo's pre-launch decision |
| 9 | Business PCP + Voice Integrity + local DID purchases = Phase 1 ops prerequisites | CPS/concurrency, attestation-A, spam-label prevention all hang off it |

---

## 11. Full source list

**Twilio primary**: docs/voice/answering-machine-detection · answering-machine-detection-faq-best-practices · docs/voice/api/call-resource · docs/api/errors/21207 · docs/voice/tutorials/how-to-modify-calls-in-progress · docs/voice/trusted-calling-with-shakenstir · docs/iam/test-credentials · en-us/voice/pricing/us · trusted-activation/pricing/lookup · legal/service-country-specific-terms/voice-sip · help articles 15911135028891 (ringless policy), 223180028 (CPS), 223183648 (limits), 9375068873499 (spam labels), 22311056253723 (Voice Integrity), 1260803371030 (caller reputation), 4905619942299 (trusted comms) · blogs: async-answering-machine-detection-tutorial, answering-machine-detection-generally-available, introducing-new-answering-machine-detection, automated-amd-tests-voice, detect-ios-call-screening-amd-transcriptions, voice-mail-human-detection-studio-functions.

**Competitors**: developers.voicedrop.ai (raw Postman collection) · voicedrop.ai (api, hvac-service-contract-renewal-automation, local-presence-dialing-software, ringless-voicemail, phone-number-validator, pricing) · dropcowboy.com (api, developers, webhooks, pricing, byoc-complete-guide) · drop-cowboy.gitbook.io (api-endpoint, webhooks, sending-limits, rvm-prerequisites, private-number-pools, explicit-caller-id) · slybroadcast.com (documentation.php, documentationjson.php, API v2.6 + Global v3.0 PDFs, faq).

**Repos (all cloned and read)**: RobWelbourn/Twilio-AMD · eskayML/ghost-dialer · Drop-Cowboy/dropcowboy-cli · riazXrazor/slybroadcast · maceto/slybroadcast · GetUp/Kooragang · kaiquelupo/twilio-power-dialer(+with-async-amd) · vernig/twilio-autodialer · rosinaa/Twilio-AMD-Optimization · fvmach/Twilio-AMD-Optimization-Engine · zachblume/opendialer · PatterAI/patter-outbound-calls.

**Compliance**: law.cornell.edu/cfr/text/47/64.1200 · law.cornell.edu/cfr/text/16/310.4 · hklaw.com (Bradford v. Sovereign, 5th Cir. 2026) · wiley.law (IMC v. FCC, 11th Cir. 2025) · tcpaworld.com B2B primer · FCC 22-85 (ringless-VM-is-a-call ruling).

**Known UNVERIFIED items** (flagged as such wherever used): per-number daily dial-cap folklore (75–250/day — no official source exists); VoiceDrop's webhook payload field names (unpublished); Drop Cowboy webhook HMAC details; CPS-increase fee amounts; the FCC Feb-2024 AI-voice ruling and minute-rounding help article were snippet-verified only.
