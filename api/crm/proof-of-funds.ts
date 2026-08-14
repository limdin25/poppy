// The proof of funds, handed out one short-lived link at a time.
//
// Hugo, 2026-08-14: "find the proof of funds in my downloads and add it to the
// system, so when our brain generates the email the proof of funds is already
// attached and we just confirm everything is okay and send it."
//
// Zest would not put GBP 103,600 to the vendor without it, and it is the single
// blocker on the best-evidenced deal on the board. So it stops being a file on
// a laptop and becomes something the email can carry.
//
// WHY THIS IS A ROUTE AND NOT A URL IN THE UI.
//
// The document is a certified Revolut balance sheet. It carries account
// numbers, sort codes and IBANs for every account the company holds, which is
// exactly the material bank-mandate fraud is built from. So:
//
//   1. It lives in the PRIVATE `proof-of-funds` bucket. Not `crm-attachments`,
//      which is public and whose object URLs are guessable from a filename.
//   2. Nothing in the browser ever holds a durable link to it. This route mints
//      a signed URL that dies in an hour, which is long enough for Hugo to
//      check it and for Resend to fetch it at send time, and no longer.
//   3. Staff only, through the caller's own JWT, so the database decides who
//      may have it rather than this file. Same shape as api/crm/property-outcome.
//
// WHICH file is the current one is a pointer in platform_settings, not a
// hardcoded path, because a proof of funds goes stale: an agent will not accept
// a statement from three months ago, and replacing it must not need a deploy.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BUCKET = 'proof-of-funds';
/** One hour: Hugo reads it, then Resend fetches it when he presses send. */
const TTL_SECONDS = 60 * 60;

interface Pointer {
  path?: string;
  filename?: string;
  dated?: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const caller = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  const { data: row } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'proof_of_funds')
    .maybeSingle();

  let pointer: Pointer = {};
  try {
    pointer = JSON.parse(String(row?.value ?? '{}')) as Pointer;
  } catch {
    pointer = {};
  }

  const path = String(pointer.path ?? '').trim();
  // No document on file is a normal state, not an error: the email still
  // writes and sends, it just goes without the attachment. Saying so plainly
  // beats a 500 that reads as "the email is broken".
  if (!path) {
    return Response.json({ available: false, reason: 'No proof of funds has been uploaded yet.' });
  }

  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);

  if (error || !signed?.signedUrl) {
    return Response.json(
      { available: false, reason: error?.message ?? 'Could not sign the document.' },
      { status: 502 },
    );
  }

  return Response.json({
    available: true,
    url: signed.signedUrl,
    filename: pointer.filename || path,
    dated: pointer.dated ?? null,
    expires_in: TTL_SECONDS,
  });
}
