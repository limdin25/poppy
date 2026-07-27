// The auto-send decision, on its own so it can be tested without a database.
//
// An armed send is a text that will go out with nobody watching. Every branch
// below is a reason it might no longer be the right thing to do by the time the
// render lands ~10 minutes after the agent hung up.

export type AutoSendChannel = 'sms' | 'whatsapp' | 'email';

export interface AutoSendPage {
  state: string;
  render_status: 'queued' | 'rendering' | 'ready' | 'failed' | null;
  video_url: string | null;
  auto_send_channel: AutoSendChannel | null;
  auto_send_armed_at: string | null;
}

export interface AutoSendContext {
  now: Date;
  /** The funnel master switch (platform_settings.vsl_automation.enabled). */
  funnelEnabled: boolean;
  /** Inside the configured quiet-hours window, Europe/London. */
  insideHours: boolean;
  /** A workspace-wide fallback video exists, so a page with no render is still
   *  playable — mirrors the mark_sent gate in api/crm/vsl-page.ts. */
  hasDefaultVideo: boolean;
}

export type AutoSendVerdict =
  | { action: 'send' }
  | { action: 'wait'; reason: 'rendering' | 'quiet_hours' | 'funnel_off' }
  | {
      action: 'abort';
      reason: 'not_armed' | 'already_sent' | 'render_failed' | 'expired' | 'no_video';
    };

/** How long an arm survives uncollected. The funnel going dark for two days
 *  must not mean a batch of week-old leads all get texted the moment the
 *  switch comes back on. */
export const AUTO_SEND_TTL_HOURS = 24;

export function autoSendDecision(page: AutoSendPage, ctx: AutoSendContext): AutoSendVerdict {
  if (!page.auto_send_channel) return { action: 'abort', reason: 'not_armed' };

  // An agent who sent by hand in the meantime has already had the conversation.
  if (page.state && page.state !== 'created') return { action: 'abort', reason: 'already_sent' };

  // Expiry is checked BEFORE the holds: otherwise a page held by quiet hours or
  // a dark funnel would sit armed indefinitely and outlive its own TTL.
  const armedAt = page.auto_send_armed_at ? new Date(page.auto_send_armed_at).getTime() : NaN;
  if (!Number.isFinite(armedAt)) return { action: 'abort', reason: 'expired' };
  if (ctx.now.getTime() - armedAt > AUTO_SEND_TTL_HOURS * 3_600_000) {
    return { action: 'abort', reason: 'expired' };
  }

  if (page.render_status === 'failed') return { action: 'abort', reason: 'render_failed' };
  if (page.render_status === 'queued' || page.render_status === 'rendering') {
    return { action: 'wait', reason: 'rendering' };
  }

  if (!ctx.funnelEnabled) return { action: 'wait', reason: 'funnel_off' };
  if (!ctx.insideHours) return { action: 'wait', reason: 'quiet_hours' };

  if (!page.video_url && !ctx.hasDefaultVideo) return { action: 'abort', reason: 'no_video' };

  return { action: 'send' };
}
