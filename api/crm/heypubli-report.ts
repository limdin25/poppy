// The HeyPubli funnel report for /admin/crm/reports. Reads BOTH Supabase projects
// (Elsie for conversations, the heypubli project for funnel state) and returns
// aggregates only; the browser never touches the second project's keys. Same
// admin-session auth pattern as heypubli-journey.ts, same phone join.
//
// This is the per-user custom report pattern (Hugo, 07 Aug 2026): the standard
// Reports page (calls, leaderboard) is untouched for everyone else; each customized
// user gets their own tab backed by a route like this one.

import { createClient } from '@supabase/supabase-js';
import { phoneKey } from '../../src/core/heypubli/journey.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req: Request): Promise<Response> {
  // Admin session required, verified against Elsie like every other /api/crm route.
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const elsieAuth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await elsieAuth.auth.getUser(token);
  if (!userData?.user) return json({ error: 'unauthorized' }, 401);
  const elsie = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: me } = await elsie
    .from('profiles')
    .select('workspace_role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (me?.workspace_role !== 'admin') return json({ error: 'admins only' }, 403);

  const hpUrl = process.env.HEYPUBLI_SUPABASE_URL;
  const hpKey = process.env.HEYPUBLI_SERVICE_ROLE_KEY;
  if (!hpUrl || !hpKey) return json({ error: 'heypubli creds not configured' }, 500);
  const heypubli = createClient(hpUrl, hpKey);

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [
    { data: leads },
    { data: hpProfiles },
    { data: replies24 },
    { data: contacts },
    { data: msgs24 },
  ] = await Promise.all([
    heypubli
      .from('signup_leads')
      .select('status, source, engaged_at, whatsapp_opted_out_at, first_seen_at, whatsapp_e164, whatsapp')
      .limit(5000),
    heypubli.from('profiles').select('id, onboarding_complete, created_at, whatsapp').limit(5000),
    heypubli.from('funnel_replies').select('kind, status, created_at').gte('created_at', weekAgo).limit(5000),
    elsie
      .from('wk_contacts')
      .select('id')
      .eq('custom_fields->>product', 'heypubli')
      .limit(5000),
    elsie
      .from('wk_sms_messages')
      .select('direction, status, created_at, contact_id')
      .eq('channel', 'whatsapp')
      .gte('created_at', dayAgo)
      .limit(5000),
  ]);

  const allLeads = leads ?? [];
  const profiles = hpProfiles ?? [];
  const rr = replies24 ?? [];
  const rr24 = rr.filter((r) => r.created_at >= dayAgo);

  // Chat-only people (messaged us, never filled a form) count via the CRM contacts.
  const leadPhones = new Set(
    allLeads.flatMap((l) => [l.whatsapp_e164, l.whatsapp]).filter(Boolean).map((p) => phoneKey(p!)),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    funnel: {
      totalContacts: (contacts ?? []).length,
      formLeads: allLeads.filter((l) => l.source === 'fb_lead_form').length,
      leadsTotal: allLeads.length,
      inConversation: allLeads.filter((l) => l.engaged_at && !l.whatsapp_opted_out_at).length,
      signedUp: profiles.length,
      onboarded: profiles.filter((p) => p.onboarding_complete).length,
      refused: allLeads.filter((l) => l.whatsapp_opted_out_at).length,
      leadPhonesKnown: leadPhones.size,
    },
    last24h: {
      newLeads: allLeads.filter((l) => l.first_seen_at >= dayAgo).length,
      newSignups: profiles.filter((p) => p.created_at >= dayAgo).length,
      inboundMessages: (msgs24 ?? []).filter((m) => m.direction === 'inbound').length,
      outboundMessages: (msgs24 ?? []).filter(
        (m) => m.direction === 'outbound' && m.status !== 'draft',
      ).length,
      autoReplies: rr24.filter((r) => r.kind === 'reply' && r.status === 'sent').length,
      checkIns: rr24.filter((r) => r.kind === 'check_in' && r.status === 'sent').length,
      handovers: rr24.filter((r) => r.kind === 'handover').length,
      refusalsHandled: rr24.filter((r) => r.kind === 'refusal').length,
    },
    week: {
      autoReplies: rr.filter((r) => r.kind === 'reply' && r.status === 'sent').length,
      handovers: rr.filter((r) => r.kind === 'handover').length,
    },
  };

  return json({ ok: true, report });
}
