import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { extractUnsubscribeUrls } from '../lib/email-utils.js';

export const config = { runtime: 'edge' };

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

async function requireAdmin(req: Request): Promise<{ email: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });
  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
  if (!user?.email) return new Response('Unauthorized', { status: 401 });
  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single();
  if (!admin) return new Response('Forbidden', { status: 403 });
  return { email: admin.email };
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  // Get email channel with auto_unsubscribe enabled
  const { data: channels } = await supabaseAdmin
    .from('channels')
    .select('id, business_id, unipile_account_id, auto_unsubscribe')
    .eq('auto_unsubscribe', true);

  if (!channels?.length) {
    return Response.json({ message: 'No channels with auto_unsubscribe enabled' });
  }

  // Fetch recent emails from Unipile to get HTML bodies
  const results: any[] = [];

  for (const channel of channels) {
    if (!channel.unipile_account_id) continue;

    const emailsRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/emails?account_id=${channel.unipile_account_id}&limit=50`,
      { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
    );
    if (!emailsRes.ok) continue;

    const emailsJson = await emailsRes.json() as { items?: any[] };
    const emails = emailsJson.items ?? [];

    for (const email of emails) {
      const htmlBody = email.body || '';
      if (!htmlBody) continue;

      const unsubUrls = extractUnsubscribeUrls(htmlBody);
      if (unsubUrls.length === 0) continue;

      const fromEmail = (email.from_attendee?.identifier || '').toLowerCase();
      const emailId = email.id || '';

      // Check if this message exists and is spam but not yet unsubscribed
      const { data: msg } = await supabaseAdmin
        .from('messages')
        .select('id, metadata')
        .contains('metadata', { external_id: emailId, is_spam: true })
        .is('metadata->auto_unsubscribed', null)
        .maybeSingle();

      if (!msg) continue;

      // Hit unsubscribe URLs
      const hitResults: Array<{ url: string; status: number | string }> = [];
      for (const url of unsubUrls.slice(0, 3)) {
        try {
          const r = await fetch(url, { method: 'GET', redirect: 'follow' });
          hitResults.push({ url, status: r.status });
        } catch (e: any) {
          hitResults.push({ url, status: e.message || 'error' });
        }
      }

      // Update metadata
      const meta = (msg.metadata as any) || {};
      await supabaseAdmin
        .from('messages')
        .update({
          metadata: { ...meta, auto_unsubscribed: true, unsubscribe_results: hitResults },
        })
        .eq('id', msg.id);

      results.push({
        sender: fromEmail,
        urls_hit: hitResults.length,
        statuses: hitResults.map(r => r.status),
      });
    }
  }

  return Response.json({ backfilled: results.length, results });
}
