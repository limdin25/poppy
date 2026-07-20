// The review-request drip engine. Every minute: atomically claim due rows,
// run the compliance guards, render the personalized image, send SMS/email,
// schedule follow-ups. Node runtime (sharp). Guards, in order, per send:
// suppression → plan cap → quiet hours → pause switches. Send-to-all is the
// only mode — there is deliberately no sentiment filter anywhere.

import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import {
  isSuppressed,
  insideQuietWindow,
  requestsUsedThisPeriod,
  incrementUsage,
  logReviewEvent,
  fireReviewWebhooks,
} from '../lib/review-guards.js';
import { capForPlan } from '../lib/review-plans.js';
import {
  composeSmsBody,
  composeEmail,
  nextWindowOpen,
  randomToken,
  firstNameOf,
  type SendSettings,
} from '../lib/review-send.js';
import { renderPersonalizedImage } from '../lib/render-review-image.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 15;

interface RequestRow {
  id: string;
  business_id: string;
  contact_id: string;
  campaign_id: string | null;
  channel: string;
  status: string;
  followups_sent: number;
  first_sent_at: string | null;
  clicked_at: string | null;
  click_token: string | null;
  image_url: string | null;
}

async function reschedule(ids: string[], at: Date): Promise<void> {
  if (!ids.length) return;
  await supabase.from('review_requests').update({ next_send_at: at.toISOString() }).in('id', ids);
}

export default async function handler(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  const raw = req.headers['authorization'];
  const auth = Array.isArray(raw) ? raw[0] : raw;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { data: claimed, error: claimError } = await supabase.rpc('claim_due_review_requests', { batch: BATCH });
  if (claimError) {
    res.status(500).json({ error: claimError.message });
    return;
  }
  const rows = (claimed ?? []) as RequestRow[];
  if (!rows.length) {
    res.status(200).json({ ok: true, processed: 0 });
    return;
  }

  const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';
  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  const results = { sent: 0, followups: 0, skipped: 0, failed: 0 };

  // Group by business so guards load once per client.
  const byBusiness = new Map<string, RequestRow[]>();
  for (const r of rows) {
    if (!byBusiness.has(r.business_id)) byBusiness.set(r.business_id, []);
    byBusiness.get(r.business_id)!.push(r);
  }

  for (const [businessId, bizRows] of byBusiness) {
    const [{ data: settings }, { data: conn }, { data: biz }] = await Promise.all([
      supabase.from('review_settings').select('*').eq('business_id', businessId).maybeSingle(),
      supabase.from('gbp_connections').select('review_url, status').eq('business_id', businessId).maybeSingle(),
      supabase.from('businesses').select('name, plan').eq('id', businessId).single(),
    ]);
    const s = settings as (SendSettings & { sending_paused: boolean; image_enabled: boolean; sms_from_number: string | null }) | null;

    if (!s || s.sending_paused) {
      await reschedule(bizRows.map((r) => r.id), new Date(Date.now() + 4 * 3600_000));
      results.skipped += bizRows.length;
      continue;
    }
    if (!insideQuietWindow(s)) {
      await reschedule(bizRows.map((r) => r.id), nextWindowOpen(s, new Date()));
      results.skipped += bizRows.length;
      continue;
    }
    if (!conn?.review_url || conn.status !== 'connected') {
      await reschedule(bizRows.map((r) => r.id), new Date(Date.now() + 6 * 3600_000));
      results.skipped += bizRows.length;
      continue;
    }

    // Active template for personalized images (once per business)
    const { data: template } = await supabase
      .from('review_image_templates')
      .select('public_url, name_x, name_y, font_size, font_color, greeting_prefix')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let capBlocked = false;

    for (const row of bizRows) {
      try {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id, name, phone, email')
          .eq('id', row.contact_id)
          .single();
        if (!contact) {
          await supabase.from('review_requests').update({ status: 'failed', error: 'contact missing', next_send_at: null }).eq('id', row.id);
          results.failed++;
          continue;
        }

        // Guard 1 — suppression, always, cross-channel.
        if (await isSuppressed(businessId, { phone: contact.phone, email: contact.email })) {
          await supabase.from('review_requests').update({ status: 'opted_out', next_send_at: null }).eq('id', row.id);
          await logReviewEvent({ businessId, requestId: row.id, contactId: contact.id, type: 'opted_out', meta: { at: 'send_guard' } });
          results.skipped++;
          continue;
        }

        const isInitial = !row.first_sent_at;

        // Smart stop: clicked contacts get no follow-ups (they've seen the link).
        if (!isInitial && row.clicked_at) {
          await supabase.from('review_requests').update({ next_send_at: null }).eq('id', row.id);
          results.skipped++;
          continue;
        }

        // Follow-ups exhausted → resolve the funnel row.
        if (!isInitial && (!s.followups_enabled || row.followups_sent >= s.followup_count)) {
          await supabase.from('review_requests').update({ status: 'no_review', next_send_at: null }).eq('id', row.id);
          results.skipped++;
          continue;
        }

        // Guard 2 — monthly plan cap (initial sends only; follow-ups are free).
        if (isInitial) {
          if (capBlocked) {
            await reschedule([row.id], nextMonthStart());
            results.skipped++;
            continue;
          }
          const cap = capForPlan(biz?.plan) ?? 50;
          const used = await requestsUsedThisPeriod(businessId);
          if (used >= cap) {
            capBlocked = true;
            await reschedule([row.id], nextMonthStart());
            await logReviewEvent({ businessId, type: 'cap_reached', meta: { cap, used } });
            results.skipped++;
            continue;
          }
        }

        const firstName = firstNameOf(contact.name) ?? 'there';
        const token = row.click_token ?? randomToken();
        const reviewLink = `${goUrl}/r/${token}`;

        // Personalized image (initial only, needs a real first name).
        let imageUrl = row.image_url;
        if (isInitial && s.image_enabled && firstName !== 'there' && !imageUrl) {
          try {
            imageUrl = await renderPersonalizedImage({
              template: template ?? null,
              firstName,
              businessId,
              requestId: row.id,
            });
          } catch (err) {
            console.error('[review-engine] image render failed:', (err as Error).message);
          }
        }

        const bizName = biz?.name || 'us';
        const useSms = !!contact.phone && !!s.sms_from_number;
        const useEmail = !useSms && !!contact.email;

        if (!useSms && !useEmail) {
          // No sender number yet (admin hasn't purchased) and no email fallback.
          await reschedule([row.id], new Date(Date.now() + 6 * 3600_000));
          await logReviewEvent({ businessId, requestId: row.id, contactId: contact.id, type: 'skipped_no_channel' });
          results.skipped++;
          continue;
        }

        let twilioSid: string | null = null;
        let resendId: string | null = null;
        let sentBody: string | null = null;

        if (useSms) {
          const body = await composeSmsBody({ settings: s, businessName: bizName, firstName, reviewLink, isFollowup: !isInitial });
          sentBody = body;
          const out = await sendSMS(s.sms_from_number!, contact.phone!, body, {
            statusCallback: `${appUrl}/api/webhooks/twilio-reviews-status`,
            // UK long codes can't send MMS — attach media only for non-UK senders.
            ...(imageUrl && !s.sms_from_number!.startsWith('+44') ? { mediaUrl: imageUrl } : {}),
          });
          twilioSid = out.sid;
        } else {
          const unsubscribeUrl = `${appUrl}/api/reviews/unsubscribe?token=${token}`;
          const { subject, html } = composeEmail({
            settings: s, businessName: bizName, firstName, reviewLink,
            imageUrl: isInitial ? imageUrl : null, unsubscribeUrl, isFollowup: !isInitial,
          });
          const out = await sendEmail(contact.email!, subject, html);
          resendId = out.id;
        }

        const now = new Date().toISOString();
        const nextFollowupAt = s.followups_enabled && (row.followups_sent + (isInitial ? 0 : 1)) < s.followup_count
          ? new Date(Date.now() + s.followup_gap_days * 86400_000).toISOString()
          : (isInitial && s.followups_enabled && s.followup_count > 0
              ? new Date(Date.now() + s.followup_gap_days * 86400_000).toISOString()
              : new Date(Date.now() + 7 * 86400_000).toISOString()); // finalization pass

        await supabase.from('review_requests').update({
          status: 'in_progress',
          channel: useSms ? 'sms' : 'email',
          click_token: token,
          image_url: imageUrl,
          ...(isInitial
            ? { first_sent_at: now, message_body: sentBody }
            : { followups_sent: row.followups_sent + 1 }),
          last_sent_at: now,
          next_send_at: nextFollowupAt,
          ...(twilioSid ? { twilio_sid: twilioSid } : {}),
          ...(resendId ? { resend_id: resendId } : {}),
        }).eq('id', row.id);

        if (isInitial) {
          await incrementUsage(businessId, 1);
          if (row.campaign_id) {
            const { data: camp } = await supabase.from('review_campaigns').select('sent_count').eq('id', row.campaign_id).single();
            await supabase.from('review_campaigns').update({ sent_count: (camp?.sent_count ?? 0) + 1 }).eq('id', row.campaign_id);
          }
          results.sent++;
        } else {
          results.followups++;
        }

        await logReviewEvent({
          businessId,
          requestId: row.id,
          contactId: contact.id,
          type: isInitial ? 'request_sent' : 'followup_sent',
          channel: useSms ? 'sms' : 'email',
        });
        if (isInitial) {
          await fireReviewWebhooks(businessId, 'request.sent', { contact: contact.name, channel: useSms ? 'sms' : 'email' });
        }
      } catch (err) {
        console.error('[review-engine] row failed:', row.id, (err as Error).message);
        await supabase.from('review_requests').update({
          error: (err as Error).message.slice(0, 500),
          next_send_at: new Date(Date.now() + 3600_000).toISOString(),
        }).eq('id', row.id);
        results.failed++;
      }
    }
  }

  res.status(200).json({ ok: true, processed: rows.length, ...results });
}

function nextMonthStart(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 9, 0, 0));
}
