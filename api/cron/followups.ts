import { createClient } from '@supabase/supabase-js';
import { sendToChat } from '../../src/integrations/unipile/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Sends due scheduled follow-ups. Runs every 5 minutes (vercel.json). Picks up
 * pending rows whose send_at <= now, sends the step's message over WhatsApp via
 * the business's connected Unipile account, records an outbound message so it
 * shows in the inbox, then marks the row sent.
 */
export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const toolSecret = process.env.TOOL_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const headerTool = req.headers.get('x-tool-secret') || '';
  const isAuthed =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (toolSecret && headerTool === toolSecret);
  if (!isAuthed) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const { data: due } = await supabase
    .from('scheduled_followups')
    .select('id, conversation_id, sequence_id, step_index, message')
    .eq('status', 'pending')
    .lte('send_at', nowIso)
    .limit(50);

  if (!due?.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 });
  }

  let sent = 0;
  let failed = 0;

  for (const row of due) {
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id, business_id, contact_id, unipile_chat_id, followups_enabled, contact:contacts(name, phone, whatsapp)')
        .eq('id', row.conversation_id)
        .single();

      if (!conv || conv.followups_enabled === false) {
        await supabase.from('scheduled_followups').update({ status: 'cancelled' }).eq('id', row.id);
        continue;
      }

      // Use the per-chat custom message if one was set when scheduling; else the
      // sequence's step message; else a generic nudge.
      let message = 'Hi {name}, just following up — happy to help whenever you are.';
      if (row.message) {
        message = row.message;
      } else if (row.sequence_id) {
        const { data: seq } = await supabase
          .from('followup_sequences')
          .select('steps')
          .eq('id', row.sequence_id)
          .maybeSingle();
        const steps = (seq?.steps as Array<{ message?: string }> | null) || [];
        if (steps[row.step_index]?.message) message = steps[row.step_index].message as string;
      }

      const contact = (conv.contact as { name?: string; phone?: string; whatsapp?: string } | null) || {};
      const firstName = (contact.name || '').split(' ')[0] || 'there';
      const text = message.replace(/\{\{?name\}?\}/gi, firstName).replace(/\{\{?first_name\}?\}/gi, firstName);

      // The connected WhatsApp account for this business.
      const { data: channel } = await supabase
        .from('channels')
        .select('unipile_account_id')
        .eq('business_id', conv.business_id)
        .eq('type', 'whatsapp')
        .eq('status', 'connected')
        .maybeSingle();

      const recipient = conv.unipile_chat_id || contact.whatsapp || contact.phone;
      if (!channel?.unipile_account_id || !recipient) {
        await supabase.from('scheduled_followups').update({ status: 'cancelled' }).eq('id', row.id);
        failed++;
        continue;
      }

      await sendToChat(channel.unipile_account_id, recipient, text);

      // Record the outbound message so it appears in the inbox thread.
      await supabase.from('messages').insert({
        conversation_id: conv.id,
        direction: 'outbound',
        sender: 'ai',
        content_type: 'text',
        body: text,
        status: 'sent',
      });
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString(), last_message_preview: text })
        .eq('id', conv.id);

      await supabase.from('scheduled_followups').update({ status: 'sent' }).eq('id', row.id);
      sent++;
    } catch (err) {
      console.error('[cron/followups] send failed:', err);
      failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, failed }), { status: 200 });
}
