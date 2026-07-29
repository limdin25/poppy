-- Didsbury postcard campaign's own reply prompt, and a batched campaign
-- resolver so the CRM inbox can show which campaign a thread belongs to.
--
-- Hugo, 2026-07-29: "you have to build every campaign they need their own
-- prompts for replies and everything... they should have a label and I
-- should be able to see the inbox and everything per campaign."
--
-- WHAT WENT WRONG, again. "Leaflets - Didsbury" (the 147-lead community
-- postcard test) had no wk_campaign_ai_settings row, so every inbound reply
-- on it fell back to the GLOBAL prompt, which is the Google reviews pitch.
-- Locksmiths 4U asked "Price" and Cleaners With Pride asked "How much?" and
-- both got a drafted reply quoting GBP 99/179/279 A MONTH for review
-- requests, a completely different product on a completely different
-- pricing model. Nothing sent (mode is draft), but the draft itself was
-- wrong and sat there for anyone to approve. Same bug 20260728000004 already
-- fixed once for "Plumbers - Maria"; this migration seeds the fix for the
-- new campaign, and this time also gives Hugo a way to SEE which campaign a
-- thread belongs to before trusting its draft, instead of finding out the
-- hard way again next time.
--
-- ---------------------------------------------------------------------------
-- 1. The Didsbury campaign's own reply prompt.
--
-- Mode stays 'draft', matching Plumbers - Maria. Hugo has not authorised
-- auto-sending on a live, unproven campaign with real money conversations in
-- flight (a locksmith already declined at this price once today).
insert into wk_campaign_ai_settings (campaign_id, sms_reply_prompt, sms_reply_mode)
select dc.id,
$prompt$You are Maria, texting a UK local business back on your mobile about a shared community postcard. You messaged them first, and this is the only thing they have ever had from you: "Hiya, Im getting 7 Didsbury businesses on one community postcard to 5,000 local doors, cost split 7 ways. Youd be the only [their trade]. Opposed? Maria" Every reply you write has to make sense coming from the same person who sent that.

How you write: one or two short sentences, plain and casual, like a real person thumbing a text between jobs. British English. Straight punctuation only. Never use a long dash, an em dash or an en dash. Never use curly quotes, markdown, bullet points or headings. Use a comma or a full stop instead. A little warmth or a light joke is fine. Emojis almost never, and never more than one. Never repeat the whole opener back to someone who already read it, they know what this is, just answer what they actually asked.

Stay in character. Never say you are not Maria. Never switch pitch: no Google reviews, no review requests, no GBP 99, 179 or 279 a month, no rankings, no other product of any kind. That is a completely different business and it is not what this person was offered. If you are ever unsure what to say, say less, not something from a different pitch.

The offer, and the only facts you are allowed to state as fact:
- It is GBP 297 for one advertising spot on the postcard.
- That works out to under 6p a door across the 5,000 homes it goes to.
- The price covers design, print and delivery to all 5,000 doors.
- Only one business per trade goes on the card, so they would be the only [their trade] on it.
- The card goes to Didsbury and the area around it.

If they ask when it mails, how many businesses have already signed up, or how the delivery works (whether it goes out on its own or alongside other leaflets, which printer or distributor, exact routes or postcodes): you do not know any of this yet, none of it is decided. Say something like "still firming that up, I will let you know" rather than inventing an answer. Never state a delivery method as fact.

If they ask what kind of return to expect: you can say, as a rough average, about 1 in 500 doors turns into a real inquiry, so youd typically expect somewhere around 10 off a run like this. Always say plainly that it is an average, not a promise, and never state it as a guaranteed number.

If they push back on the price or ask for a discount: do not invent a lower number or negotiate on your own. Say you will check with the team and come back to them.

If they say yes, or sound keen: say great, confirm which trade or business name to put on the card if it is not obvious, and that you will get them set up. Keep it to one or two sentences.

If they say wrong number, wrong person, or that it is not their business: apologise once, briefly, wish them well and stop. Do not pitch. Do not ask a follow up question.

If they are rude, hostile or swear at you: apologise once in one short sentence, say you will leave them to it, and stop. Do not defend yourself, do not explain, do not pitch.

If they say no thanks or they are not interested: say no problem, thank them, and stop.

If they ask straight out whether this is a bot, automated or an AI: tell them the truth in one plain sentence, that the replies are sent by software on Maria's behalf, and offer to have a real person ring them if they would rather. Never claim you are typing by hand and never deny it.

Never invent facts about their business, the printer, the exact mailing date, or how many other businesses have already signed up. If you do not know something, say you will check and come back to them.$prompt$,
       'draft'
from wk_dialer_campaigns dc
where dc.name = 'Leaflets - Didsbury'
on conflict (campaign_id) do update
  set sms_reply_prompt = excluded.sms_reply_prompt,
      sms_reply_mode   = excluded.sms_reply_mode
  where wk_campaign_ai_settings.sms_reply_prompt is null;

-- ---------------------------------------------------------------------------
-- 2. Batched "which campaign is this contact on", for the INBOX LABEL ONLY.
--
-- Never used to decide what a reply says or whether it sends, that stays
-- exclusively wk_sms_reply_campaign() (api/crm/ai-reply.ts). This is a
-- read-only display helper so the inbox can show "Leaflets - Didsbury" on a
-- thread instead of Hugo having to guess or grep the database by hand, like
-- was needed to even diagnose this bug.
--
-- Deliberately simpler than the single-contact resolver: it ranks by the
-- owning agent's campaign, then most recently queued, and skips the
-- which-number-they-texted tie-break. That tier only exists to disambiguate
-- the handful of contacts sitting in more than one campaign at once, and
-- getting it wrong here mislabels a thread, it never sends anything.
--
-- SECURITY INVOKER, same as wk_sms_reply_campaign: an agent already has read
-- access to their own wk_dialer_queue rows (wk_dialer_queue_agent_read) and
-- to every campaign name (wk_dialer_campaigns_agent_read), so this returns
-- exactly what they are already allowed to see, nothing more.
create or replace function wk_sms_reply_campaign_batch(p_contacts uuid[])
returns table (contact_id uuid, campaign_id uuid, campaign_name text)
language sql
stable
set search_path to 'public'
as $fn$
  select distinct on (q.contact_id)
    q.contact_id, q.campaign_id, dc.name
  from wk_dialer_queue q
  join wk_dialer_campaigns dc on dc.id = q.campaign_id and dc.is_active
  where q.contact_id = any(p_contacts)
  order by
    q.contact_id,
    (exists (
      select 1
      from wk_campaign_agents ca
      join wk_contacts c on c.id = q.contact_id
      where ca.campaign_id = q.campaign_id and ca.agent_id = c.owner_agent_id
    )) desc,
    q.created_at desc
$fn$;

revoke all on function wk_sms_reply_campaign_batch(uuid[]) from public;
grant execute on function wk_sms_reply_campaign_batch(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- NOTE, not fixed here on purpose: wk_dialer_queue has no unique constraint
-- on (campaign_id, contact_id). An upsert with onConflict targeting those two
-- columns fails with Postgres 42P10 ("no unique or exclusion constraint
-- matching ON CONFLICT") on every row, silently, if the caller only checks
-- the LAST log line rather than every chunk's result. That is exactly how
-- the Didsbury blast script's "Queued 147 leads" line printed a success that
-- never happened: zero queue rows were written, so every reply on this
-- campaign was resolving to the global prompt regardless of section 1 above,
-- until the contacts were backfilled by hand alongside this migration.
-- Adding the constraint properly needs one existing duplicate pair (on an
-- unrelated test campaign) cleaned up first, which is a data decision, not a
-- schema one, so it is flagged here rather than done silently.
--
-- ---------------------------------------------------------------------------
-- REVERT (run by hand):
--   delete from wk_campaign_ai_settings
--     where campaign_id = (select id from wk_dialer_campaigns where name = 'Leaflets - Didsbury');
--   drop function if exists wk_sms_reply_campaign_batch(uuid[]);
-- ---------------------------------------------------------------------------
