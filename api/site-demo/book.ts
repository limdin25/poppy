// "Book an expert" on a demo site.
//
// PRE-SALE THIS IS A LEAD SIGNAL, NOT A BOOKING.
// The site belongs to a plumber who has not bought anything yet, and the
// number on it is our shared demo line. So a submission here is not a customer
// booking a job, it is the owner (or somebody he forwarded it to) trying the
// thing out. It is recorded as a site event and it notifies, exactly like a
// chat message or an inbound call, and it does NOT create a job anywhere.
//
// Edge runtime, so no node:crypto. The HMAC is re-derived with crypto.subtle,
// the same way track.ts and chat.ts do it.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function hourBucket(now = Date.now()): number {
  return Math.floor(now / 3_600_000);
}

async function expected(pageId: string, bucket: number): Promise<string> {
  const secret = process.env.SITE_BEACON_SECRET || '';
  if (!secret) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${pageId}:${bucket}`));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Accepts the current hour's token and the previous hour's, so a form filled
 * in slowly across an hour boundary is not thrown away. Fails OPEN when no
 * secret is configured, matching every other beacon route: a missing env var
 * must not silently break a live sales page.
 */
async function tokenOk(pageId: string, token: string): Promise<boolean> {
  const secret = process.env.SITE_BEACON_SECRET || '';
  if (!secret) return true;
  const now = hourBucket();
  for (const b of [now, now - 1]) {
    const want = await expected(pageId, b);
    if (want && token === want) return true;
  }
  return false;
}

/** Strips control characters, collapses whitespace, caps the length. */
function clean(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const pageId = clean(body.page_id, 64);
  if (!pageId) return json({ error: 'Bad request' }, 400);
  if (!(await tokenOk(pageId, clean(body.token, 64)))) return json({ error: 'Bad token' }, 403);

  const name = clean(body.name, 80);
  const phone = clean(body.phone, 30);
  if (!name || !phone) return json({ error: 'Name and phone are required' }, 400);

  const meta = {
    name,
    phone,
    job: clean(body.job, 80) || undefined,
    area: clean(body.area, 60) || undefined,
    note: clean(body.note, 1000) || undefined,
  };

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  };

  // Always read the insert result. A type missing from the CHECK constraint
  // fails with 23514, and on the VSL side exactly that went unnoticed for weeks
  // because nobody looked.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/wk_site_events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ page_id: pageId, type: 'booking', meta }),
  });
  if (!res.ok) {
    console.error('[site-demo/book] insert failed', res.status, await res.text());
    return json({ error: 'Could not save that' }, 500);
  }

  // A booking is engagement, the same as a chat message: somebody typed their
  // real number into the page. Forward-only, so a lead already further along
  // cannot be dragged backwards by it.
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/wk_site_advance`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_page_id: pageId,
      p_target: 'engaged',
      p_bump_open: false,
      p_link_click: false,
      p_phone_tap: false,
      p_chat: true,
      p_call: false,
      p_nudge: false,
      p_outbound_call: false,
    }),
  }).catch((e) => console.error('[site-demo/book] advance failed', e));

  return json({ ok: true });
}
