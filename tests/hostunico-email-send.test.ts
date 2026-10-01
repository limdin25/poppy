import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { HOSTUNICO_COMPANY } from '../supabase/functions/_shared/hostunico-company';

// Exercise the deployed Deno handler with fake auth, database and provider.
// This sends no email and catches sender/ownership mistakes before deployment.
let handler: (request: Request) => Promise<Response>;
let tables: Record<string, any[]>;
let isAdmin: boolean;
class Query {
  filters: ((row: any) => boolean)[] = []; singleRow = false; inserted: any;
  constructor(readonly table: string) {}
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push((row) => row[key] === value); return this; }
  is(key: string, value: unknown) { return this.eq(key, value); }
  order() { return this; }
  limit() { return this; }
  insert(value: any) { this.inserted = { id: 'message-id', ...value }; (tables[this.table] ||= []).push(this.inserted); return this; }
  update() { return this; }
  maybeSingle() { this.singleRow = true; return this; }
  single() { this.singleRow = true; return this; }
  then(resolve: (result: any) => unknown) {
    const rows = (tables[this.table] || []).filter((row) => this.filters.every((filter) => filter(row)));
    return Promise.resolve({ data: this.singleRow ? this.inserted || rows[0] || null : rows, error: null }).then(resolve);
  }
}
beforeEach(() => {
  isAdmin = false;
  tables = {
    wk_contacts: [{ id: 'lead', desk: 'sa', owner_agent_id: 'pedro', email: 'owner@example.com', do_not_call: false }],
    wk_numbers: [{ id: 'hostunico', e164: 'hello@hostunico.com', channel: 'email', provider: 'resend', is_active: true }, { id: 'old', e164: 'old@other.example', channel: 'email', provider: 'resend', is_active: true }],
  };
  const createClient = () => ({ auth: { getUser: async (token: string) => ({ data: { user: token === 'valid' ? { id: 'pedro' } : null }, error: null }) }, rpc: async (name: string) => ({ data: name === 'wk_is_admin' ? isAdmin : true, error: null }), from: (table: string) => new Query(table) });
  const source = readFileSync('supabase/functions/wk-email-send/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function('serve', 'createClient', 'Deno', 'HOSTUNICO_COMPANY', js)((fn: typeof handler) => { handler = fn; }, createClient, { env: { get: () => 'test-only' } }, HOSTUNICO_COMPANY);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'provider-id' })));
});
const request = (extra = {}, token = 'valid') => new Request('https://example.com/email', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: 'lead', subject: 'Your report', body: 'Your report: https://hostunico.com/r/A1b2C', ...extra }) });
describe('Hostunico manual report email', () => {
  it('uses the Hostunico sender even if an old product channel is requested and records the report in the inbox', async () => {
    expect(fetch).not.toHaveBeenCalled();
    const result = await handler(request({ channel_id: 'old', to_email: 'confirmed@example.com' }));
    expect(result.status).toBe(200);
    const send = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(send.from).toBe('hello@hostunico.com');
    expect(send.to).toEqual(['confirmed@example.com']);
    expect(tables.wk_sms_messages[0]).toMatchObject({ contact_id: 'lead', channel: 'email', body: 'Your report: https://hostunico.com/r/A1b2C', from_e164: 'hello@hostunico.com' });
  });
  it('rejects unknown sessions, another agent\'s contact and opt-out before contacting the provider', async () => {
    expect((await handler(request({}, 'invalid'))).status).toBe(401);
    tables.wk_contacts[0].owner_agent_id = 'other';
    expect((await handler(request())).status).toBe(403);
    isAdmin = true; tables.wk_contacts[0].do_not_call = true;
    expect((await handler(request())).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses a missing Hostunico sender instead of using the workspace fallback', async () => {
    tables.wk_numbers = tables.wk_numbers.filter((row) => row.id !== 'hostunico');
    expect((await handler(request())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot queue a scheduled SMS for a Hostunico contact', async () => {
    const source = readFileSync('supabase/functions/wk-schedule-send/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: 'pedro' } } }) }, rpc: async () => ({ data: true }), from: (table: string) => new Query(table) });
    new Function('serve', 'createClient', 'Deno', js)((fn: typeof handler) => { handler = fn; }, createClient, { env: { get: () => 'test-only' } });
    expect((await handler(request())).status).toBe(409);
    expect(tables.wk_jobs).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('also skips an old queued SMS before the worker can reach a provider', async () => {
    const source = readFileSync('supabase/functions/wk-jobs-worker/index.ts', 'utf8');
    const start = source.indexOf('async function handleSendSms(');
    const end = source.indexOf('// ---- ai_reply', start);
    const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const worker = new Function(`${js}\nreturn handleSendSms;`)();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker({ from: (table: string) => new Query(table) }, { contact_id: 'lead', body: 'Old scheduled message' });
    expect(fetch).not.toHaveBeenCalled();
    expect(tables.wk_sms_messages).toBeUndefined();
    log.mockRestore();
  });
});
