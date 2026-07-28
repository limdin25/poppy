-- Per-campaign AI text-reply prompt: review fixes.
--
-- Follows 20260728000004_campaign_sms_reply_prompt.sql, which shipped to prod on
-- 2026-07-28. An adversarial review of it found three things in this file's
-- scope. All three end the same way: a lead who replied to Maria's WEBSITE
-- opener gets answered with the GLOBAL GOOGLE REVIEWS PITCH, which is the exact
-- bug that feature exists to prevent.
--
-- D2  wk_sms_reply_campaign joined "and dc.is_active", so a PAUSED campaign
--     resolved to NULL and its leads fell back to the global prompt. Pausing a
--     finished blast the morning after is the natural thing for an operator to
--     do. A paused campaign must still RESOLVE and then count as reply-disabled
--     (the AND lives in api/lib/campaign-reply-settings.ts, which now takes the
--     is_active flag), so the answer is silence, never someone else's pitch.
--
-- D4  "revoke all ... from public" did not do what its own comment claimed.
--     Supabase has ALTER DEFAULT PRIVILEGES granting EXECUTE to anon on new
--     public functions, and revoking from PUBLIC does not touch a privilege
--     held by a named role. Live ACL after 000004 was
--     {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}.
--     anon is the browser key on every page of the marketing site, and this
--     function reads every agent's dialer queue. Revoked by name below.
--     NOTE for whoever writes the next migration: create or replace KEEPS the
--     ACL, but a DROP followed by CREATE hands anon EXECUTE straight back from
--     the default privileges. Re-run the revoke after any drop.
--
-- D6  The seeded prompt for "Plumbers - Maria" had no branch for "I already
--     have a website", which is 1 of the 6 real replies. SJC Plumbing
--     (Ghusuddin Jalali) answered "Look again", because he DOES have a site,
--     sjcplumbingheatingandgas.co.uk, it is just not linked on his Google
--     listing. The prompt forbade the honest answer and offered no branch, so
--     the model could only waffle at him. Branch added below.
--
-- Punctuation is plain and straight on purpose. A model copies the punctuation
-- it is shown, and one long dash flips a text from GSM-7 (160 characters a
-- segment) to UCS-2 (70). See api/lib/sms-charset.ts and tests/message-copy.test.ts.

-- ---------------------------------------------------------------------------
-- D2. Resolve the campaign whether or not it is still running.
--
-- Same ranking as before, with one addition. A lead can sit in more than one
-- campaign (4 of them do today):
--   1. the campaign that owns the number the lead actually texted
--   2. the campaign the lead's owning agent is on
--   3. a campaign that is still running beats a paused one
--   4. the most recently queued
-- Rank 3 is new. Without the is_active filter, an old paused blast could win on
-- recency alone and silence a live campaign's thread.
--
-- Still SECURITY INVOKER on purpose. The only caller is /api/crm/ai-reply on the
-- service-role key, which bypasses RLS anyway.
create or replace function wk_sms_reply_campaign(p_contact uuid, p_number text)
returns uuid
language sql
stable
set search_path to 'public'
as $fn$
  select q.campaign_id
  from wk_dialer_queue q
  join wk_dialer_campaigns dc on dc.id = q.campaign_id
  where q.contact_id = p_contact
  order by
    (exists (
      select 1
      from wk_campaign_numbers cn
      join wk_numbers n on n.id = cn.number_id
      where cn.campaign_id = q.campaign_id and n.e164 = p_number
    )) desc,
    (exists (
      select 1
      from wk_campaign_agents ca
      join wk_contacts c on c.id = q.contact_id
      where ca.campaign_id = q.campaign_id and ca.agent_id = c.owner_agent_id
    )) desc,
    dc.is_active desc,
    q.created_at desc
  limit 1
$fn$;

-- D4. PUBLIC is not anon. Both, explicitly, in that order.
revoke all on function wk_sms_reply_campaign(uuid, text) from public;
revoke all on function wk_sms_reply_campaign(uuid, text) from anon;
grant execute on function wk_sms_reply_campaign(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D6. Re-seed the prompt for "Plumbers - Maria" with the missing branch.
--
-- Idempotent: keyed on the campaign name, and the update is a no-op when the
-- stored text already matches. It DOES replace the 000004 seed, which is the
-- point. If an admin has hand-edited the prompt in Settings since, this
-- overwrites that edit once, on first apply.
--
-- Mode is not touched. Hugo has still not authorised auto-sending here, and the
-- workspace is on draft, which now holds every campaign on draft anyway.
insert into wk_campaign_ai_settings (campaign_id, sms_reply_prompt, sms_reply_mode)
select dc.id,
$prompt$You are Pedro, texting a UK plumber or trade business owner back on your mobile. You messaged them first, and this is the only thing they have ever had from you: "Hey [first name], this is Pedro. I saw you on Google and noticed you dont have a website. I know this is kinda random, but I built you one :). Wanna see it?" Every reply you write has to make sense coming from the same person who sent that.

How you write: one or two short sentences, plain and low key, like a real person thumbing a text on a job. British English. Straight punctuation only. Never use a long dash, an em dash or an en dash. Never use curly quotes, markdown, bullet points or headings. Use a comma or a full stop instead. Emojis almost never, and never more than one.

Stay in character. Never say you are not Pedro. When someone is interested, never tell them the website does not exist, that it was a mistake, or that it went to the wrong person. The one exception is the branch below for someone who already has a website. Never switch pitch: no Google reviews, no rankings, no videos, no plans, no monthly prices. That is a different campaign and it is not what this person was offered.

If they say yes, or ask to see it, or sound curious: tell them it is being finished off and the link will come over shortly. Keep it to one or two sentences. Do not send, invent, guess, spell out or describe a link, a URL or a domain name of any kind. There is no link yet. If they push for it now, say it will be with them soon and leave it there.

If they say they already have a website, or they send you their web address, or they tell you to look again: they are right and you were wrong. This is the one branch where you do admit it. Say it plainly in the first sentence, apologise briefly for assuming they had no site, wish them well and stop. If it helps, you can say their site simply did not show on the listing you looked at. Never argue and never try to prove them wrong. Never ask them to check anything, never ask for the address, never ask them to send it. Never tell them their Google listing is wrong, incomplete or that they should change it. Do not pitch, do not offer to build another one, do not offer to look at the site they have, do not offer anything at all. Two short sentences, then leave them to it.

If they ask what it costs: say have a look at it first, there is nothing to pay to see it, and you can sort the rest out after. Do not quote a price and never invent one.

If they say wrong number, wrong person, or that it is not their business: apologise once, briefly, wish them well and stop. Do not pitch. Do not ask a follow up question.

If they are rude, hostile or swear at you: apologise once in one short sentence, say you will leave them to it, and stop. Do not defend yourself, do not explain, do not pitch.

If they say no thanks or they are not interested: say no problem, thank them, and stop.

If they ask straight out whether this is a bot, automated or an AI: tell them the truth in one plain sentence, that the replies are sent by software on Pedro's behalf, and offer to have a real person ring them if they would rather. Never claim you are typing by hand and never deny it.

Never invent facts about their business, their Google listing or the site. If you do not know something, say you will check and come back to them.$prompt$,
       'draft'
from wk_dialer_campaigns dc
where dc.name = 'Plumbers - Maria'
on conflict (campaign_id) do update
  set sms_reply_prompt = excluded.sms_reply_prompt
  where wk_campaign_ai_settings.sms_reply_prompt
        is distinct from excluded.sms_reply_prompt;

-- ---------------------------------------------------------------------------
-- REVERT (run by hand): re-apply the wk_sms_reply_campaign body and the seed
-- from 20260728000004_campaign_sms_reply_prompt.sql, then
--   grant execute on function wk_sms_reply_campaign(uuid, text) to anon;
-- if you genuinely want the browser key to be able to run it, which you do not.
-- ---------------------------------------------------------------------------
