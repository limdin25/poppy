// The two server routes behind Admin, AI Costs. The database is a fake: what
// matters here is who may ask, what is accepted, and what is sent to it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { email: 'hugo@example.com' } as { email?: string } | null,
  admin: true,
  rpcCalls: [] as Array<{ name: string; args: any }>,
  rpcResult: { data: { totals: { cost: 1 }, series: [] } as unknown, error: null as null | { message: string } },
  prices: [{ id: 1, provider: 'openai', model: 'gpt-5.4-mini' }] as unknown[],
  rate: '0.75' as string | null,
  upserts: [] as Array<{ table: string; row: any; options: any }>,
  upsertError: null as null | { message: string },
}));

vi.mock('../src/integrations/supabase/client', () => ({
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    rpc: async (name: string, args: any) => { db.rpcCalls.push({ name, args }); return db.rpcResult; },
    from: (table: string) => {
      const chain: any = {
        select: () => chain, eq: () => chain,
        single: async () => ({ data: db.admin ? { email: 'hugo@example.com' } : null }),
        maybeSingle: async () => ({ data: db.rate === null ? null : { value: db.rate } }),
        order: () => chain,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: db.prices, error: null }),
        upsert: async (row: any, options: any) => { db.upserts.push({ table, row, options }); return { error: db.upsertError }; },
      };
      return chain;
    },
  },
}));

import costs from '../api/admin/ai/costs';
import prices from '../api/admin/ai/prices';

const get = (path: string, init: RequestInit = {}) =>
  new Request(`https://app.heyelsie.com/api/admin/ai/${path}`, { headers: { Authorization: 'Bearer token' }, ...init });
const send = (path: string, method: string, body: unknown) =>
  get(path, { method, body: JSON.stringify(body), headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } });

beforeEach(() => {
  db.user = { email: 'hugo@example.com' }; db.admin = true; db.rpcCalls = []; db.upserts = []; db.upsertError = null; db.rate = '0.75';
  db.rpcResult = { data: { totals: { cost: 1 }, series: [] }, error: null };
});

describe('only an admin may look at the costs', () => {
  for (const [name, handler, path] of [['costs', costs, 'costs'], ['prices', prices, 'prices']] as const) {
    it(`${name}: no token, a bad token and a non-admin are all refused`, async () => {
      expect((await handler(new Request(`https://x/api/admin/ai/${path}`))).status).toBe(401);
      db.user = null;
      expect((await handler(get(path))).status).toBe(401);
      db.user = { email: 'someone@example.com' }; db.admin = false;
      expect((await handler(get(path))).status).toBe(403);
      expect(db.rpcCalls).toHaveLength(0);
    });
  }
  it('costs only answers GET', async () => {
    expect((await costs(send('costs', 'POST', {}))).status).toBe(405);
  });
});

describe('asking for the costs', () => {
  it('with nothing asked, shows today by day, with no filters', async () => {
    const res = await costs(get('costs'));
    expect(res.status).toBe(200);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].name).toBe('ai_cost_overview');
    expect(db.rpcCalls[0].args).toMatchObject({ p_bucket: 'day', p_providers: null, p_models: null, p_features: null, p_tz: 'Europe/London' });
    expect(db.rpcCalls[0].args.p_from).toBe(db.rpcCalls[0].args.p_to);
    const body = await res.json();
    expect(body).toMatchObject({ bucket: 'day', bucket_forced: false, totals: { cost: 1 } });
  });
  it('passes the dates, the bar size and each filter through', async () => {
    await costs(get('costs?from=2026-10-01&to=2026-10-02&bucket=hour&providers=openai,google&models=gpt-5.4-mini&features=live-coach,%20daily-report'));
    expect(db.rpcCalls[0].args).toMatchObject({
      p_from: '2026-10-01', p_to: '2026-10-02', p_bucket: 'hour',
      p_providers: ['openai', 'google'], p_models: ['gpt-5.4-mini'], p_features: ['live-coach', 'daily-report'],
    });
  });
  it('turns hour by hour into day by day over more than 31 days, and says so', async () => {
    const res = await costs(get('costs?from=2026-08-01&to=2026-09-15&bucket=hour'));
    expect(db.rpcCalls[0].args.p_bucket).toBe('day');
    expect(await res.json()).toMatchObject({ bucket: 'day', bucket_forced: true });
    db.rpcCalls = [];
    await costs(get('costs?from=2026-09-01&to=2026-10-01&bucket=hour'));
    expect(db.rpcCalls[0].args.p_bucket).toBe('hour');
  });
  it('refuses nonsense before it reaches the database', async () => {
    for (const q of ['from=yesterday&to=today', 'from=2026-10-05&to=2026-10-01', 'from=2025-01-01&to=2026-10-01', 'from=2026-13-45&to=2026-13-46',
      `models=${'x'.repeat(121)}`]) {
      expect((await costs(get(`costs?${q}`))).status, q).toBe(400);
    }
    expect(db.rpcCalls).toHaveLength(0);
  });
  it('does not leak a database error', async () => {
    db.rpcResult = { data: null, error: { message: 'relation "ai_usage_log" does not exist' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await costs(get('costs'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('ai_usage_log');
  });
});

describe('the price list', () => {
  it('lists the prices and the pound rate', async () => {
    expect(await (await prices(get('prices'))).json()).toEqual({ prices: db.prices, usd_to_gbp: 0.75 });
    db.rate = null;
    expect((await (await prices(get('prices'))).json()).usd_to_gbp).toBe(0);
  });
  it('saves one price, keyed so the same model and date is replaced, not doubled', async () => {
    const res = await prices(send('prices', 'PUT', { provider: 'google', model: 'gemini-3.8-flash', match: 'exact', effective_from: '2027-01-01', input_per_mtok: '1.5', output_per_mtok: 7.5, cached_input_per_mtok: '', per_minute: null }));
    expect(res.status).toBe(200);
    expect(db.upserts[0]).toMatchObject({ table: 'ai_model_prices', options: { onConflict: 'provider,model,effective_from' },
      row: { provider: 'google', model: 'gemini-3.8-flash', match: 'exact', effective_from: '2027-01-01', input_per_mtok: 1.5, output_per_mtok: 7.5, cached_input_per_mtok: null, per_minute: null } });
  });
  it('refuses a price that is wrong, an unknown provider, a bad date and a missing model', async () => {
    const ok = { provider: 'openai', model: 'gpt-x', effective_from: '2026-10-07', input_per_mtok: 1 };
    for (const bad of [{ ...ok, provider: 'acme' }, { ...ok, input_per_mtok: -1 }, { ...ok, output_per_mtok: 'abc' }, { ...ok, input_per_mtok: 20000 },
      { ...ok, effective_from: 'tomorrow' }, { ...ok, model: '  ' }, { ...ok, model: 'x'.repeat(121) }]) {
      expect((await prices(send('prices', 'PUT', bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(db.upserts).toHaveLength(0);
  });
  it('saves the pound rate only when it is believable', async () => {
    expect((await prices(send('prices', 'PUT', { usd_to_gbp: 0.8 }))).status).toBe(200);
    expect(db.upserts[0]).toMatchObject({ table: 'platform_settings', row: { key: 'usd_to_gbp', value: '0.8', updated_by: 'hugo@example.com' } });
    for (const bad of [0, 5, 'x', -1]) expect((await prices(send('prices', 'PUT', { usd_to_gbp: bad }))).status).toBe(400);
  });
  it('reports a database failure without its detail', async () => {
    db.upsertError = { message: 'permission denied for table secret_thing' };
    const res = await prices(send('prices', 'PUT', { provider: 'openai', model: 'gpt-x', input_per_mtok: 1 }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret_thing');
  });
  it('prices past calls again from the date given, and only that action exists', async () => {
    db.rpcResult = { data: 321, error: null };
    expect(await (await prices(send('prices', 'POST', { action: 'reprice', from: '2026-10-03' }))).json()).toEqual({ ok: true, repriced: 321 });
    expect(db.rpcCalls[0]).toEqual({ name: 'ai_reprice_usage', args: { p_from: '2026-10-03T00:00:00Z' } });
    expect((await prices(send('prices', 'POST', { action: 'delete everything' }))).status).toBe(400);
    expect((await prices(send('prices', 'DELETE', {}))).status).toBe(405);
  });
});
