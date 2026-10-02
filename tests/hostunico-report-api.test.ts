import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  process.env.HOSTUNICO_CRM_TOKEN = 'test-token';
  return { tables: {} as Record<string, any[]>, admin: false, smsRequests: 0 };
});
vi.mock('@supabase/supabase-js', () => {
  class Query {
    filters: ((row: any) => boolean)[] = [];
    patch: any = null; one = false; count = Infinity;
    constructor(private table: string) {}
    select() { return this; }
    eq(k: string, v: any) { this.filters.push((r) => k.split('.').reduce((value, key) => value?.[key], r) === v); return this; }
    neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
    or(value: string) {
      this.filters.push((row) => value.split(',').some((condition) => {
        const [key, operator, ...parts] = condition.split('.'); const target = parts.join('.');
        return operator === 'is' ? row[key] == null : operator === 'lte' ? row[key] <= target : row[key] === target;
      }));
      return this;
    }
    order() { return this; }
    limit(count: number) { this.count = count; return this; }
    upsert(value: any) {
      const rows = fixture.tables[this.table] ||= [];
      if (!rows.some((row) => row.listing_id === value.listing_id)) rows.push({ ...value, remote_id: value.listing_id });
      return this;
    }
    update(p: any) { this.patch = p; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    then(resolve: (value: any) => unknown) {
      const rows = (fixture.tables[this.table] || []).filter((r) => this.filters.every((f) => f(r))).slice(0, this.count);
      if (this.patch) rows.forEach((r) => Object.assign(r, this.patch));
      return Promise.resolve({ data: this.one ? rows[0] ? { ...rows[0] } : null : rows.map((r) => ({ ...r })), error: null }).then(resolve);
    }
  }
  return { createClient: () => ({
    auth: { getUser: async (token: string) => ({ data: { user: token === 'good' ? { id: 'pedro' } : null } }) },
    rpc: async (name: string, args?: any) => {
      if (name === 'wk_hostunico_call_context') fixture.tables.wk_contacts.find((row) => row.id === args.p_contact).custom_fields = { hostunico_listing_id: args.p_listing, hostunico_script_mode: args.p_mode };
      return { data: name === 'wk_is_admin' ? fixture.admin : true, error: null };
    },
    from: (table: string) => new Query(table),
  }) };
});
import handler from '../api/crm/sa-report';
const listingId = '11111111-1111-4111-8111-111111111111';
function request(action: string, extra: Record<string, unknown> = {}, token = 'good') {
  return new Request('https://app.heyelsie.com/api/crm/sa-report', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, listing_id: listingId, ...extra }) });
}
beforeEach(() => {
  fixture.admin = false; fixture.smsRequests = 0;
  fixture.tables = {
    wk_contacts: [{ id: 'contact', desk: 'sa', owner_agent_id: 'pedro', do_not_call: false, phone: '+447700900123' }],
    sa_listings: [{ id: listingId, wk_contact_id: 'contact', rent_pcm: 1000, hostunico_call_eligible: true }],
    sa_property_reports: [{ listing_id: listingId, remote_id: listingId, access_token: 'a'.repeat(64), state: 'ready', report_url: 'https://hostunico.com/r/A1b2C', sms_state: 'unsent', report_pitch: { monthly: '£2,000', monthlyGbpPence: 200000, askingRentGbpPence: 100000 } }],
    wk_pipeline_columns: [], wk_sms_messages: [],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('crm-estimates/status')) return Response.json({ stage: 'ready', message: 'Ready', reportUrl: fixture.tables.sa_property_reports[0].report_url, reportPitch: fixture.tables.sa_property_reports[0].report_pitch });
    if (!url.endsWith('/functions/v1/wk-sms-send')) throw new Error('Unexpected request');
    fixture.smsRequests++;
    return Response.json({ twilio_sid: 'test-sid', message_id: 'test-message', status: 'queued' });
  }));
});
describe('human report sends', () => {
  it.each([129999, 100000, 83000])('blocks a ready report with %s pence earnings from every send attempt', async (monthlyGbpPence) => {
    Object.assign(fixture.tables.sa_property_reports[0].report_pitch, { monthlyGbpPence });
    const preview = await (await handler(request('status'))).json();
    expect(preview).toMatchObject({ eligibilityBlocked: true, qualification: { status: 'excluded' } });
    expect(preview.smsDraft).toBeUndefined();
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(409);
    expect(fixture.smsRequests).toBe(0);
    expect(fixture.tables.sa_property_reports[0].sms_state).toBe('unsent');
  });
  it('previews the exact SMS before Pedro sends, with the current short link', async () => {
    const preview = await (await handler(request('status'))).json();
    expect(preview.smsDraft).toContain('https://hostunico.com/r/A1b2C');
    expect(preview.smsBlocked).toBe(false);
    expect(fixture.smsRequests).toBe(0);
    await handler(request('send_sms', { permission: true }));
    const send = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/wk-sms-send'))!;
    expect(JSON.parse(String(send[1]?.body)).body).toBe(preview.smsDraft);
  });
  it('keeps a ready report and exact SMS available when the research service is down', async () => {
    fixture.tables.sa_property_reports[0].created_at = new Date().toISOString();
    fixture.tables.sa_property_reports[0].report_pitch = { monthly: '£2,100', monthlyGbpPence: 210000, askingRentGbpPence: 100000 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('crm-estimates')) throw new Error('Research timeout');
      fixture.smsRequests++;
      return Response.json({ twilio_sid: 'sent-manually', status: 'queued' });
    }));
    expect(await (await handler(request('status'))).json()).toMatchObject({ stage: 'ready', smsDraft: expect.stringContaining('/r/A1b2C') });
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(200);
    expect(fixture.smsRequests).toBe(1);
  });
  it('shows an existing text opt-out and blocks before claiming a send', async () => {
    fixture.tables.wk_contact_tags = [{ contact_id: 'contact', tag: 'do-not-text' }];
    expect(await (await handler(request('status'))).json()).toMatchObject({ smsBlocked: true, contactBlocked: false });
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(409);
    expect(fixture.tables.sa_property_reports[0].sms_state).toBe('unsent');
    expect(fixture.smsRequests).toBe(0);
  });
  it('fills twenty ready reports even when four earlier candidates cannot prepare, without sending messages', async () => {
    const campaign = '5d9657f9-d9b4-4e27-a2d1-83db80867f92';
    const property = { postcode: 'E14', bedrooms: 1, bathrooms: 1, wholeProperty: true, areaEstimate: true };
    fixture.tables.wk_campaign_agents = [{ campaign_id: campaign, agent_id: 'pedro' }];
    fixture.tables.wk_contacts = Array.from({ length: 24 }, (_, i) => ({ id: `lead-${i}`, desk: 'sa', owner_agent_id: 'pedro', do_not_call: false, phone: '+447700900123' }));
    fixture.tables.wk_dialer_queue = fixture.tables.wk_contacts.map((contact) => ({ campaign_id: campaign, contact_id: contact.id, status: 'pending', scheduled_for: null, wk_contacts: contact }));
    fixture.tables.sa_listings = fixture.tables.wk_contacts.map((contact, i) => ({ id: `${i}`.padStart(36, '0'), wk_contact_id: contact.id, source: 'spareroom', hostunico_call_eligible: true, report_property: property, rent_pcm: 1000, source_price: '£1000 pcm' }));
    fixture.tables.sa_property_reports = [];
    const started: string[] = [];
    let inFlight = 0, maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://hostunico.com/api/hostunico/crm-estimates/start');
      expect(JSON.parse(String(init.body)).listing).toMatchObject({ advertisedRentPcm: 1000, sourcePrice: '£1000 pcm', wholePropertyVerified: true });
      started.push(JSON.parse(String(init.body)).id);
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await Promise.resolve(); inFlight--;
      if (Number(JSON.parse(String(init.body)).id) < 4) throw new Error('Temporary provider issue');
      return Response.json({ stage: 'ready', message: 'Ready', reportUrl: 'https://hostunico.com/r/A1b2C', reportPitch: { monthlyGbpPence: 200000, askingRentGbpPence: 100000 } });
    }));
    let totalReady = 0;
    for (let offset = 0; offset < 24; offset += 2) {
      const response = await handler(request('prepare_queue', { campaign_id: campaign, offset }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({ ready: offset < 4 ? 0 : 2, failed: offset < 4 ? 2 : 0, target: 20, ahead: 24, nextOffset: offset === 22 ? null : offset + 2 });
      totalReady += result.ready;
      expect(started).toHaveLength(offset + 2);
    }
    expect(totalReady).toBe(20);
    expect(new Set(started).size).toBe(24);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(fixture.smsRequests).toBe(0);
    expect((await handler(request('prepare_queue', { campaign_id: campaign, offset: 500 }))).status).toBe(400);
  });
  it('refreshes existing reports beyond the first hundred contacts without creating reports or sending SMS', async () => {
    const campaign = '5d9657f9-d9b4-4e27-a2d1-83db80867f92';
    const property = { postcode: 'M1', bedrooms: 1, bathrooms: 1, wholeProperty: true, areaEstimate: true };
    fixture.tables.wk_campaign_agents = [{ campaign_id: campaign, agent_id: 'pedro' }];
    fixture.tables.wk_contacts = Array.from({ length: 108 }, (_, i) => ({ id: `lead-${i}`, desk: 'sa', owner_agent_id: 'pedro', do_not_call: false }));
    fixture.tables.wk_dialer_queue = fixture.tables.wk_contacts.map((contact) => ({ campaign_id: campaign, contact_id: contact.id, status: 'pending', scheduled_for: null, wk_contacts: contact }));
    fixture.tables.sa_listings = fixture.tables.wk_contacts.map((contact, i) => ({ id: `${i}`.padStart(36, '0'), wk_contact_id: contact.id, source: 'spareroom', hostunico_call_eligible: true, report_property: property, rent_pcm: 1000, source_price: '£1000 pcm' }));
    fixture.tables.sa_property_reports = fixture.tables.sa_listings.map((listing) => ({ listing_id: listing.id, remote_id: listing.id, access_token: 'a'.repeat(64), state: 'ready', report_url: 'https://hostunico.com/r/A1b2C', report_pitch: { planning: true } }));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      // The existing start route is idempotent for these saved report IDs.
      expect(url).toBe('https://hostunico.com/api/hostunico/crm-estimates/start');
      const payload = JSON.parse(String(init.body));
      expect(fixture.tables.sa_property_reports.some((row) => row.remote_id === payload.id && row.access_token === payload.token)).toBe(true);
      return Response.json({ stage: 'ready', reportUrl: 'https://hostunico.com/r/A1b2C', reportPitch: { monthlyGbpPence: 200000, askingRentGbpPence: 100000 } });
    }));
    const response = await handler(request('prepare_queue', { campaign_id: campaign, offset: 104 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: 2, ahead: 108, nextOffset: 106 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fixture.tables.sa_property_reports).toHaveLength(108);
    expect(fixture.smsRequests).toBe(0);
  });
  it('repairs the current failed report on opening it, with no retry click or outbound message', async () => {
    fixture.tables.sa_listings[0].report_property = { postcode: 'M22', bedrooms: 1, bathrooms: 1, wholeProperty: true, areaEstimate: true, advertisedRentPcm: 1000 };
    Object.assign(fixture.tables.sa_property_reports[0], { state: 'review', created_at: new Date().toISOString(), report_url: null });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('crm-estimates/start');
      return Response.json({ stage: 'ready', reportUrl: 'https://hostunico.com/r/N3w22', reportPitch: { planning: true, monthly: '£1,000' } });
    }));
    expect(await (await handler(request('status'))).json()).toMatchObject({ stage: 'ready', reportUrl: 'https://hostunico.com/r/N3w22', eligibilityBlocked: true, qualification: { status: 'pending' } });
    expect(fixture.smsRequests).toBe(0);
  });
  it('shows report activity only to the assigned agent, including read-only access after opt-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://hostunico.com/api/hostunico/crm-estimates/activity');
      return Response.json({ activity: { opens: 1, onboardingOpened: true, events: [{ event: 'onboarding_step', section: 'airbnb' }] } });
    }));
    fixture.tables.wk_contacts[0].do_not_call = true;
    const response = await handler(request('activity'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ activity: { opens: 1, onboardingOpened: true } });
    fixture.tables.wk_contacts[0].owner_agent_id = 'someone-else';
    expect((await handler(request('activity'))).status).toBe(403);
    expect((await handler(request('activity', {}, 'bad'))).status).toBe(401);
    expect(fixture.smsRequests).toBe(0);
  });
  it('caches only a ready report hook and clears it when research is unfinished', async () => {
    const pitch = { monthly: '£2,500', rent: '£1,000', difference: '£1,500', higher: true, areaEstimate: true, studioComparison: false, afterAirbnbFee: true };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stage: 'ready', reportUrl: 'https://hostunico.com/r/A1b2C', reportPitch: pitch })));
    expect(await (await handler(request('status'))).json()).toMatchObject({ reportPitch: pitch });
    expect(fixture.tables.sa_property_reports[0].report_pitch).toEqual(pitch);
    fixture.tables.sa_property_reports[0].state = 'researching';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stage: 'researching' })));
    expect(await (await handler(request('status'))).json()).toMatchObject({ reportPitch: null });
    expect(fixture.tables.sa_property_reports[0].report_pitch).toBeNull();
    expect(fixture.smsRequests).toBe(0);
  });
  it('blocks SMS to a landline and saves a mobile on the same contact without changing the calling number', async () => {
    fixture.tables.wk_contacts[0].phone = '+442079460000';
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(400);
    expect(fixture.smsRequests).toBe(0);
    expect((await handler(request('recipient', { mobile: '020 7946 0000', mobile_confirmed: true }))).status).toBe(400);
    expect((await handler(request('recipient', { mobile: '07700 900123', mobile_confirmed: true }))).status).toBe(200);
    expect(fixture.tables.wk_contacts).toHaveLength(1);
    expect(fixture.tables.wk_contacts[0].phone).toBe('+442079460000');
    expect(fixture.tables.wk_contacts[0].hostunico_sms_phone).toBe('+447700900123');
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(200);
  });
  it('rejects a mobile already assigned to another contact', async () => {
    fixture.tables.wk_contacts.push({ id: 'other', phone: '+447700900999' });
    expect((await handler(request('recipient', { mobile: '07700900999', mobile_confirmed: true }))).status).toBe(409);
    expect(fixture.smsRequests).toBe(0);
  });
  it('stores the selected property and script for the coach', async () => {
    expect((await handler(request('coach_context', { mode: 'followup', context_at: new Date().toISOString() }))).status).toBe(200);
    expect(fixture.tables.wk_contacts[0].custom_fields).toMatchObject({ hostunico_listing_id: listingId, hostunico_script_mode: 'followup' });
    expect((await handler(request('coach_context', { mode: 'other' }))).status).toBe(400);
    expect(fixture.smsRequests).toBe(0);
  });
  it('retries only unfinished unsent research and never sends a text', async () => {
    expect((await handler(request('retry'))).status).toBe(409);
    fixture.tables.sa_property_reports[0].state = 'review';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://hostunico.com/api/hostunico/crm-estimates/retry');
      return Response.json({ stage: 'queued', message: 'Queued' });
    }));
    expect((await handler(request('retry'))).status).toBe(200);
    expect(fixture.tables.sa_property_reports[0].state).toBe('queued');
    expect(fixture.smsRequests).toBe(0);
    fixture.tables.sa_property_reports[0].state = 'review';
    fixture.tables.sa_property_reports[0].sms_state = 'check_inbox';
    expect((await handler(request('retry'))).status).toBe(409);
  });
  it('rejects signed-out users and another agent contact without sending', async () => {
    expect((await handler(request('send_sms', { permission: true }, 'bad'))).status).toBe(401);
    fixture.tables.wk_contacts[0].owner_agent_id = 'other';
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(403);
    expect(fixture.smsRequests).toBe(0);
  });
  it('blocks another desk, a contact stop and missing permission', async () => {
    fixture.tables.wk_contacts[0].desk = 'houses';
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(403);
    fixture.tables.wk_contacts[0].desk = 'sa';
    fixture.tables.wk_contacts[0].do_not_call = true;
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(409);
    fixture.tables.wk_contacts[0].do_not_call = false;
    expect((await handler(request('send_sms'))).status).toBe(400);
    expect(fixture.smsRequests).toBe(0);
  });
  it('never sends an unready report', async () => {
    fixture.tables.sa_property_reports[0].state = 'queued';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stage: 'researching', message: 'Researching' })));
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(409);
    expect(fixture.smsRequests).toBe(0);
  });
  it('claims one send even when two button requests arrive together', async () => {
    const responses = await Promise.all([handler(request('send_sms', { permission: true })), handler(request('send_sms', { permission: true }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(fixture.smsRequests).toBe(1);
    expect(fixture.tables.sa_property_reports[0].sms_sid).toBe('test-sid');
    expect(fixture.tables.sa_property_reports[0].received_at).toBeUndefined();
  });
  it('does not retry after an ambiguous provider timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('crm-estimates')) return Response.json({ stage: 'ready', reportUrl: fixture.tables.sa_property_reports[0].report_url, reportPitch: fixture.tables.sa_property_reports[0].report_pitch });
      fixture.smsRequests++; throw new Error('Timed out');
    }));
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(502);
    expect((await handler(request('send_sms', { permission: true }))).status).toBe(409);
    expect(fixture.smsRequests).toBe(1);
    expect(fixture.tables.sa_property_reports[0].sms_state).toBe('check_inbox');
  });
  it('receipt requires a submitted SMS, and a human confirmation', async () => {
    expect((await handler(request('received'))).status).toBe(409);
    await handler(request('send_sms', { permission: true }));
    expect(fixture.tables.sa_property_reports[0].received_at).toBeUndefined();
    expect((await handler(request('received'))).status).toBe(200);
    expect(fixture.tables.sa_property_reports[0].received_at).toBeTruthy();
  });
});
