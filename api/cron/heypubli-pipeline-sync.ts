// Moves every HeyPubli contact to the right column of the "HeyPubli Creators"
// pipeline, every run, from live funnel state. Nobody drags these cards by hand:
// the funnel (a DIFFERENT Supabase project, see api/crm/heypubli-journey.ts) knows
// where each person truly is, and this cron makes the board agree.
//
// Scoped hard: only contacts stamped custom_fields.product = 'heypubli' are ever
// touched, so the plumber CRM and every other user's pipelines are unaffected.
// This is the per-user CRM customization pattern (Hugo, 07 Aug 2026): the standard
// pipeline stays as-is; each new user gets their own pipeline plus a sync like this.
//
// Stage rules, first match wins:
//   Not interested   opted out / refused / do-not-call
//   Onboarded        heypubli profile with onboarding_complete
//   Signed up        heypubli profile exists
//   In conversation  they have written to us (engaged_at, or a chat-only contact)
//   Messaged         we have messaged them (contacted_at)
//   New lead         a form lead nothing has happened to yet

import { createClient } from '@supabase/supabase-js';
import { phoneKey } from '../../src/core/heypubli/journey.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PIPELINE_NAME = 'HeyPubli Creators';

export default async function handler(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const elsie = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const hpUrl = process.env.HEYPUBLI_SUPABASE_URL;
  const hpKey = process.env.HEYPUBLI_SERVICE_ROLE_KEY;
  if (!hpUrl || !hpKey) return json({ error: 'heypubli creds not configured' }, 500);
  const heypubli = createClient(hpUrl, hpKey);

  // The board's columns, by name. Created 07 Aug 2026; if someone renames a column
  // in the UI this sync must fail loudly rather than move cards to the wrong place.
  const { data: pipeline } = await elsie
    .from('wk_pipelines')
    .select('id')
    .eq('name', PIPELINE_NAME)
    .maybeSingle();
  if (!pipeline) return json({ error: `pipeline "${PIPELINE_NAME}" not found` }, 500);
  const { data: cols } = await elsie
    .from('wk_pipeline_columns')
    .select('id, name')
    .eq('pipeline_id', pipeline.id);
  const colByName = new Map((cols ?? []).map((c) => [c.name, c.id]));
  for (const need of ['New lead', 'Messaged', 'In conversation', 'Signed up', 'Onboarded', 'Not interested']) {
    if (!colByName.has(need)) return json({ error: `column "${need}" missing` }, 500);
  }

  // Who moves the cards: the HeyPubli agent identity, so the audit trail reads
  // honestly in the UI.
  const { data: mover } = await elsie
    .from('profiles')
    .select('id')
    .eq('email', 'hello@heypubli.com')
    .maybeSingle();

  // Everything the funnel knows, keyed by phone digits.
  const [{ data: leads }, { data: hpProfiles }, { data: contacts }, { data: stopTags }] = await Promise.all([
    heypubli
      .from('signup_leads')
      .select('whatsapp, whatsapp_e164, status, engaged_at, contacted_at, whatsapp_opted_out_at, profile_id, nurture_state')
      .limit(5000),
    heypubli.from('profiles').select('id, whatsapp, onboarding_complete, suspended_at').limit(5000),
    elsie
      .from('wk_contacts')
      .select('id, phone, pipeline_column_id, do_not_call, custom_fields')
      .eq('custom_fields->>product', 'heypubli')
      .limit(5000),
    // Chat-only refusers have no funnel lead row; their "no" lives as a CRM tag
    // (wk-sms-incoming writes not-interested, a STOP writes do-not-text). Without
    // this read they show as live prospects on the board.
    elsie
      .from('wk_contact_tags')
      .select('contact_id, tag')
      .in('tag', ['not-interested', 'do-not-text'])
      .limit(5000),
  ]);
  const refusedContactIds = new Set((stopTags ?? []).map((t) => t.contact_id));

  const leadByPhone = new Map<string, NonNullable<typeof leads>[number]>();
  for (const l of leads ?? []) {
    for (const p of [l.whatsapp_e164, l.whatsapp]) {
      const key = p ? phoneKey(p) : '';
      if (key && !leadByPhone.has(key)) leadByPhone.set(key, l);
    }
  }
  const profileByPhone = new Map<string, NonNullable<typeof hpProfiles>[number]>();
  const profileById = new Map((hpProfiles ?? []).map((p) => [p.id, p]));
  for (const p of hpProfiles ?? []) {
    const key = p.whatsapp ? phoneKey(p.whatsapp) : '';
    if (key && !profileByPhone.has(key)) profileByPhone.set(key, p);
  }

  const report = { contacts: (contacts ?? []).length, moved: 0, unchanged: 0, errors: 0 };
  const nowIso = new Date().toISOString();

  for (const c of contacts ?? []) {
    const key = phoneKey(c.phone ?? '');
    const lead = leadByPhone.get(key) ?? null;
    const profile =
      (lead?.profile_id ? profileById.get(lead.profile_id) : null) ?? profileByPhone.get(key) ?? null;

    let target: string;
    // "If it's no more follow-up... that has to reflect on the pipelines"
    // (Hugo, 07 Aug 2026). A lead whose ladder is refused ('blocked') or spent
    // with no reply ('exhausted') is lost, and the board must say so. nurture
    // 'stopped' is NOT here on purpose: it usually means "in live
    // conversation", which is the opposite of lost.
    const ladderDead =
      !lead?.profile_id &&
      (lead?.nurture_state === 'blocked' || lead?.nurture_state === 'exhausted');
    if (c.do_not_call || refusedContactIds.has(c.id) || lead?.whatsapp_opted_out_at || ladderDead)
      target = colByName.get('Not interested')!;
    else if (profile?.onboarding_complete) target = colByName.get('Onboarded')!;
    else if (profile) target = colByName.get('Signed up')!;
    else if (lead?.engaged_at || !lead) target = colByName.get('In conversation')!;
    else if (lead.contacted_at) target = colByName.get('Messaged')!;
    else target = colByName.get('New lead')!;

    if (c.pipeline_column_id === target) {
      report.unchanged++;
      continue;
    }
    const { error } = await elsie
      .from('wk_contacts')
      .update({
        pipeline_column_id: target,
        stage_moved_at: nowIso,
        stage_moved_from: c.pipeline_column_id,
        stage_moved_by: mover?.id ?? null,
        stage_move_source: 'heypubli_sync',
      })
      .eq('id', c.id);
    if (error) report.errors++;
    else report.moved++;
  }

  return json({ ok: true, ...report });
}
