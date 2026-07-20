// "Send Test Message" — sends one personalized review request to a phone or
// email the CLIENT owns (never a customer). Runs the exact production
// pipeline: image render, smart/custom copy, opt-out line, click link.
// Node runtime (sharp).

import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { normalizePhone } from '../lib/review-guards.js';
import { composeSmsBody, composeEmail, randomToken, type SendSettings } from '../lib/review-send.js';
import { renderPersonalizedImage } from '../lib/render-review-image.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function requireAuthNode(authHeader: string | undefined): Promise<{ userId: string; businessId: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7));
  if (!user) return null;
  const { data: member } = await supabase
    .from('team_members')
    .select('business_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!member) return null;
  return { userId: user.id, businessId: member.business_id };
}

export default async function handler(
  req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const rawAuth = req.headers['authorization'];
  const auth = await requireAuthNode(Array.isArray(rawAuth) ? rawAuth[0] : rawAuth);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as {
      phone?: string; email?: string; first_name?: string;
    };
    const phone = normalizePhone(body.phone);
    const email = body.email?.trim().toLowerCase() || null;
    if (!phone && !email) {
      res.status(400).json({ error: 'phone or email required' });
      return;
    }
    const firstName = (body.first_name?.trim() || 'Sally').slice(0, 20);

    const [{ data: settings }, { data: biz }, { data: conn }, { data: template }] = await Promise.all([
      supabase.from('review_settings').select('*').eq('business_id', auth.businessId).maybeSingle(),
      supabase.from('businesses').select('name').eq('id', auth.businessId).single(),
      supabase.from('gbp_connections').select('review_url').eq('business_id', auth.businessId).maybeSingle(),
      supabase.from('review_image_templates').select('public_url, name_x, name_y, font_size, font_color, greeting_prefix')
        .eq('business_id', auth.businessId).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!settings) {
      res.status(400).json({ error: 'Review settings missing — finish onboarding first' });
      return;
    }
    const s = settings as SendSettings & { image_enabled: boolean; sms_from_number: string | null };
    const bizName = biz?.name || 'Your Business';
    const token = randomToken();
    const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';
    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    // Test link: goes to the real Google review page if connected, else our site.
    const reviewLink = conn?.review_url ? `${goUrl}/r/test-${token.slice(0, 6)}` : 'https://heyelsie.com';
    const directLink = conn?.review_url || 'https://heyelsie.com';

    let imageUrl: string | null = null;
    if (s.image_enabled) {
      imageUrl = await renderPersonalizedImage({
        template: template ?? null,
        firstName,
        businessId: auth.businessId,
        requestId: `test-${Date.now()}`,
      });
    }

    if (phone) {
      if (!s.sms_from_number) {
        res.status(400).json({ error: 'No sender number assigned yet — your number request is with our team' });
        return;
      }
      // Test messages link straight to Google (no funnel row to track).
      const smsBody = await composeSmsBody({ settings: s, businessName: bizName, firstName, reviewLink: directLink, isFollowup: false });
      const out = await sendSMS(s.sms_from_number, phone, `[TEST] ${smsBody}`, {
        ...(imageUrl && !s.sms_from_number.startsWith('+44') ? { mediaUrl: imageUrl } : {}),
      });
      res.status(200).json({ ok: true, channel: 'sms', sid: out.sid, body: smsBody, imageUrl });
      return;
    }

    const { subject, html } = composeEmail({
      settings: s, businessName: bizName, firstName, reviewLink: directLink,
      imageUrl, unsubscribeUrl: `${appUrl}/api/reviews/unsubscribe?token=test`, isFollowup: false,
    });
    const out = await sendEmail(email!, `[TEST] ${subject}`, html);
    res.status(200).json({ ok: true, channel: 'email', id: out.id, imageUrl });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
