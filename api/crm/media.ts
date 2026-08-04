import { createClient } from '@supabase/supabase-js';
import { TWILIO_MEDIA_HOST } from '../lib/twilio-media.js';

export const config = { runtime: 'edge' };

// Serve media a LEAD sent us, from the CRM inbox.
//
// Hugo 2026-08-03: a HeyPubli lead was asked for their Instagram handle and
// replied with a screenshot. The inbox drew an empty bubble. Two separate
// causes, both fixed here and in useContactMessages:
//   1. wk-sms-incoming has always stored the media on wk_sms_messages.media_urls
//      and nothing had ever read that column.
//   2. Twilio media URLs answer 401 without the account credentials, so even
//      once read they cannot go in an <img src>. Measured, not assumed: an
//      unauthenticated GET of the stored URL returns 401 application/xml.
//
// So the browser asks us and we do the fetching, holding the credentials
// server-side where they belong.
//
// Why not copy the bytes into Supabase Storage on receipt, like the product
// inbox does for Unipile: that fixes nothing already received (Danny's
// screenshot included), and this project has already taken an outage from a
// storage bucket running over quota. A proxy has no standing cost and works
// backwards over every message ever received.

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Twilio and nothing else. media_urls holds a URL that arrived on a webhook, so
// treating it as a fetchable address makes this route an SSRF hole unless the
// host is pinned: a forged webhook could otherwise name an internal address and
// have us fetch it with our own credentials attached.
//
// The constant is shared with api/lib/twilio-media.ts, which the AI reply route
// uses to show the same picture to the model. One definition, so relaxing it in
// one place cannot quietly leave the other pinned.
const ALLOWED_HOST = TWILIO_MEDIA_HOST;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  // The viewer must be a signed-in CRM user. An <img> tag cannot carry a header,
  // so the inbox fetches this with the session token and renders a blob. That is
  // deliberate: a token in a query string ends up in access logs and browser
  // history, and this route hands back a lead's private messages.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Unauthorized' });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: 'Unauthorized' });

  const url = new URL(req.url);
  const messageId = (url.searchParams.get('message') || '').trim();
  const index = Number(url.searchParams.get('i') || '0');
  if (!messageId) return json(400, { error: 'message required' });
  if (!Number.isInteger(index) || index < 0) return json(400, { error: 'bad index' });

  const { data: row, error: rowErr } = await supabase
    .from('wk_sms_messages')
    .select('media_urls')
    .eq('id', messageId)
    .maybeSingle();
  if (rowErr) return json(500, { error: 'lookup_failed', detail: rowErr.message });
  if (!row) return json(404, { error: 'not found' });

  const media = (row.media_urls as string[] | null) ?? [];
  const target = media[index];
  if (!target) return json(404, { error: 'no media at that index' });

  let parsed: URL;
  try { parsed = new URL(target); } catch { return json(400, { error: 'bad media url' }); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) {
    return json(400, { error: 'refused host' });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  if (!sid || !authToken) return json(500, { error: 'twilio credentials missing' });

  // Twilio 307s the media request to a signed S3 URL. Following that redirect
  // with our Authorization header still attached would leak the account
  // credentials to a third-party host, so the hop is taken by hand and the
  // header is dropped on the second request.
  const first = await fetch(parsed.toString(), {
    redirect: 'manual',
    headers: { Authorization: `Basic ${btoa(`${sid}:${authToken}`)}` },
  });
  let upstream = first;
  const location = first.headers.get('location');
  if (first.status >= 300 && first.status < 400 && location) {
    upstream = await fetch(location);
  }
  if (!upstream.ok) {
    return json(upstream.status === 404 ? 404 : 502, { error: 'twilio_fetch_failed', status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      // Private: this is one lead's message, not a public asset. Cached in the
      // viewer's browser only, so scrolling the thread does not re-hit Twilio.
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
