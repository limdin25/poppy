// Hugo or Pedro just messaged the builders line. This is what happens next.
//
// It is the second half of the 24 hour dance. The machine sent a Meta-approved
// opener saying it has a query; their reply, whatever it says, opens the window
// and this route pushes the real question through within seconds. Their NEXT
// message is the answer, and it goes straight back into the deal: a house
// number onto the property, or their words to the builder who was waiting.
//
// CALLED FROM wk-sms-incoming, the same shape as the site-demo hook. A Deno
// edge function cannot import api/lib, and everything here (the query
// lifecycle, the window rules) is shared, tested TypeScript. So the edge
// function recognises an ops number, calls this, and gets back one boolean that
// decides the only thing it needs to know: whether to leave the message alone.
//
// AND LEAVING IT ALONE IS THE WHOLE POINT. Hugo's number in the CRM must not be
// stamped with a product, must not be answered by the sales AI, must not join a
// campaign and must never be counted as a lead. `ops: true` in the response is
// that instruction.

import { createClient } from '@supabase/supabase-js';
import {
  loadOpsContacts, matchOpsContact, sendablePhone,
} from '../lib/ops-contacts.js';
import { openWindowFor, pendingQueryFor, answerQuery } from '../lib/ops-query.js';

export const config = { maxDuration: 30 };

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleOpsReply(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const jobsKey = process.env.CRM_JOBS_KEY || '';
  if (bearer !== process.env.SUPABASE_SERVICE_ROLE_KEY && (!jobsKey || bearer !== jobsKey)) {
    return json(401, { error: 'Unauthorized' });
  }

  let payload: { phone?: string; body?: string; contact_id?: string };
  try { payload = await req.json() as typeof payload; }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const phone = sendablePhone(payload.phone ?? '');
  const said = String(payload.body ?? '').trim();
  if (!phone) return json(200, { ops: false });

  const ops = await loadOpsContacts(sb);
  const who = matchOpsContact(ops, phone);
  if (!who) return json(200, { ops: false });

  // 1. Is this the answer to something we already asked them in full?
  //
  //    Checked BEFORE the window push, because the two are different messages
  //    in the same conversation and the order is fixed: the template goes out,
  //    they reply (window opens, question sent), they reply again (the answer).
  //    A query still sitting behind an unanswered template cannot be what this
  //    message is answering, and pendingQueryFor only ever returns delivered
  //    ones for exactly that reason.
  let answered: string | null = null;
  if (said) {
    const pending = await pendingQueryFor(sb, phone);
    if (pending) {
      await answerQuery(sb, pending.id, said, phone);
      answered = pending.kind;
    }
  }

  // 2. Anything waiting on the window they just opened goes now.
  const pushed = await openWindowFor(sb, phone);

  return json(200, {
    ops: true,
    who: who.name,
    answered,
    delivered: pushed.sent,
    errors: pushed.errors,
  });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    return await handleOpsReply(req);
  } catch (e) {
    // NEVER 500 to the caller: wk-sms-incoming treats a failure here as "not an
    // ops number", which would hand Hugo's message to the sales AI. A 200 with
    // ops:true is the safe shape even when the work inside failed.
    console.error('[ops-reply] threw', e);
    return json(200, { ops: true, error: String(e).slice(0, 200) });
  }
}
