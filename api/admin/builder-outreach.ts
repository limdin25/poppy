// The approval desk for builder outreach. GET lists the invites for a
// property (or a branch contact); POST presses one: send it, skip it, or
// confirm the builder onto the viewing.
//
// Admin-gated the same way as api/admin/builders. NODE, NOT EDGE: the send
// path talks to Twilio through api/lib/builder-outreach.ts (Buffer, plus two
// synchronous Twilio GETs before spending), and the repo trap from 13 Aug
// applies, so the default export is the Node (req, res) adapter around a web
// handler, same as api/crm/fetch-ballpark.ts.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { sendOutreachRow, confirmBuilder } from '../lib/builder-outreach.js';

export const config = { maxDuration: 60 };

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function requireAdmin(req: Request): Promise<{ email: string; id: string } | Response> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user?.email) return new Response('Unauthorized', { status: 401 });
  const { data: admin } = await sb
    .from('admin_users').select('email').eq('email', user.email).single();
  if (!admin) return new Response('Forbidden', { status: 403 });
  return { email: user.email, id: user.id };
}

async function handleWeb(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const propertyId = url.searchParams.get('property_id') ?? '';
    const contactId = url.searchParams.get('contact_id') ?? '';
    let q = sb
      .from('brrr_builder_outreach')
      .select('id, property_id, builder_id, contact_id, status, blocked_reason, body, sent_at, replied_at, confirmed_at, error, created_at, brrr_builders(name, phone)')
      .order('created_at', { ascending: true });
    if (propertyId) {
      q = q.eq('property_id', propertyId);
    } else if (contactId) {
      // The branch's deal: outreach rows for any of its properties, plus any
      // row whose builder CONTACT is this contact (the inbox thread case).
      const { data: props } = await sb
        .from('brrr_properties').select('id').eq('wk_contact_id', contactId);
      const ids = ((props ?? []) as Array<{ id: string }>).map((p) => p.id);
      if (ids.length) q = q.or(`property_id.in.(${ids.join(',')}),contact_id.eq.${contactId}`);
      else q = q.eq('contact_id', contactId);
    } else {
      return Response.json({ error: 'property_id or contact_id required' }, { status: 400 });
    }
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ rows: data ?? [] });
  }

  if (req.method === 'POST') {
    let body: { action?: string; id?: string };
    try { body = await req.json() as { action?: string; id?: string }; } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const id = (body.id ?? '').trim();
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    if (body.action === 'send') {
      const result = await sendOutreachRow(sb, id);
      if (!result.ok) return Response.json({ error: result.error ?? 'Send refused.' }, { status: 409 });
      await sb.from('admin_audit_log').insert({
        admin_email: admin.email,
        action: 'builder_outreach_send',
        target_type: 'brrr_builder_outreach',
        metadata: { id },
      });
      return Response.json({ ok: true, status: result.status });
    }

    if (body.action === 'skip') {
      const { error } = await sb
        .from('brrr_builder_outreach')
        .update({ status: 'skipped', updated_at: new Date().toISOString() })
        .eq('id', id)
        .in('status', ['draft', 'approved']);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true, status: 'skipped' });
    }

    if (body.action === 'confirm') {
      const result = await confirmBuilder(sb, id, admin.id);
      if (!result.ok) return Response.json({ error: result.error ?? 'Confirm refused.' }, { status: 409 });
      await sb.from('admin_audit_log').insert({
        admin_email: admin.email,
        action: 'builder_outreach_confirm',
        target_type: 'brrr_builder_outreach',
        metadata: { id },
      });
      return Response.json({ ok: true, warning: result.warning ?? null });
    }

    return Response.json({ error: 'action must be send, skip or confirm' }, { status: 400 });
  }

  return new Response('Method not allowed', { status: 405 });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const out = await handleWeb(new Request(`http://internal${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
