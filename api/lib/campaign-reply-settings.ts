// Per-campaign AI text-reply settings: the merge rule, on its own, testable.
//
// Hugo, 2026-07-28: "every campaign should have own reply prompt".
//
// wk_ai_reply_settings is ONE global row (id = 'default'). Maria's website
// campaign ("this is Pedro, I built you a website") was answered with the
// Google reviews pitch because that row is all the reply generator has ever
// read. wk_campaign_ai_settings now carries a per-campaign override, and this
// module is the only place that decides which value wins.
//
// Resolution lives in the DB function wk_sms_reply_campaign(contact, number):
// wk_dialer_queue is the durable lead-to-campaign link, ranked by the number
// the lead texted, then the owning agent's campaign, then most recently queued.
// No queue row means no campaign, and the global row is used untouched.

export type ReplyMode = 'draft' | 'auto';

export interface GlobalReplySettings {
  enabled: boolean;
  mode: ReplyMode;
  model: string;
  system_prompt: string;
}

/** The wk_campaign_ai_settings columns this feature owns. All nullable. */
export interface CampaignReplyOverride {
  sms_reply_prompt: string | null;
  sms_reply_mode: ReplyMode | null;
  sms_reply_model: string | null;
  sms_reply_enabled: boolean | null;
}

export interface ResolvedReplySettings {
  enabled: boolean;
  mode: ReplyMode;
  model: string;
  system_prompt: string;
  campaign_id: string | null;
  /** 'campaign' ONLY when the PROMPT itself came from the campaign row. */
  source: 'campaign' | 'global';
}

const text = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Field-by-field override with fallback to the global row.
 *
 * THE RULE: a campaign may be MORE cautious than the workspace, never less.
 * Prompt and model are content, so the campaign wins outright. Every switch
 * that decides whether a real lead gets a text with nobody reading it first
 * resolves to the safer of the two settings.
 *
 * - system_prompt / model: a non-empty campaign string wins. Empty or blank
 *   means inherit, which matches how the coach prompts already behave and how
 *   the editor clears an override.
 * - mode: the SAFE side wins. 'auto' only when the workspace AND the campaign
 *   both say 'auto'. A workspace on 'draft' therefore stays on 'draft' whatever
 *   a campaign asks for. It used to be a plain override, which meant one
 *   campaign box could start auto-sending to real leads while the workspace
 *   switch still read 'draft', and every human reading that switch would have
 *   been wrong. A campaign can still hold itself back on 'draft' while the
 *   workspace runs 'auto'.
 * - enabled: an AND, never an OR. The global switch also gates whether an
 *   ai_reply job is enqueued at all (supabase/functions/wk-sms-incoming), so a
 *   campaign-level `true` would be dead config. A campaign can only turn itself
 *   off.
 * - campaignActive: pass wk_dialer_campaigns.is_active. `false` (paused) is an
 *   AND too, so a paused campaign goes quiet. Pass null when there is no
 *   campaign or the flag is not known, which leaves the decision to the two
 *   switches above. Pausing a finished blast used to make its leads fall back to
 *   the GLOBAL prompt, i.e. answer a website opener with the reviews pitch,
 *   which is the exact bug this module exists to prevent.
 */
export function mergeReplySettings(
  global: GlobalReplySettings,
  campaignId: string | null,
  override: CampaignReplyOverride | null,
  campaignActive: boolean | null = null,
): ResolvedReplySettings {
  const prompt = text(override?.sms_reply_prompt);
  const model = text(override?.sms_reply_model);
  const mode = override?.sms_reply_mode ?? null;
  const wanted: ReplyMode = mode === 'draft' || mode === 'auto' ? mode : global.mode;

  return {
    enabled: !!global.enabled
      && (override?.sms_reply_enabled ?? true)
      && campaignActive !== false,
    mode: global.mode === 'auto' && wanted === 'auto' ? 'auto' : 'draft',
    model: model || global.model,
    system_prompt: prompt || global.system_prompt,
    campaign_id: campaignId ?? null,
    source: prompt ? 'campaign' : 'global',
  };
}
