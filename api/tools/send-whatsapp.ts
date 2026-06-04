import { sendToChat } from '../../src/integrations/unipile/client.js';
import { authorizeToolCall } from '../lib/tool-auth.js';
import { getWhatsAppAccountId } from '../lib/channel-lookup.js';
import { logOutboundMessage } from '../lib/inbox-log.js';

export const config = { runtime: 'edge' };

/**
 * Mid-call tool: send a WhatsApp message to the caller (or a given number)
 * while the voice call is still live. Sends from the business's connected
 * WhatsApp (Unipile) account.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const rawBody = await req.json().catch(() => ({})) as Record<string, unknown>;
  const body = (rawBody.args ?? rawBody) as {
    business_id?: string;
    to_phone?: string;
    message?: string;
  };

  const auth = await authorizeToolCall(req, body);
  if (auth instanceof Response) return auth;

  const message = (body.message || '').trim();
  let toPhone = (body.to_phone || '').trim();
  if (toPhone.includes('{{')) toPhone = '';

  if (!toPhone) {
    return new Response(JSON.stringify({
      error: 'to_phone required',
      spoken: 'What number should I message on WhatsApp?',
    }), { status: 400 });
  }
  if (!message) {
    return new Response(JSON.stringify({
      error: 'message required',
      spoken: 'What would you like the WhatsApp message to say?',
    }), { status: 400 });
  }

  const accountId = await getWhatsAppAccountId(auth.businessId);
  if (!accountId) {
    return new Response(JSON.stringify({
      error: 'No WhatsApp account connected',
      spoken: "WhatsApp isn't connected for this business, so I can't send that — would email or a text work instead?",
    }), { status: 409 });
  }

  try {
    const sent = await sendToChat(accountId, toPhone, message);
    await logOutboundMessage({
      businessId: auth.businessId,
      channel: 'whatsapp',
      toPhone,
      body: message,
      externalId: (sent as { id?: string })?.id ?? null,
      via: 'unipile',
    }).catch((e) => console.error('[tools/send-whatsapp] log failed:', e));
    return new Response(JSON.stringify({
      ok: true,
      spoken: `Done — I've sent that on WhatsApp to ${toPhone}.`,
    }), { status: 200 });
  } catch (err: any) {
    console.error('[tools/send-whatsapp] error:', err);
    return new Response(JSON.stringify({
      error: err.message,
      spoken: "Sorry, I couldn't send that WhatsApp message just now.",
    }), { status: 500 });
  }
}
