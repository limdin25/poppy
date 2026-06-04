import { sendNotification } from '../../src/integrations/resend/client.js';
import { authorizeToolCall } from '../lib/tool-auth.js';

export const config = { runtime: 'edge' };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Mid-call tool: send an email to the caller (or a given address) while the
 * voice call is still live. Wraps the existing Resend client. Returns a
 * `spoken` line the agent can read back to the caller.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const rawBody = await req.json().catch(() => ({})) as Record<string, unknown>;
  const body = (rawBody.args ?? rawBody) as {
    business_id?: string;
    to_email?: string;
    subject?: string;
    body?: string;
  };

  const auth = await authorizeToolCall(req, body);
  if (auth instanceof Response) return auth;

  const toEmail = (body.to_email || '').trim();
  const subject = (body.subject || '').trim() || 'A message from your call';
  const text = (body.body || '').trim();

  if (!toEmail || toEmail.includes('{{') || !EMAIL_RE.test(toEmail)) {
    return new Response(JSON.stringify({
      error: 'invalid email',
      spoken: "That email address doesn't look right — could you spell it out for me?",
    }), { status: 400 });
  }
  if (!text) {
    return new Response(JSON.stringify({
      error: 'body required',
      spoken: 'What would you like me to put in the email?',
    }), { status: 400 });
  }

  try {
    await sendNotification(toEmail, subject, text);
    return new Response(JSON.stringify({
      ok: true,
      spoken: `Done — I've just sent that email to ${toEmail}.`,
    }), { status: 200 });
  } catch (err: any) {
    console.error('[tools/send-email] error:', err);
    return new Response(JSON.stringify({
      error: err.message,
      spoken: "Sorry, I couldn't send that email just now — I'll make sure someone follows up.",
    }), { status: 500 });
  }
}
