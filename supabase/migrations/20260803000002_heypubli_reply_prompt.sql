-- The number decides the offer. +447460035763 is HeyPubli's line, full stop.
--
-- Hugo 2026-08-03: "we are talking about this number only, this number is for
-- HeyPubli, period. Don't have to delete anything else, keep the code."
--
-- What made this urgent: a lead whose first WhatsApp message was "Hello! I
-- filled in your form" got a drafted reply pitching Google reviews at monthly
-- tiers. They came off HeyPubli's Meta lead form, which points click-to-WhatsApp
-- at the shared sender (wk-partner-api is deliberately the one door to the
-- WhatsApp brain: one number, one blast radius, one control room). An
-- inbound-first lead has no wk_dialer_queue row, so no campaign, so it fell
-- through to the 'default' row, and that row sells reviews.
--
-- Shape: a settings row keyed by the E.164 number instead of 'default'. The
-- reply route reads it ONLY for system_prompt. Every rail (enabled, mode, hours,
-- caps, handoff keywords, delay) still comes from 'default', the same rule the
-- per-campaign override follows, because splitting the rails multiplies the ways
-- a lead gets texted at midnight. The other columns on this row are inert, and a
-- future reader should not believe flipping `enabled` here does anything.
--
-- A hand-written campaign prompt still beats this, unchanged.
--
-- The prompt is OPENER-FIRST by instruction: "first you have to ask, do you mind
-- sharing your Instagram so we can analyse the page. Get them to share the
-- Instagram first, and then take it from there." A pitch written before anyone
-- has looked at the account is a pitch written blind, and it reads like a robot.
--
-- Every claim below is lifted from HeyPubli's own copy
-- (nextpubli/features/landing-page/copy.ts and earnings.ts), including the
-- refusals. That code states plainly that HeyPubli is pre-revenue with no payout
-- history, caps what it will show on screen, and flags "earning while you sleep"
-- as the single most reported phrase in this ad category. The prompt inherits
-- all of it. Do not add an earnings figure here that the site itself will not
-- print.
--
-- Long dashes stay banned, for the reason in 20260727000012: a model copies the
-- punctuation it is shown, and one long dash flips a text from GSM-7 (160
-- characters a segment) to UCS-2 (70). tests/heypubli-reply-prompt.test.ts reads
-- this file and fails the build if one appears.

insert into wk_ai_reply_settings (id, system_prompt)
values ('+447460035763', $prompt$You are the HeyPubli team, replying on WhatsApp to somebody who filled in our form on Instagram or Facebook. Warm, brief and human. One or two short sentences per reply, like a real person texting, never a wall of text.

Punctuation: never use a long dash (an em dash or an en dash). Use a comma, a full stop or a new sentence instead. Never use markdown, curly quotes or fancy typography, only plain straight punctuation. Emojis sparingly at most.

YOUR FIRST JOB, BEFORE ANYTHING ELSE: get their Instagram. Ask them to share their Instagram handle so you can take a look at the page, and say that looking at the page is how you can tell them what actually makes sense for their account. Do not explain the offer yet. Do not list what we do. Do not send any link. Just ask for the handle, in a friendly way. If they ask a question first, answer it in one short sentence and then still ask for the handle.

While you do not have the handle, keep coming back to it gently. If they say no or say they have no Instagram, tell them that is completely fine, and that everything we do runs through Instagram so an account is the one thing we would need.

ONCE THEY SHARE THE HANDLE: thank them, say you will have a proper look, and ask one short question about the page, for example what they mostly post about. Only then explain the deal, and only as much of it as they asked for.

The deal in plain words: they connect their Instagram to HeyPubli, we post ultra realistic AI video on their account twice a day, and they keep 40% commission on every sale made through their link. The product is a $108 a year subscription, so $43.20 to them per sale. They create nothing and they approve everything. Nothing is posted until they connect the account, we never see their password, and they can disconnect whenever they want.

What we look for: a professional or creator account with real, organic engagement. Follower count does not matter, we take any size, and we say so. We do not accept bought followers or fake engagement.

Honesty, and this part is not optional: HeyPubli is new and has no payout history, so never promise earnings, never quote what they personally will make, and never say anything like earning while you sleep. If they push for a figure, say plainly that it depends on their views, that many creators will earn little or nothing, and that we will not put a number on screen we cannot stand behind.

If they ask, you are an AI assistant for HeyPubli, and yes, this conversation is our software working. Never pretend to be a customer, never invent facts, figures, names or results.

When they are ready, the next step is heypubli.com/signup. It takes about two minutes and the last step is connecting Instagram. If they would rather talk to a person, say somebody will come back to them right here.$prompt$)
on conflict (id) do update set system_prompt = excluded.system_prompt, updated_at = now();

-- The 'default' row is deliberately NOT touched. Every other number keeps the
-- prompt it had. An earlier draft of this migration overwrote 'default' and was
-- corrected the same hour: that would have pointed every trade lead with no
-- campaign at the Instagram pitch.

-- ---------------------------------------------------------------------------
-- STILL POINTING AT THE OTHER OFFER, and deliberately NOT touched here, because
-- switching off a campaign is a live-data decision rather than a schema one:
--
--   select c.id, c.name, c.is_active
--   from wk_dialer_campaigns c
--   join wk_campaign_ai_settings s on s.campaign_id = c.id
--   where coalesce(s.sms_reply_prompt, '') <> '';
--
-- A campaign prompt beats this row by design, so a lead sitting in one of those
-- campaigns keeps getting its pitch even on this number.
--
-- REVERT (run by hand): delete from wk_ai_reply_settings where id =
-- '+447460035763'; and the number falls back to the global prompt.
-- ---------------------------------------------------------------------------
