# HeyElsie Reviews — FINAL VSL script

Approved by Hugo 2026-07-23. **One recording for every lead** — the voiceover
contains zero names, towns or industries. Personalisation is VISUAL ONLY: the
screen shows the lead's own rank-frame (their business, red-ringed, below the
pack) while the generic voiceover says "there you are, all the way down here".

Runtime ~2:20. Scene timing in `src/Root.tsx` matches these beats.

---

## Phone opener (~20s — agents on the dialer, before the video is sent)

> Hi — quick one. I was looking at your business on Google and noticed you've
> barely got any reviews. Are you new in the area?
>
> *(…no — been here 25 years!)*
>
> That's exactly the problem — you'd never know it from Google. Look, I've
> actually gone through your business and put together a short audit — how you
> get to the top of Google and start landing the higher-paying jobs. It's a quick
> two-minute video I made for you. I don't want to take your time — **can I
> WhatsApp it over?**
>
> *(…yes)*
>
> Perfect — watch it when you get two minutes. There's a button under the video
> if you want to start. Speak soon.

---

## PART 1 — Hook + the scroll (~40s) — *screen: their rank-frame, you scroll*

> Quick video — I'm going to show you how you get more jobs. Higher-paying jobs.
> The ones that are going to someone else right now.
>
> When someone in your area needs a service, this is what they do. They search on
> Google — and they see these businesses at the top. Look at the reviews.
> Hundreds. And over 80% of people check Google reviews before choosing a local
> business — so nine times out of ten, the customer calls one of these guys first.
>
> Now watch. *(scroll… scroll…)* We scroll… and scroll… and there you are. All
> the way down here. Not because your work is worse — because they have more
> reviews. And every day it stays like this, those jobs — and that money — go to
> them.
>
> Here's how we put you on top.

## PART 2 — Agitation + the system (~75s)

> Here's the honest truth. Happy customers forget to leave a review the second the
> job is done. You're too busy running your business to chase them. And those
> "please review us" texts and emails? They stopped working years ago. Maybe
> you've even tried — most owners have.
>
> That's exactly why we do everything for you.
>
> First — the goldmine you're sitting on: your old customers. Hundreds of people
> who loved your work and never left a review. We reach out at the right time,
> with the right message, and we follow up automatically — and around one in ten
> of them leaves a review. For most businesses, that's double the reviews in the
> first month.
>
> Then every new job keeps the reviews coming — you never have to ask anyone
> again. And we reply to every review for you, in your voice. Google loves that.
>
> You also get full access to your own dashboard — this one I'm showing you here.
> We run everything for you, but you can log in any time and reply to a review
> yourself if you like.
>
> And as a free bonus — optional — we can turn your best five-star reviews into
> posts for your Facebook and Instagram. Free marketing, on top.
>
> Getting your customers to us couldn't be simpler. Any software you use can
> export a list or connect directly. A spreadsheet, invoices, even a list from
> your phone — all fine. Once you start, we do a quick onboarding — a short call,
> or just messages — and we connect everything, one way or another. You never
> touch anything technical.

## PART 3 — Price + CTA (~45s) — *end card, button below*

> Take a leap of faith today, and here's what happens: you become the authority in
> your area. The higher-paying customers come to you first — because now YOU'RE at
> the top.
>
> You get your first 25 reviews for free. After that, you just pick a plan based
> on how many jobs you do a month. Around fifty jobs a month — ninety-nine pounds.
> Up to a hundred — one seventy-nine. More than a hundred jobs — two seventy-nine.
> And if after the free reviews you don't want to carry on — you don't. No risk.
>
> So here's what to do: click the button below and choose your plan. The moment
> you're in, a member of our team reaches out to you and gets everything set up —
> it takes five minutes. You can look around the dashboard yourself, of course —
> but you don't have to. The team is here, so you never have to worry about a
> thing.
>
> The only question is — do you want to stay down here… or do you want to be the
> guys on top? **Click the button below.**

---

## Locked wording rules (don't drift)

- **No names, towns, industries or placeholders** in the VO — one recording, all leads.
- **NOT** "on the tools" — trades slang. Must stay industry-neutral for all sectors.
- **"You get your first 25 reviews for free"** — Hugo's exact framing. NOT
  "completely free", NOT "until", NOT "that's it".
- Plans are described by **jobs a month**, not requests.
- The **team-reaches-out** promise is instructional and deliberate — it removes the
  "I'm not technical" fear right at the decision point.

## Open items this script creates

- Billing is still a **time** trial (TRIAL_DAYS=14; billing page label wrongly says
  10-day). The video promises first-25-reviews-free — align both.
- The button needs a **plan-picker** page (`/subscribe` is email-only today), and
  signup must **ping the team instantly** — the video promises a human reaches out.
- **Future swap (biggest conversion lever):** once a real client has a result,
  replace "most businesses double their reviews in the first month" with a named
  case study.
