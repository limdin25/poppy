# SMS blast playbook, and the mistakes that wrote it

Written 2026-07-28 after Maria's 100-lead website opener, at Hugo's
instruction: "document all you leant so you never make same mistakes."

Every rule below exists because something went wrong. Read this before any
bulk send.

---

## The rules

### 1. Bulk sends go through the CRM, never the raw Twilio API

Use `wk-sms-send` (or `wk-sms-broadcast`). A direct Twilio API call delivers
the text just fine, which is exactly why it is dangerous — it looks like it
worked, and silently:

- writes **no `wk_sms_messages` row**, so the lead's reply lands with no
  thread and the agent's inbox shows nothing
- never sets the **one-agent-per-lead lock**, leaving Pedro or Marr free to
  text the same person tomorrow
- skips the **spend guard and kill switch** (`wk_outbound_sms_allowed`)

The only acceptable raw-Twilio use is a one-off test to Hugo's own phone.
I nearly blasted 100 leads this way and caught it at the last moment.

### 2. A preview means a RENDERED message, never a raw template

Hugo asked to see how the copy looked and I texted him the literal string
`Hey (Name), this is Pedro...`. A preview exists to show what the recipient
will actually see; a merge token shows nothing and wastes the round trip.
Fill it from **real data in the real target list**, so the preview doubles
as proof the token resolves.

His reaction, verbatim: *"That so stupid you actually send (name) instead of
costumise?"* He was right.

### 3. "Send from X" and "signed by Y" are two independent things

I sent the Pedro-signed copy from **Pedro's** number when the account was
meant to be **Maria's**. The body text saying "this is Pedro" says nothing
about which line it leaves from. Always confirm both separately:

- **from** = the `wk_numbers` row / agent account
- **signed** = whatever name the copy happens to use

### 4. Greet with the FIRST word of `owner_name`, never the whole field

`custom_fields.owner_name` holds full legal names from Companies House, e.g.
`Jake Donald Okeefe`. Greeting with the raw field produces "Hey Jake Donald
Okeefe". The canonical rule is `[owner_first]` in
[src/features/crm/lib/interpolateScript.ts](../src/features/crm/lib/interpolateScript.ts):
first whitespace-delimited word only. `scripts/lib/` helpers must match it.

Related trap, already documented in [PLUMBER_LEADS_PIPELINE.md](PLUMBER_LEADS_PIPELINE.md):
`wk_contacts.name` is the **company**, not the person. Greeting from `name`
called a plumber "James" because his firm was "James Brothers Plumbing".

### 5. A straight apostrophe is free. A curly one triples the bill

Hugo believed `'` costs money and asked that "dont" stay unpunctuated. Half
right, and the half that is wrong is worth money:

| variant | encoding | segments |
|---|---|---|
| `dont` | GSM-7 | 1 |
| `don't` (straight, U+0027) | GSM-7 | **1** |
| `don't` (curly, U+2019) | UCS-2 | **3** |

`'` is in the GSM 03.38 table, so it is a normal 1-septet character. `'` is
not, so a single one flips the whole message to UCS-2 and drops the segment
size from 160 to 70. Same for long dashes and the ellipsis character. See
[api/lib/sms-charset.ts](../api/lib/sms-charset.ts) and the standing rule in
CLAUDE.md.

**Never "tidy up" a client's punctuation.** Straightening quotes is free and
good; curling them costs real money on every send.

### 6. Preflight the whole batch before sending one message

`scripts/blast-maria-website-opener.mjs` refuses to send anything unless
**all** rows pass:

- a real first name to greet (never a raw token, never a limp "there")
- GSM-7 only and exactly 1 segment, computed per message (a name with an
  accent or curly character would silently triple that lead's cost)
- the lead is unlocked, i.e. no other agent has already worked them

All-or-nothing beats a half-sent batch you cannot un-send. Always dry-run
first; `--apply` is opt-in.

### 7. Believe Twilio, not the CRM row

The CRM shows `queued` for messages Twilio has already delivered, because the
status webhook does not write back. Always confirm a campaign against
`GET /Messages.json`, not the app.

### 8. Two failures are never preventable

`30003` (handset off/unreachable) and `30005` (unknown/disconnected number)
are live mobiles in every database, including a freshly scraped one. Budget
for roughly 5% and do not go hunting for a data-quality bug that isn't there.

- Maria's 50-lead test, 2026-07-27: 48/50 delivered, 2 dead.
- This 100-lead blast: 95 delivered or in flight, 5 dead.

### 9. Check the send window and the inbound webhook before the first send

- **Time:** this batch went at 09:51 Tuesday BST, a fine hour for a trade.
- **Inbound webhook:** Maria's number was once pointed at the *reviews*
  opt-out handler rather than `wk-sms-incoming`, which silently swallowed
  every reply. Verify `SmsUrl` on any number before its first campaign.

---

## What is still open on this campaign

**The copy promises something that does not exist.** The text says *"I built
you one"* and there is no website builder anywhere in this codebase (checked;
only `api/lib/report-html.ts`, which is the sales audit report). Hugo chose
this wording knowingly over the true alternative he approved last week
(*"you can make one for free, just let us know"*, Decisions Log #24),
accepting that he will build on demand for anyone who says yes.

So: **every "yes" is now a commitment.** At a normal cold reply rate that is
roughly 5 or 6 sites.

**Replies will not answer themselves.** `wk_ai_reply_settings` is a single
global row shared by every agent, currently `mode='draft'` — replies queue for
human approval and send to nobody until someone approves them. This exact
failure has already cost money once: the 22–24 July audit found **15 inbound
texts dead in the draft queue**. Somebody has to watch Maria's inbox today.

---

## Related

- [AGENT_ISOLATION_AND_LEAD_LOCK.md](AGENT_ISOLATION_AND_LEAD_LOCK.md) — why the lock exists and what it blocks
- [PLUMBER_LEADS_PIPELINE.md](PLUMBER_LEADS_PIPELINE.md) — the lead rules (named owner, review cap, A→Z)
- `scripts/blast-maria-website-opener.mjs` — the send script, preflight included
- `scripts/feed-maria-leads.mjs` — how her unused-only lead pool was built
