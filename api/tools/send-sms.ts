import { sendSMS } from '../../src/integrations/twilio/client.js';
import { authorizeToolCall } from '../lib/tool-auth.js';
import { getSmsFromNumber } from '../lib/channel-lookup.js';

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
    await sendSMS(fromNumber, toPhone, message);
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
