import { sendSMS } from '../../src/integrations/twilio/client.js';
import { authorizeToolCall } from '../lib/tool-auth.js';
import { getSmsFromNumber } from '../lib/channel-lookup.js';
import { logOutboundMessage } from '../lib/inbox-log.js';

export const config = { runtime: 'edge' };

/**
 * Mid-call tool: send an SMS to the caller (or a given number) while the voice
 * call is still live. Sends from the business's connected voice number.
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
  // UK national format ("07863992555") -> E.164 ("+447863992555") for Twilio.
  if (/^0\d{9,10}$/.test(toPhone)) toPhone = '+44' + toPhone.slice(1);
  // On SIP-trunk lines Retell does NOT resolve {{from_number}}, so the agent
  // can't fill to_phone for the current caller. Fall back to the caller's number
  // that Retell includes in the tool-call `call` object — so texting the caller
  // works automatically without the agent ever asking for the number.
  if (!toPhone) {
    const caller = (rawBody as { call?: { from_number?: string } }).call?.from_number;
    if (caller) toPhone = String(caller).trim();
  }

  if (!toPhone) {
    return new Response(JSON.stringify({
      error: 'to_phone required',
      spoken: 'What number should I text?',
    }), { status: 400 });
  }
  if (!message) {
    return new Response(JSON.stringify({
      error: 'message required',
      spoken: 'What would you like the text to say?',
    }), { status: 400 });
  }

  const fromNumber = await getSmsFromNumber(auth.businessId);
  if (!fromNumber) {
    return new Response(JSON.stringify({
      error: 'No SMS number configured',
      spoken: "I'm not able to send a text from this line right now.",
    }), { status: 409 });
  }

  try {
    const sent = await sendSMS(fromNumber, toPhone, message);
    await logOutboundMessage({
      businessId: auth.businessId,
      channel: 'sms',
      toPhone,
      body: message,
      externalId: sent?.sid ?? null,
      via: 'twilio_sms',
    }).catch((e) => console.error('[tools/send-sms] log failed:', e));
    return new Response(JSON.stringify({
      ok: true,
      spoken: `Done — I've sent that text to ${toPhone}.`,
    }), { status: 200 });
  } catch (err: any) {
    console.error('[tools/send-sms] error:', err);
    return new Response(JSON.stringify({
      error: err.message,
      spoken: "Sorry, I couldn't send that text just now.",
    }), { status: 500 });
  }
}
