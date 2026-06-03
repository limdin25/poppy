import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Store an uploaded knowledge document. Text is extracted on the client (txt/md/
 * csv/json natively, PDF via pdfjs, DOCX via mammoth) and posted here as plain
 * text — same retrieval path as website/notes (no separate vector store).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  let body: { name?: string; text?: string; agent_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const name = (body.name || 'Uploaded document').trim().slice(0, 200);
  const text = (body.text || '').trim();
  if (!text) {
    return new Response(JSON.stringify({ error: 'No readable text was found in that file.' }), { status: 400 });
  }

  const { data: source, error } = await supabase
    .from('knowledge_sources')
    .insert({
      business_id: businessId,
      agent_id: body.agent_id || null,
      name,
      type: 'document',
      url: null,
      status: 'synced',
      content: text.slice(0, 5000),
      summary: text.slice(0, 3000),
    })
    .select('id')
    .single();

  if (error || !source) {
    return new Response(JSON.stringify({ error: error?.message || 'Failed to store document' }), { status: 500 });
  }

  return new Response(JSON.stringify({ id: source.id, status: 'synced' }), { status: 200 });
}
