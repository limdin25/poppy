-- NOTE (2026-07-27): wk_coach_facts is now owned SOLELY by
-- scripts/seed-coach-facts.mjs (which re-derives every fact from
-- salesObjections.ts and wipes the table first). The fact inserts/updates that
-- used to live here fought with it — whichever ran last won — so they were
-- removed. Edit facts in salesObjections.ts / seed-coach-facts.mjs and re-run
-- that script. This file still owns the SCRIPT + COACH PROMPT sections.
-- The 2-minute video call, script, coach and knowledge base, all aligned.
--
-- Hugo 2026-07-26: the close moved OFF the phone. The agent's only job is now
-- to earn permission to text the lead their personal video page; the page and
-- the £1 checkout do the selling. Everything below existed for the old
-- "One-Call Close" (quote £99/£179/£279, take a card while they're on the
-- line) and actively contradicted the new motion — the coach was still telling
-- agents "I don't send emails" while the entire call is now about sending
-- something.
--
-- Also fixes the audit finding that the live-call script pane was EMPTY
-- (wk_call_scripts had zero rows, so agents saw "No default script yet" and
-- were pointed at Settings, which agents cannot open), and that calls are
-- recorded with no notice given to the person on the other end.
--
-- Re-run safe.

-- ============ 1. the live-call script pane ============
-- Short on purpose. The full branching script lives in the dialer's own pane
-- (src/core/content/one-call-script.html); this is the teleprompter version
-- the agent's eye follows while actually talking.
insert into wk_call_scripts (name, body_md, is_default)
select 'The 2-minute video', $md$
## 1 · Opener

> Hi, quick one, is that {{first_name}}, from the business?

- Warm and casual, like a mate ringing. Their name and business, nothing else.
- No recording line, no review count, no "are you new to the area". Get the yes, then go straight to the offer.

## 2 · The offer, this is the whole call

> Right, so here's why I actually rang. I've recorded you a 2-minute video that shows how we can help you rank higher on Google and of course get more jobs. Can I send it to you?

- You are **not selling anything here**. You are asking permission to send a video.
- Say "2 minutes" and mean it. Then stop talking.

## 3 · Get the yes

> I'm not going to take any more of your time, that's genuinely it. I'll get it over to you in the next few minutes. If I send it across, will you watch it?

- Giving the time back is what disarms them.
- This is the **only** close on this call, and it's a yes to *watching*, not to buying.

## 5 · Tell them it's coming

> Perfect, I'll get it sent across to this number shortly. Keep an eye on your phone.

- **Never ask for their number.** We dialled their mobile, we already have it. Asking makes you sound like you bought a list.
- Only take a number if **they** offer a different one.
- Tap **Send as video**, then **Make their video & send when ready**. It builds and texts itself after you hang up, so don't sit on the line waiting for it.

## 6 · Get off the phone

> Great. It's 2 minutes, watch it when it lands, tonight's fine. Everything's on that page, and if it makes sense you can start it yourself from there for a quid. I'll let you get back to it. Cheers.

- Say "for a quid" **once**, lightly, as a fact. Not a pitch.
- Then hang up while they still feel you gave them something.

---

## Never on this call

- Don't read out the monthly prices. "It starts at a pound" is all you say about money.
- Don't ask for a card. The page takes it, not you.
- Don't ask for their phone number. We rang it.
- Don't try to close. The video closes.
$md$, true
where not exists (select 1 from wk_call_scripts where is_default);

-- ============ 2. the AI coach ============
-- Stages rewritten: the old ones ended at "stay on the line while they add a
-- card", which is the exact wall Hugo's July sales audit blamed for £0 revenue.
update wk_ai_settings set coach_script_prompt = regexp_replace(
  coach_script_prompt,
  'CALL STAGES \(strict forward-only progression\).*?(?=STAGE LOCK)',
  $stages$CALL STAGES (strict forward-only progression)
1. Opener. Warm, casual, like a mate ringing. Their name and business and NOTHING else: "Hi, quick one: is that [name], from [business]?" No recording notice, no review count, no "are you new to the area". Get the yes and move straight to the offer.
2. Offer. THE WHOLE CALL, and it comes straight after the opener: "Right, so here's why I actually rang. I've recorded you a 2-minute video that shows how we can help you rank higher on Google and of course get more jobs. Can I send it to you?"
3. Permission. Give the time back: "I'm not going to take any more of your time, that's genuinely it. I'll get it over to you in the next few minutes. If I send it across, will you watch it?" This is the ONLY close on the call, and it is a yes to WATCHING, not to buying. NEVER promise the video arrives during the call, it is built after the agent hangs up.
4. Sent. Tell them it is coming over to this number shortly and let them go. NEVER ask for their phone number: we dialled it, we already have it, and asking makes the agent sound like they bought a list. Only take a number if THEY volunteer a different one. The agent taps Send as video; it renders and texts itself minutes later. Do not hold them on the line waiting for it.
5. Done. "2 minutes, watch it tonight. If it makes sense you can start it yourself from there for a quid." Then get off the phone.

WHAT THE AGENT MUST NOT DO ON THIS CALL (hard rules)
- NEVER read out the monthly tiers (£99/£179/£279). If asked the price, the only answer is "it starts at a pound, and the video explains the rest", then go straight back to asking permission to send.
- NEVER ask for a card, a sign-up, or bank details. The video page takes payment, the agent never does.
- NEVER ask for their phone number. We dialled their mobile to reach them, so we already have it.
- NEVER refuse to send something. The old script said "I don't send emails", that is now WRONG. The entire call exists to send them a video. If they ask for email, move them to a text because texts get opened, but send it either way.
- NEVER lead with their review count and NEVER name a competitor sitting above them. This call does not diagnose them and does not tell them what they are doing wrong. Opener, then the video ask, that is the whole call.
- The video is the closer. The agent is the opener. A polite no is a fine outcome; a video sent is a good one.

$stages$)
where coach_script_prompt like '%CALL STAGES%';

-- ============ 3. the knowledge base ============
-- Facts that now contradict the motion. Left in place but rewritten, so the
-- coach cannot quote the old close back at an agent mid-call.
update wk_coach_facts set value =
  'They do not need to decide anything on the call. The agent sends a 2-minute video to their mobile; the video shows where they rank, who is above them, and what the service does. They start it themselves from that page for £1, which covers the first 10 days. No card is ever taken over the phone.'
where key = 'free_trial';

update wk_coach_facts set value =
  'On the phone the only price answer is "it starts at a pound". The £1 covers the first 10 days; after that it is one monthly price set by their size, and the video page shows the tiers so the lead reads them in their own time instead of being quoted at down the phone.'
where key in ('pricing_tiers', 'obj_how_much_does_it_cost', 'faq_how_much_is_it_again');

update wk_coach_facts set value =
  'Say yes. The whole call is about sending them something. "I can do one better than an email — it is a 2-minute video, quicker to watch than an email is to read. I will text you the link, you tap it, it plays. Is this number alright?" If they insist on email, take it and send it there too.'
where key = 'obj_send_me_an_email';

update wk_coach_facts set value =
  'Nothing is paid on the phone, so a card in the van is not a problem any more. "You do not need a card for me — I am just sending you a video. Watch it when you are back and there is a button on the page if you want to start it." Never chase a card down the phone.'
where key = 'obj_dont_have_my_card_on';

update wk_coach_facts set value =
  'There is nothing to think about yet — they have not seen anything. "That is exactly why I want to send it. Watch the 2 minutes tonight, then you have actually got something to think about. Can I send it?"'
where key = 'obj_i_need_to_think_about';

update wk_coach_facts set value =
  'Fine — they never buy over the phone and they do not have to. Nothing is sold on this call. The agent sends a video, the lead decides alone, on their own screen, in their own time.'
where key = 'obj_i_never_buy_over_the';

-- New facts for the video itself.
insert into wk_coach_facts (key, label, value, keywords, category, sort_order, is_active)
select * from (values
  ('the_video', 'What the video is',
   'A 2-minute video recorded for that specific business. It shows their real Google listing, where they actually rank in their town, the competitors sitting above them, and what more reviews would do to that. It ends with a £1 button. It is personalised, not a generic advert.',
   '{"what is the video","what will you send","what is it","what am i watching"}'::text[], 'deal', 100, true),
  ('why_90_seconds', 'Why 2 minutes',
   'Because that is genuinely all it is. Saying "2 minutes" and meaning it is what earns the yes — never say "a minute" and then send five.',
   '{"how long is it","how long will it take","havent got time"}'::text[], 'deal', 101, true),
  ('call_recorded', 'Calls are recorded',
   'Yes — every call is recorded for training and quality, and the agent says so in the opener. If the lead objects, that is fine: tell them plainly, offer to carry on without notes, and never argue about it.',
   '{"are you recording","is this recorded","recording me"}'::text[], 'deal', 102, true),
  ('why_a_pound', 'Why £1',
   'The £1 starts their first 10 days and proves the card works. It is a real charge, not a trick, and the monthly price only begins after the 10 days. It exists so nobody has to make a big decision on a cold call.',
   '{"why a pound","whats the catch","only a pound","one pound"}'::text[], 'deal', 103, true)
) as v(key, label, value, keywords, category, sort_order, is_active)
where not exists (select 1 from wk_coach_facts f where f.key = v.key);
