-- Per-campaign AI text-reply prompt.
--
-- Hugo, 2026-07-28: "every campaign should have own reply prompt".
--
-- What went wrong. Maria cold-texted 100 UK plumbers a WEBSITE opener:
--   "Hey Kevin, this is Pedro. I saw you on Google and noticed you dont have a
--    website. I know this is kinda random, but I built you one :). Wanna see it?"
-- Six replied. The AI answered every one of them with the GOOGLE REVIEWS pitch,
-- because wk_ai_reply_settings is a single global row (id = 'default') shared by
-- every agent and every campaign. The draft to Kevin, who had just said
-- "Yeah sure", opened with "Just to be straight with you, I'm not Pedro and I
-- can't share a website". Nothing was sent, the global mode is 'draft'.
--
-- Shape. The campaign row OVERRIDES the global row field by field. NULL or an
-- empty string means inherit, exactly like the coach prompts already on this
-- table. sms_reply_enabled is an AND, not an override: the global row still
-- decides whether a reply job is enqueued at all (wk-sms-incoming), so a
-- campaign can only ever turn itself OFF, never ON.
--
-- Nothing is seeded for the other campaigns. NULL everywhere means every
-- campaign keeps today's behaviour on day one.

alter table wk_campaign_ai_settings
  add column if not exists sms_reply_prompt  text,
  add column if not exists sms_reply_mode    text,
  add column if not exists sms_reply_model   text,
  add column if not exists sms_reply_enabled boolean;

comment on column wk_campaign_ai_settings.sms_reply_prompt is
  'Per-campaign system prompt for the inbound SMS auto-reply. NULL or empty = inherit wk_ai_reply_settings.system_prompt.';
comment on column wk_campaign_ai_settings.sms_reply_mode is
  'draft or auto. NULL = inherit wk_ai_reply_settings.mode.';
comment on column wk_campaign_ai_settings.sms_reply_model is
  'LLM id for the reply. NULL or empty = inherit wk_ai_reply_settings.model.';
comment on column wk_campaign_ai_settings.sms_reply_enabled is
  'AND with the global switch, never an override. false turns replies off for this campaign only. true cannot turn them on when the global switch is off.';

do $mode_chk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wk_campaign_sms_reply_mode_chk'
  ) then
    alter table wk_campaign_ai_settings
      add constraint wk_campaign_sms_reply_mode_chk
      check (sms_reply_mode is null or sms_reply_mode in ('draft', 'auto'));
  end if;
end
$mode_chk$;

-- updated_at was never wired on this table, so a prompt edit looked like it was
-- written the day the row was created.
drop trigger if exists wk_campaign_ai_settings_set_updated_at on wk_campaign_ai_settings;
create trigger wk_campaign_ai_settings_set_updated_at
  before update on wk_campaign_ai_settings
  for each row execute function wk_set_updated_at();

-- ---------------------------------------------------------------------------
-- Which campaign does an inbound text belong to?
--
-- There is no campaign_id on wk_sms_messages, and broadcast_id is NULL on every
-- row because the blasts send one by one through wk-sms-send. The durable link
-- is wk_dialer_queue: every lead loader writes a queue row per lead per campaign
-- at import time, so campaign membership is recorded rather than guessed.
--
-- Ranking, which only matters for the 4 contacts that sit in more than one
-- campaign:
--   1. the campaign that owns the number the lead actually texted
--   2. the campaign the lead's owning agent is on
--   3. the most recently queued
--
-- Verified 2026-07-28 against all 17 UK repliers of the previous 3 days: 17/17
-- resolved, and it separates the 27 Jul reviews blast from the 28 Jul website
-- blast even though both went out from +447460035763.
--
-- A contact with no queue row returns NULL, and the caller falls back to the
-- global prompt. That is correct: no campaign means no campaign pitch.
--
-- SECURITY INVOKER on purpose. The only caller is /api/crm/ai-reply on the
-- service-role key, which bypasses RLS anyway. Making it DEFINER would hand
-- authenticated users a read into every agent's queue for no benefit.
create or replace function wk_sms_reply_campaign(p_contact uuid, p_number text)
returns uuid
language sql
stable
set search_path to 'public'
as $fn$
  select q.campaign_id
  from wk_dialer_queue q
  join wk_dialer_campaigns dc on dc.id = q.campaign_id and dc.is_active
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
    q.created_at desc
  limit 1
$fn$;

revoke all on function wk_sms_reply_campaign(uuid, text) from public;
grant execute on function wk_sms_reply_campaign(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Duplicating a campaign must carry its reply prompt.
--
-- The function is wk_duplicate_campaign, NOT wk_clone_campaign (there is no
-- wk_clone_campaign in this database). It lists columns explicitly
-- (20260715000001_crm_port.sql:1770), so the four new columns are silently
-- dropped on every duplicate unless it is rewritten. Body below is the live
-- definition verbatim, with the wk_campaign_ai_settings INSERT as the only edit.
create or replace function wk_duplicate_campaign(
  p_source_id uuid,
  p_new_name  text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $dup$
DECLARE
  v_new_id uuid;
BEGIN
  IF NOT wk_is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  INSERT INTO wk_dialer_campaigns (
    name, pipeline_id, parallel_lines, auto_advance_seconds,
    ai_coach_enabled, ai_coach_prompt_id, script_md,
    default_outcome_column_id, call_script_id, is_active
  )
  SELECT
    p_new_name, pipeline_id, parallel_lines, auto_advance_seconds,
    ai_coach_enabled, ai_coach_prompt_id, script_md,
    default_outcome_column_id, call_script_id, is_active
  FROM wk_dialer_campaigns
  WHERE id = p_source_id
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'Source campaign % not found', p_source_id;
  END IF;

  INSERT INTO wk_campaign_ai_settings
    (campaign_id, coach_style_prompt, coach_script_prompt, live_coach_model, postcall_model,
     sms_reply_prompt, sms_reply_mode, sms_reply_model, sms_reply_enabled)
  SELECT v_new_id, coach_style_prompt, coach_script_prompt, live_coach_model, postcall_model,
     sms_reply_prompt, sms_reply_mode, sms_reply_model, sms_reply_enabled
  FROM wk_campaign_ai_settings WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_facts
    (campaign_id, key, label, value, keywords, sort_order, is_active, category)
  SELECT v_new_id, key, label, value, keywords, sort_order, is_active, category
  FROM wk_campaign_facts WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_terminologies
    (campaign_id, term, short_gist, definition_md, category, sort_order, is_active)
  SELECT v_new_id, term, short_gist, definition_md, category, sort_order, is_active
  FROM wk_campaign_terminologies WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_agents (campaign_id, agent_id, role)
  SELECT v_new_id, agent_id, role
  FROM wk_campaign_agents WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_numbers (campaign_id, number_id, priority)
  SELECT v_new_id, number_id, priority
  FROM wk_campaign_numbers WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_sms_templates (campaign_id, name, body_md, merge_fields)
  SELECT v_new_id, name, body_md, merge_fields
  FROM wk_campaign_sms_templates WHERE campaign_id = p_source_id;

  RETURN v_new_id;
END;
$dup$;

-- ---------------------------------------------------------------------------
-- The one seed: "Plumbers - Maria", the website campaign that caused this.
--
-- The prompt answers the opener that actually went out. It stays Pedro, it
-- never denies the website, and when a lead says yes it says the site is being
-- finished and the link follows shortly, because there is no URL to give them
-- and inventing one is how you lose a lead twice.
--
-- Mode stays 'draft'. Hugo has NOT authorised auto-sending on this campaign.
--
-- Punctuation is plain and straight on purpose. A model copies the punctuation
-- it is shown, and one long dash flips a text from GSM-7 (160 characters a
-- segment) to UCS-2 (70). See api/lib/sms-charset.ts and tests/message-copy.test.ts.
insert into wk_campaign_ai_settings (campaign_id, sms_reply_prompt, sms_reply_mode)
select dc.id,
$prompt$You are Pedro, texting a UK plumber or trade business owner back on your mobile. You messaged them first, and this is the only thing they have ever had from you: "Hey [first name], this is Pedro. I saw you on Google and noticed you dont have a website. I know this is kinda random, but I built you one :). Wanna see it?" Every reply you write has to make sense coming from the same person who sent that.

How you write: one or two short sentences, plain and low key, like a real person thumbing a text on a job. British English. Straight punctuation only. Never use a long dash, an em dash or an en dash. Never use curly quotes, markdown, bullet points or headings. Use a comma or a full stop instead. Emojis almost never, and never more than one.

Stay in character. Never say you are not Pedro. Never say the website does not exist, was a mistake, or went to the wrong person. Never switch pitch: no Google reviews, no rankings, no videos, no plans, no monthly prices. That is a different campaign and it is not what this person was offered.

If they say yes, or ask to see it, or sound curious: tell them it is being finished off and the link will come over shortly. Keep it to one or two sentences. Do not send, invent, guess, spell out or describe a link, a URL or a domain name of any kind. There is no link yet. If they push for it now, say it will be with them soon and leave it there.

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
  set sms_reply_prompt = excluded.sms_reply_prompt,
      sms_reply_mode   = excluded.sms_reply_mode
  where wk_campaign_ai_settings.sms_reply_prompt is null;

-- ---------------------------------------------------------------------------
-- REVERT (run by hand):
--   delete from wk_campaign_ai_settings where sms_reply_prompt is not null;
--   alter table wk_campaign_ai_settings
--     drop column sms_reply_prompt, drop column sms_reply_mode,
--     drop column sms_reply_model,  drop column sms_reply_enabled;
--   drop function if exists wk_sms_reply_campaign(uuid, text);
-- and re-apply the wk_duplicate_campaign body from
-- 20260715000001_crm_port.sql.
-- ---------------------------------------------------------------------------
