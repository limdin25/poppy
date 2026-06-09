import { createClient } from '@supabase/supabase-js';
import { sendThreadReply } from '../../src/integrations/resend/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * True when this conversation's email thread arrived via the Resend inbound
 * webhook (send-as domain like heypubli.com) rather than a Unipile mailbox.
 */
export async function isResendThread(conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .contains('metadata', { via: 'resend_inbound' })
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Reply to the latest inbound email of a Resend-routed thread. Sends FROM the
 * alias the other side originally wrote to (so the thread stays intact) and
 * keeps In-Reply-To threading headers.
 */
export async function sendResendEmailReply(
  conversationId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: trigger } = await supabase
    .from('messages')
    .select('metadata')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .contains('metadata', { via: 'resend_inbound' })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta = (trigger?.metadata as Record<string, unknown>) || {};
  const to = (meta.sender_email as string) || '';
  if (!to) return { ok: false, error: 'no sender email on thread' };

  const rawSubject = ((meta.subject as string) || '').trim();
  const subject = rawSubject
    ? (/^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`)
    : 'Re: Your message';

  // Reply from the exact address the business emailed (the recipient on our
  // send-as domain); fall back to elsie@<channel domain>.
  const { data: conv } = await supabase
    .from('conversations')
    .select('business_id')
    .eq('id', conversationId)
    .single();
  if (!conv) return { ok: false, error: 'conversation not found' };
  const { data: ch } = await supabase
    .from('channels')
    .select('config')
    .eq('business_id', conv.business_id)
    .eq('status', 'connected')
    .contains('config', { provider: 'resend' })
    .limit(1)
    .maybeSingle();
  const domain = (ch?.config as Record<string, unknown> | null)?.domain as string | undefined;

  const attendees = (meta.to_attendees as string[] | undefined) || [];
  const fromAddr =
    (domain && attendees.find((a) => a.toLowerCase().endsWith(`@${domain.toLowerCase()}`))) ||
    (domain ? `elsie@${domain}` : attendees.find((a) => a.includes('@')));
  if (!fromAddr) return { ok: false, error: 'no send-as address for thread' };

  try {
    await sendThreadReply({
      to,
      from: `Elsie <${fromAddr}>`,
      subject,
      text: body,
      inReplyTo: (meta.message_id as string) || null,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'send failed' };
  }
}
