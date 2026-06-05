import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN || '';
const UNIPILE_DSN = process.env.UNIPILE_DSN || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const APP_URL = process.env.APP_URL || 'https://app.heyelsie.com';
// Optional: an address that gets a copy of EVERY disconnect alert across all
// tenants, so the operator is never silently down. Set on Vercel as ALERT_EMAIL.
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';

// How long the emailed reconnect link stays valid. Generous so an owner who
// reads the email hours later can still use it without us re-generating.
const RECONNECT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const PROVIDER_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
};

/** Turn a raw Unipile status into a plain-English reason for the owner. */
function friendlyReason(reason: string, providerLabel: string): string {
  switch ((reason || '').toUpperCase()) {
    case 'CREDENTIALS':
      return `Logged out from ${providerLabel} — please reconnect to keep receiving customer messages.`;
    case 'DISCONNECTED':
    case 'STOPPED':
      return `The ${providerLabel} session went offline — please reconnect to keep receiving customer messages.`;
    case 'CONNECTING':
    case 'SYNC_ERROR':
      return `${providerLabel} couldn't finish syncing — please reconnect to restore the connection.`;
    default:
      return `The ${providerLabel} connection went offline — please reconnect to keep receiving customer messages.`;
  }
}

export interface DisconnectAlertInput {
  channelId: string;
  businessId: string;
  unipileAccountId: string | null;
  /** The channel's config BEFORE this disconnect is written. */
  config: Record<string, any> | null;
  /** Unipile status that triggered the disconnect (e.g. CREDENTIALS). */
  reason: string;
  /** Channel type for the email copy (whatsapp | instagram | ...). */
  channelType?: string;
}

/**
 * Fire a one-time "channel disconnected" alert for a channel that just dropped.
 *
 * Idempotent per disconnect episode: returns a `config` patch that the caller
 * merges into its single channel update. If an alert was already sent for this
 * episode (config.disconnect_alerted_at present) or sending fails, the patch is
 * empty so we retry on the next poll rather than silently suppressing.
 *
 * Reconnects MUST clear `disconnect_alerted_at` (set it to null) so the next
 * drop alerts again — both poll.ts and webhooks/unipile.ts do this.
 */
export async function maybeAlertChannelDisconnected(
  input: DisconnectAlertInput,
): Promise<Record<string, any>> {
  const { channelId, businessId, unipileAccountId, config, reason, channelType } = input;

  // Already alerted for this episode — nothing to do.
  if (config?.disconnect_alerted_at) return {};
  if (!RESEND_API_KEY) return {};
  if (!unipileAccountId) return {};

  try {
    const recipients = await collectRecipients(businessId);
    if (recipients.length === 0) return {};

    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    const label = PROVIDER_LABEL[channelType || 'whatsapp'] || 'channel';
    const link = await generateReconnectLink(unipileAccountId);
    if (!link) return {};

    const sent = await sendDisconnectEmail({
      recipients,
      businessName: business?.name || 'your business',
      providerLabel: label,
      reason: friendlyReason(reason, label),
      reconnectUrl: link,
    });
    if (!sent) return {};

    console.log(`[channel-alerts] disconnect alert sent for channel ${channelId} (${reason}) to ${recipients.length} recipient(s)`);
    return { disconnect_alerted_at: new Date().toISOString() };
  } catch (err: any) {
    console.error(`[channel-alerts] failed for channel ${channelId}:`, err?.message || err);
    return {};
  }
}

/** Owner email + configured email destinations + optional global ALERT_EMAIL, deduped. */
async function collectRecipients(businessId: string): Promise<string[]> {
  const emails = new Set<string>();

  const { data: business } = await supabase
    .from('businesses')
    .select('owner_id')
    .eq('id', businessId)
    .single();

  if (business?.owner_id) {
    const { data: profile } = await supabase.auth.admin.getUserById(business.owner_id);
    const ownerEmail = profile?.user?.email;
    if (ownerEmail) emails.add(ownerEmail.toLowerCase());
  }

  const { data: dests } = await supabase
    .from('notification_destinations')
    .select('type, destination, enabled')
    .eq('business_id', businessId)
    .eq('enabled', true);
  for (const d of dests || []) {
    if (d.type === 'email' && d.destination) emails.add(d.destination.trim().toLowerCase());
  }

  if (ALERT_EMAIL) emails.add(ALERT_EMAIL.toLowerCase());

  return Array.from(emails);
}

/** Generate a fresh Unipile hosted reconnect link for an existing account. */
export async function generateReconnectLink(accountId: string): Promise<string | null> {
  if (!UNIPILE_TOKEN || !UNIPILE_DSN) return null;
  const expiresOn = new Date(Date.now() + RECONNECT_LINK_TTL_MS).toISOString();

  const res = await fetch(`https://${UNIPILE_DSN}/api/v1/hosted/accounts/link`, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNIPILE_TOKEN,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      type: 'reconnect',
      reconnect_account: accountId,
      api_url: `https://${UNIPILE_DSN}`,
      expiresOn,
      success_redirect_url: `${APP_URL}/connections?unipile=connected`,
      failure_redirect_url: `${APP_URL}/connections?unipile=failed`,
      notify_url: `${APP_URL}/api/webhooks/unipile`,
    }),
  });

  if (!res.ok) {
    console.error(`[channel-alerts] reconnect link failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}

async function sendDisconnectEmail(opts: {
  recipients: string[];
  businessName: string;
  providerLabel: string;
  reason: string;
  reconnectUrl: string;
}): Promise<boolean> {
  const { recipients, businessName, providerLabel, reason, reconnectUrl } = opts;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e;">
      <h2 style="font-size:19px;margin:0 0 16px;">Action required — your ${providerLabel} disconnected</h2>
      <p style="font-size:15px;line-height:1.5;margin:0 0 14px;">Hi ${businessName},</p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 14px;">Your ${providerLabel} connection went offline. <strong>Reason:</strong> ${reason} <strong>Customer messages aren't being answered until you reconnect.</strong></p>
      <p style="margin:24px 0;">
        <a href="${reconnectUrl}" style="background:#dc2626;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;font-size:15px;">Reconnect now</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#666;margin:0 0 6px;">Most reconnects take under a minute — open the link on the phone with this ${providerLabel} number and scan the QR. This link is valid for 24 hours.</p>
      <p style="font-size:13px;line-height:1.5;color:#666;margin:0 0 20px;">If the issue persists, reply to this email and we'll look into it.</p>
      <p style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:14px;margin:0;">Elsie — AI Receptionist for ${businessName}</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Elsie <notifications@heyelsie.com>',
        to: recipients,
        subject: `Action required — your ${providerLabel} disconnected`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`[channel-alerts] resend failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[channel-alerts] resend error:', err?.message || err);
    return false;
  }
}
