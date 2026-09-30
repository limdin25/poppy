import { createClient } from '@supabase/supabase-js';
import { HOSTUNICO_CAMPAIGN, HOSTUNICO_PIPELINE, REPORT_AHEAD, reportProperty, reportSms } from '../lib/hostunico-report.js';
import { hostunicoCountry } from '../../supabase/functions/_shared/hostunico-pricing.js';
import { reportPhone, reportPhoneKind } from '../../supabase/functions/_shared/hostunico-phone.js';

export const config = { runtime: 'edge' };
const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const json = (value: unknown, options?: { status?: number }) => Response.json(value, { ...options, headers: { 'Cache-Control': 'private, no-store' } });
class Problem extends Error { constructor(public status: number, message: string) { super(message); } }
function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Problem(503, 'Could not save or load the report. Please try again.');
  return data;
}
function reportListing(listing: { address: string; photo_urls?: string[]; listing_url?: string; property_type?: string; rent_pcm?: number; source_price?: string; hostunico_call_eligible?: boolean }) {
  return { title: listing.address, photo: listing.photo_urls?.[0], url: listing.listing_url, propertyType: listing.property_type, advertisedRentPcm: listing.rent_pcm, sourcePrice: listing.source_price, wholePropertyVerified: listing.hostunico_call_eligible === true };
}
async function remote(action: string, payload: Record<string, unknown>) {
  const token = process.env.HOSTUNICO_CRM_TOKEN;
  if (!token) throw new Problem(503, 'The Hostunico report connection is not configured.');
  const r = await fetch(`https://hostunico.com/api/hostunico/crm-estimates/${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(18000),
  });
  const value = await r.json() as { error?: string; stage: string; message: string; reportUrl?: string };
  if (!r.ok) throw new Problem(r.status, value.error || 'Hostunico could not prepare this report.');
  return value as { stage: string; message: string; reportUrl?: string };
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (!['GET', 'POST'].includes(req.method)) throw new Problem(405, 'Method not allowed');
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const supa = db();
    const { data: auth } = await supa.auth.getUser(jwt);
    if (!auth.user) throw new Problem(401, 'Please sign in.');
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const allowed = check(await caller.rpc('wk_is_agent_or_admin'));
    if (!allowed) throw new Problem(403, 'CRM access required.');
    const admin = check(await caller.rpc('wk_is_admin'));
    const body = (req.method === 'POST' ? await req.json() : Object.fromEntries(new URL(req.url).searchParams)) as { action?: string; campaign_id?: string; contact_id?: string; listing_id?: string; country?: string; property?: unknown; replace?: boolean; permission?: boolean; mobile?: string; mobile_confirmed?: boolean; mode?: string; offset?: number };
    if (!body || typeof body !== 'object') throw new Problem(400, 'A request object is required.');
    const action = String(body.action || 'status');
    const contact = async (id: string) => {
      const c = check(await supa.from('wk_contacts').select('id,desk,owner_agent_id,do_not_call,phone,hostunico_sms_phone,hostunico_country,custom_fields,pipeline_column_id').eq('id', id).maybeSingle());
      if (!c || c.desk !== 'sa' || (!admin && c.owner_agent_id !== auth.user!.id)) throw new Problem(403, 'This contact is not assigned to your serviced accommodation desk.');
      return c;
    };
    const start = async (listing: { id: string; report_property: unknown }) => {
      const property = reportProperty(listing.report_property);
      if (!property) return { stage: 'needs_details', message: 'Confirm the whole property, full postcode, bedrooms and bathrooms.' };
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      check(await supa.from('sa_property_reports').upsert({ listing_id: listing.id, access_token: token, property }, { onConflict: 'listing_id', ignoreDuplicates: true }));
      const row = check(await supa.from('sa_property_reports').select('*').eq('listing_id', listing.id).single());
      const leadListing = check(await supa.from('sa_listings').select('wk_contact_id,address,listing_url,photo_urls,property_type,rent_pcm,source_price,hostunico_call_eligible').eq('id', listing.id).single());
      const lead = await contact(leadListing.wk_contact_id);
      const result = await remote('start', { id: row.remote_id, token: row.access_token, property: row.property, country: hostunicoCountry(lead.hostunico_country, lead.phone), listing: reportListing(leadListing) });
      check(await supa.from('sa_property_reports').update({ state: result.stage, message: result.message, report_url: result.reportUrl ?? null, updated_at: new Date().toISOString() }).eq('listing_id', listing.id).eq('remote_id', row.remote_id));
      return result;
    };
    if (action === 'prepare_queue' && req.method === 'POST') {
      if (body.campaign_id !== HOSTUNICO_CAMPAIGN) throw new Problem(400, 'Choose the Hostunico calling campaign.');
      const offset = body.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0 || offset >= REPORT_AHEAD || offset % 2 !== 0) throw new Problem(400, 'Invalid report batch.');
      const membership = check(await supa.from('wk_campaign_agents').select('agent_id').eq('campaign_id', HOSTUNICO_CAMPAIGN).eq('agent_id', auth.user.id).maybeSingle());
      if (!admin && !membership) throw new Problem(403, 'Campaign access required.');
      const now = new Date().toISOString();
      let q = supa.from('wk_dialer_queue').select('contact_id,wk_contacts!inner(id,desk,owner_agent_id,do_not_call)').eq('campaign_id', HOSTUNICO_CAMPAIGN)
        .eq('status', 'pending').eq('wk_contacts.desk', 'sa').eq('wk_contacts.do_not_call', false)
        .or(`scheduled_for.is.null,scheduled_for.lte.${now}`).order('priority', { ascending: false }).order('scheduled_for', { ascending: true, nullsFirst: true }).order('attempts').order('created_at').limit(REPORT_AHEAD);
      if (!admin) q = q.eq('wk_contacts.owner_agent_id', auth.user.id);
      if (body.contact_id) q = q.neq('contact_id', body.contact_id);
      const queue = check(await q);
      let prepared = 0, ready = 0, preparing = 0, needsDetails = 0, failed = 0;
      // One pair per request stays below the edge response deadline. The desk
      // continues through all ten, updating progress after each pair.
      await Promise.all(queue.slice(offset, offset + 2).map(async (lead) => {
        try {
          const listing = check(await supa.from('sa_listings').select('id,report_property').eq('wk_contact_id', lead.contact_id).eq('source', 'spareroom').eq('hostunico_call_eligible', true).order('dealt_at', { ascending: false }).order('id').limit(1).maybeSingle());
          if (!listing || !reportProperty(listing.report_property)) { needsDetails++; return; }
          const result = await start(listing);
          if (result.stage === 'needs_details') needsDetails++;
          else if (result.stage === 'review') failed++;
          else { prepared++; if (result.stage === 'ready') ready++; else preparing++; }
        } catch { failed++; }
      }));
      return json({ prepared, ready, preparing, needsDetails, failed, ahead: queue.length, nextOffset: offset + 2 < queue.length ? offset + 2 : null });
    }
    const listingId = String(body.listing_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(listingId)) throw new Problem(400, 'Choose a property.');
    const listing = check(await supa.from('sa_listings').select('id,wk_contact_id,report_property,address,listing_url,photo_urls,property_type,rent_pcm,source_price,hostunico_call_eligible').eq('id', listingId).maybeSingle());
    if (!listing) throw new Problem(404, 'Property not found.');
    const c = await contact(listing.wk_contact_id);
    if (action === 'coach_context' && req.method === 'POST') {
      if (!['spareroom', 'facebook', 'followup'].includes(body.mode || '')) throw new Problem(400, 'Choose a call script.');
      const changedAt = (body as { context_at?: string }).context_at;
      if (!changedAt || !Number.isFinite(Date.parse(changedAt)) || Math.abs(Date.now() - Date.parse(changedAt)) > 300000) throw new Problem(400, 'Refresh the property and try again.');
      check(await supa.rpc('wk_hostunico_call_context', { p_contact: c.id, p_listing: listingId, p_mode: body.mode, p_changed_at: changedAt }));
      return json({ ok: true });
    }
    if (action === 'recipient' && req.method === 'POST') {
      const mobile = reportPhone(body.mobile);
      const kind = reportPhoneKind(mobile);
      if (!mobile || kind === 'landline' || (kind === 'unknown' && body.mobile_confirmed !== true)) throw new Problem(400, 'Enter a mobile number and confirm it with the lead.');
      const duplicate = check(await supa.from('wk_contacts').select('id').or(`phone.eq.${mobile},hostunico_sms_phone.eq.${mobile}`).neq('id', c.id).limit(1));
      if (duplicate.length) throw new Problem(409, 'This number already belongs to another contact. Ask Hugo to combine the contacts before sending.');
      check(await supa.from('wk_contacts').update({ hostunico_sms_phone: mobile }).eq('id', c.id));
      return json({ ok: true, mobile });
    }
    if (action === 'country' && req.method === 'POST') {
      if (!/^[A-Z]{2}$/.test(body.country || '')) throw new Problem(400, 'Choose a lead country.');
      const saved = check(await supa.from('sa_property_reports').select('remote_id,access_token').eq('listing_id', listingId).maybeSingle());
      if (saved) await remote('status', { id: saved.remote_id, token: saved.access_token, country: body.country });
      check(await supa.from('wk_contacts').update({ hostunico_country: body.country, custom_fields: { ...c.custom_fields, hostunico_country: body.country } }).eq('id', c.id));
      return json({ ok: true });
    }
    if (!['status', 'activity'].includes(action) && c.do_not_call) throw new Problem(409, 'This contact has asked not to be contacted.');
    let row = check(await supa.from('sa_property_reports').select('*').eq('listing_id', listingId).maybeSingle());
    if (action === 'activity') return json(row ? await remote('activity', { id: row.remote_id, token: row.access_token }) : { activity: { opens: 0, lastOpenedAt: null, activeSeconds: 0, onboardingOpened: false, events: [] } });
    if (action === 'prepare_current' && req.method === 'POST') return json(await start(listing));
    if (action === 'prepare' && req.method === 'POST') {
      if (/studio/i.test(listing.property_type || '')) throw new Problem(409, 'Studio reports use a labelled one-bedroom area comparison. Do not confirm that proxy as the studio layout. Ask Hugo for a property-specific studio assessment.');
      const property = reportProperty(body.property);
      if (!property) throw new Problem(400, 'Confirm the whole property, full postcode, bedrooms and bathrooms.');
      if (row && JSON.stringify(reportProperty(row.property)) !== JSON.stringify(property)) {
        if (body.replace !== true || property.areaEstimate) throw new Problem(409, 'Confirm the full property details and choose Replace estimate.');
        if (['sending', 'check_inbox'].includes(row.sms_state)) throw new Problem(409, 'Check the previous SMS send before replacing this report.');
        check(await supa.from('sa_report_versions').upsert({ remote_id: row.remote_id, listing_id: listingId, snapshot: row }, { onConflict: 'remote_id', ignoreDuplicates: true }));
        const accessToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
        const replaced = check(await supa.from('sa_property_reports').update({ remote_id: crypto.randomUUID(), access_token: accessToken, property, state: 'queued', report_url: null, message: null, sms_state: 'unsent', sms_sid: null, sms_message_id: null, sms_requested_at: null, received_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('listing_id', listingId).eq('remote_id', row.remote_id).neq('sms_state', 'sending').select('listing_id'));
        if (!replaced.length) throw new Problem(409, 'The report changed while you were editing. Please reload it.');
      }
      check(await supa.from('sa_listings').update({ report_property: property }).eq('id', listingId));
      return json(await start({ ...listing, report_property: property }));
    }
    if (!row) return json({ stage: 'needs_details', message: 'Confirm property details to prepare this report.', property: reportProperty(listing.report_property), mobile: c.hostunico_sms_phone || (reportPhoneKind(c.phone) === 'mobile' ? reportPhone(c.phone) : '') });
    if (action === 'retry' && req.method === 'POST') {
      if (row.state !== 'review' || row.sms_state !== 'unsent') throw new Problem(409, 'Only an unfinished, unsent report can be retried.');
      const result = await remote('retry', { id: row.remote_id, token: row.access_token });
      check(await supa.from('sa_property_reports').update({ state: result.stage, message: result.message }).eq('listing_id', listingId).eq('remote_id', row.remote_id));
      return json(result);
    }
    if (action === 'received' && req.method === 'POST') {
      if (!row.sms_sid) throw new Problem(409, 'Send the report before confirming receipt.');
      check(await supa.from('sa_property_reports').update({ received_at: new Date().toISOString() }).eq('listing_id', listingId).eq('remote_id', row.remote_id));
      return json({ ok: true });
    }
    if (row.state !== 'ready' || !/^https:\/\/hostunico\.com\/r\/[A-Za-z0-9]{5}$/.test(row.report_url || '') || action === 'send_sms' || Date.now() - Date.parse(row.created_at) >= 29 * 86400000) {
      const result = await remote('status', { id: row.remote_id, token: row.access_token, listing: reportListing(listing) });
      check(await supa.from('sa_property_reports').update({ state: result.stage, message: result.message, report_url: result.reportUrl ?? null }).eq('listing_id', listingId).eq('remote_id', row.remote_id));
      row = { ...row, state: result.stage, message: result.message, report_url: result.reportUrl ?? null };
    }
    if (action === 'send_sms' && req.method === 'POST') {
      if (body.permission !== true) throw new Problem(400, 'Confirm that they agreed to receive the report by SMS.');
      if (!c.hostunico_sms_phone && reportPhoneKind(c.phone) !== 'mobile') throw new Problem(400, 'Ask for their mobile number and save it, or use email.');
      if (row.state !== 'ready' || !row.report_url) throw new Problem(409, 'The report is not ready yet.');
      const sms = reportSms(row.report_url, row.property?.areaEstimate === true);
      const claim = check(await supa.from('sa_property_reports').update({ sms_state: 'sending', sms_requested_at: new Date().toISOString() }).eq('listing_id', listingId).eq('remote_id', row.remote_id).eq('sms_state', 'unsent').select('listing_id'));
      if (!claim.length) throw new Problem(409, 'This report has already been sent or is being sent. Check its message status before trying again.');
      // There is deliberately no automatic retry after a provider request: a lost response could still mean sent.
      try {
        const sent = await fetch(`${process.env.SUPABASE_URL}/functions/v1/wk-sms-send`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: c.id, campaign_id: HOSTUNICO_CAMPAIGN, channel: 'sms', body: sms }), signal: AbortSignal.timeout(20000) });
        const result = await sent.json() as { twilio_sid?: string; error?: string; status?: string; message_id?: string; warning?: string };
        if (!sent.ok || !result.twilio_sid) throw new Error(result.error || 'SMS status could not be confirmed. Check the inbox before retrying.');
        check(await supa.from('sa_property_reports').update({ sms_state: result.status || 'queued', sms_sid: result.twilio_sid, sms_message_id: result.message_id ?? null }).eq('listing_id', listingId).eq('remote_id', row.remote_id));
        const { data: stage } = await supa.from('wk_pipeline_columns').select('id').eq('pipeline_id', HOSTUNICO_PIPELINE).eq('name', 'Report sent').maybeSingle();
        let warning = result.warning;
        const { data: currentStage } = c.pipeline_column_id ? await supa.from('wk_pipeline_columns').select('name').eq('id', c.pipeline_column_id).maybeSingle() : { data: null };
        if (stage && (!currentStage || ['New lead', 'Report requested', 'Report sent'].includes(currentStage.name))) {
          const { error } = await supa.from('wk_contacts').update({ pipeline_column_id: stage.id, stage_moved_at: new Date().toISOString(), stage_moved_by: auth.user.id, stage_move_source: 'agent' }).eq('id', c.id);
          if (error) warning = 'SMS submitted. The board stage could not be updated.';
        }
        return json({ ok: true, smsStatus: result.status || 'queued', warning });
      } catch (error) {
        await supa.from('sa_property_reports').update({ sms_state: 'check_inbox' }).eq('listing_id', listingId).eq('remote_id', row.remote_id);
        throw new Problem(502, error instanceof Error ? error.message : 'Check the inbox for the send result.');
      }
    }
    if (action !== 'status') throw new Problem(400, 'Unknown report action.');
    let smsStatus = row.sms_state;
    if (row.sms_message_id) {
      const message = check(await supa.from('wk_sms_messages').select('status').eq('id', row.sms_message_id).maybeSingle());
      smsStatus = message?.status ?? smsStatus;
    }
    return json({ stage: row.state, message: row.message, reportUrl: row.state === 'ready' ? row.report_url : undefined, property: row.property, smsStatus, receivedAt: row.received_at, mobile: c.hostunico_sms_phone || (reportPhoneKind(c.phone) === 'mobile' ? reportPhone(c.phone) : '') });
  } catch (error) {
    return json({ error: error instanceof Problem ? error.message : 'Could not complete this report action. Please try again.' }, { status: error instanceof Problem ? error.status : 503 });
  }
}
