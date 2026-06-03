import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

interface Row { name?: string; phone?: string; email?: string }

function normPhone(p?: string): string | null {
  if (!p) return null;
  const t = p.replace(/[^\d+]/g, '');
  return t.replace(/\D/g, '').length >= 6 ? t : null;
}
function normEmail(e?: string): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(t) ? t : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  let body: { rows?: Row[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: 'No rows to import' }), { status: 400 });
  }

  // Build upsert payloads. Omit name/email when blank so we never clobber an
  // existing contact's data, and never set lead_status (preserve hot/warm/cold).
  const phoneRows: Record<string, unknown>[] = [];
  const emailRows: Record<string, unknown>[] = [];
  let skipped = 0;
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();

  for (const r of rows) {
    const phone = normPhone(r.phone);
    const email = normEmail(r.email);
    const name = (r.name || '').trim();
    if (!phone && !email) { skipped++; continue; }

    if (phone) {
      if (seenPhone.has(phone)) { skipped++; continue; } // de-dupe within the file
      seenPhone.add(phone);
      const row: Record<string, unknown> = { business_id: businessId, phone, whatsapp: phone };
      if (name) row.name = name;
      if (email) row.email = email;
      phoneRows.push(row);
    } else if (email) {
      if (seenEmail.has(email)) { skipped++; continue; }
      seenEmail.add(email);
      const row: Record<string, unknown> = { business_id: businessId, email };
      if (name) row.name = name;
      emailRows.push(row);
    }
  }

  let imported = 0;
  if (phoneRows.length) {
    const { data, error } = await supabase
      .from('contacts')
      .upsert(phoneRows, { onConflict: 'business_id,phone' })
      .select('id');
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    imported += data?.length ?? 0;
  }
  if (emailRows.length) {
    const { data, error } = await supabase
      .from('contacts')
      .upsert(emailRows, { onConflict: 'business_id,email' })
      .select('id');
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    imported += data?.length ?? 0;
  }

  return new Response(JSON.stringify({ ok: true, imported, skipped }), { status: 200 });
}
