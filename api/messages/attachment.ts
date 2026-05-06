import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(req.url);
    const emailId = url.searchParams.get('emailId');
    const attachmentId = url.searchParams.get('attachmentId');
    const accountId = url.searchParams.get('accountId');

    if (!emailId || !attachmentId) {
      return new Response(
        JSON.stringify({ error: 'emailId and attachmentId are required' }),
        { status: 400 },
      );
    }

    let fetchUrl = `https://${UNIPILE_DSN}/api/v1/emails/${emailId}/attachments/${attachmentId}`;
    if (accountId) {
      fetchUrl += `?account_id=${accountId}`;
    }

    const uRes = await fetch(fetchUrl, {
      headers: {
        'X-API-KEY': UNIPILE_TOKEN,
        accept: '*/*',
      },
    });

    if (!uRes.ok) {
      return new Response(
        JSON.stringify({ error: `Attachment fetch failed: ${uRes.status}` }),
        { status: uRes.status },
      );
    }

    const contentType = uRes.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = uRes.headers.get('content-disposition') || '';
    const body = await uRes.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentDisposition ? { 'Content-Disposition': contentDisposition } : {}),
      },
    });
  } catch (err: any) {
    console.error('[messages/attachment] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
