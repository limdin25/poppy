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
    patch: any = null; one = false;
    constructor(private table: string) {}
    select() { return this; }
    eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
    update(p: any) { this.patch = p; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    then(resolve: (value: any) => unknown) {
      const rows = (fixture.tables[this.table] || []).filter((r) => this.filters.every((f) => f(r)));
      if (this.patch) rows.forEach((r) => Object.assign(r, this.patch));
      return Promise.resolve({ data: this.one ? rows[0] ? { ...rows[0] } : null : rows.map((r) => ({ ...r })), error: null }).then(resolve);
    }
  }
  return { createClient: () => ({
    auth: { getUser: async (token: string) => ({ data: { user: token === 'good' ? { id: 'pedro' } : null } }) },
    rpc: async (name: string) => ({ data: name === 'wk_is_admin' ? fixture.admin : true, error: null }),
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
    sa_listings: [{ id: listingId, wk_contact_id: 'contact' }],
    sa_property_reports: [{ listing_id: listingId, remote_id: listingId, access_token: 'a'.repeat(64), state: 'ready', report_url: `https://hostunico.com/api/hostunico/crm-reports/${listingId}?token=${'a'.repeat(64)}`, sms_state: 'unsent' }],
    wk_pipeline_columns: [], wk_sms_messages: [],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('crm-estimates/status')) return Response.json({ stage: 'ready', message: 'Ready', reportUrl: fixture.tables.sa_property_reports[0].report_url });
    if (!url.endsWith('/functions/v1/wk-sms-send')) throw new Error('Unexpected request');
    fixture.smsRequests++;
    return Response.json({ twilio_sid: 'test-sid', message_id: 'test-message', status: 'queued' });
  }));
});
describe('human report sends', () => {
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
      if (url.includes('crm-estimates')) return Response.json({ stage: 'ready', reportUrl: fixture.tables.sa_property_reports[0].report_url });
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
