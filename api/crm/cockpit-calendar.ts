// What has to happen, and when. Across every deal, not one at a time.
//
// Hugo, 2026-08-16: "under the deal I think you should have a tab, and then we
// click the tab we can see the calendar, and this calendar you can see all the
// follow-ups and everything that has to be done in the future, so we know when
// we have to follow up."
//
// Three things land on it, and they are the three things in this business that
// have a time attached:
//
//   the follow-ups somebody promised on a call   wk_contact_followups
//   the builder viewings that are booked         brrr_properties.viewing_at
//   the call backs a branch asked for            the same follow-up rows
//
// Overdue is not hidden. A follow-up that has already gone past is the single
// most useful thing on a calendar, and burying it under "today" is how it stays
// missed. It sorts first, marked.
//
// GET /api/crm/cockpit-calendar          -> the next 30 days plus everything overdue
// GET /api/crm/cockpit-calendar?days=90

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface CalendarItem {
  id: string;
  kind: 'followup' | 'viewing';
  at: string;
  overdue: boolean;
  title: string;
  note: string | null;
  contactId: string | null;
  contactName: string | null;
  propertyId: string | null;
  address: string | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  const now = new Date();
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 30)));
  const until = new Date(now.getTime() + days * 86_400_000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: fups }, { data: viewings }] = await Promise.all([
    sb.from('wk_contact_followups')
      .select('id, contact_id, due_at, note, status')
      .in('status', ['pending', 'snoozed'])
      .lte('due_at', until)
      .order('due_at', { ascending: true })
      .limit(300),
    sb.from('brrr_properties')
      .select('id, address, viewing_at, wk_contact_id, assigned_builder_id')
      .not('viewing_at', 'is', null)
      .lte('viewing_at', until)
      .order('viewing_at', { ascending: true })
      .limit(300),
  ]);

  const followups = (fups ?? []) as Array<{
    id: string; contact_id: string; due_at: string; note: string | null;
  }>;
  const views = (viewings ?? []) as Array<{
    id: string; address: string | null; viewing_at: string; wk_contact_id: string | null;
  }>;

  // One read for the names and the houses these hang off, rather than one per
  // row. A calendar of thirty items should not be thirty round trips.
  const contactIds = [...new Set([
    ...followups.map((f) => f.contact_id),
    ...views.map((v) => v.wk_contact_id).filter(Boolean) as string[],
  ])];

  const nameById = new Map<string, string>();
  const propertyByContact = new Map<string, { id: string; address: string | null }>();
  if (contactIds.length) {
    const [{ data: contacts }, { data: props }] = await Promise.all([
      sb.from('wk_contacts').select('id, name').in('id', contactIds),
      sb.from('brrr_properties')
        .select('id, address, wk_contact_id')
        .in('wk_contact_id', contactIds)
        .not('status', 'in', '("auditor_killed","not_qualified")')
        .limit(400),
    ]);
    for (const c of (contacts ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(c.id, c.name);
    }
    for (const p of (props ?? []) as Array<{ id: string; address: string | null; wk_contact_id: string }>) {
      if (!propertyByContact.has(p.wk_contact_id)) {
        propertyByContact.set(p.wk_contact_id, { id: p.id, address: p.address });
      }
    }
  }

  const items: CalendarItem[] = [];

  for (const f of followups) {
    const house = propertyByContact.get(f.contact_id) ?? null;
    items.push({
      id: `followup-${f.id}`,
      kind: 'followup',
      at: f.due_at,
      overdue: Date.parse(f.due_at) < now.getTime(),
      title: nameById.get(f.contact_id) ?? 'A branch',
      note: f.note,
      contactId: f.contact_id,
      contactName: nameById.get(f.contact_id) ?? null,
      propertyId: house?.id ?? null,
      address: house?.address ?? null,
    });
  }

  for (const v of views) {
    items.push({
      id: `viewing-${v.id}`,
      kind: 'viewing',
      at: v.viewing_at,
      overdue: Date.parse(v.viewing_at) < now.getTime(),
      title: 'Builder viewing',
      note: null,
      contactId: v.wk_contact_id,
      contactName: v.wk_contact_id ? nameById.get(v.wk_contact_id) ?? null : null,
      propertyId: v.id,
      address: v.address,
    });
  }

  // Overdue first, then soonest. Something already missed is the most useful
  // thing on the page, and sorting it purely by time buries it in the past.
  items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return Date.parse(a.at) - Date.parse(b.at);
  });

  return Response.json({
    generatedAt: now.toISOString(),
    days,
    overdue: items.filter((i) => i.overdue).length,
    items,
  });
}
