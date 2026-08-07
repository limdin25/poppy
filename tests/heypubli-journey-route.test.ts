import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/crm/heypubli-journey reads a SECOND Supabase project with a SERVICE ROLE
// key, which bypasses row-level security completely. The staff gate on the door
// is not enough on its own: Hugo's agents are contractors, and a staff token
// plus a list of phone numbers would otherwise return names, emails, WhatsApp
// numbers and Instagram handles for creators that agent has nothing to do with.
//
// So the numbers are resolved against wk_contacts FIRST, with the CALLER'S OWN
// token, and only the ones that survive that are ever mentioned to HeyPubli.
// Same pattern as api/crm/site-flow.ts, and the reason is the same: an RLS
// decision has to be made by the database with the real auth.uid().

const ELSIE_URL = 'https://elsie.example.supabase.co';
const HP_URL = 'https://heypubli.example.supabase.co';

process.env.SUPABASE_URL = ELSIE_URL;
process.env.SUPABASE_ANON_KEY = 'anon-key';

/** Does the caller pass wk_is_agent_or_admin? */
let staff = true;
/** The rows wk_contacts returns to THIS caller. In production RLS decides
 *  this; here the fake client simply obeys the list. */
let visiblePhones: string[] = [];
/** Fails the wk_contacts read, the way a dropped connection would. */
let contactsError: { message: string } | null = null;
/** HeyPubli profiles, keyed by the whatsapp column. */
let hpProfiles: Record<string, Record<string, unknown>> = {};
/** Every phone variant the HeyPubli project was actually asked about. */
let askedHeypubli: string[] = [];

const callerClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'agent-1' } } }) },
  rpc: async (fn: string) => ({ data: fn === 'wk_is_agent_or_admin' ? staff : false }),
  from: (_table: string) => ({
    select: (_cols: string) => ({
      in: async (_col: string, variants: string[]) => ({
        data: contactsError
          ? null
          : visiblePhones.filter((p) => variants.includes(p)).map((phone) => ({ phone })),
        error: contactsError,
      }),
    }),
  }),
});

const heypubliClient = () => ({
  from: (table: string) => ({
    select: (_cols: string) => ({
      in: async (col: string, values: string[]) => {
        if (table === 'profiles') {
          askedHeypubli.push(...values);
          return {
            data: values.flatMap((v) => (hpProfiles[v] ? [hpProfiles[v]] : [])),
            error: null,
          };
        }
        void col;
        return { data: [], error: null };
      },
      // The chase read (signup_leads next follow-up) goes .or().limit().
      // Leads play no part in these tests; an empty answer is the honest stub.
      or: (_conds: string) => ({
        limit: async (_n: number) => ({ data: [], error: null }),
      }),
    }),
  }),
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string) => (url === HP_URL ? heypubliClient() : callerClient()),
}));

const load = async () => (await import('../api/crm/heypubli-journey')).default;

const post = async (phones: string[]) => {
  const handler = await load();
  return handler(
    new Request('https://app.heyelsie.com/api/crm/heypubli-journey', {
      method: 'POST',
      headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
      body: JSON.stringify({ phones }),
    }),
  );
};

const profile = (whatsapp: string, over: Record<string, unknown> = {}) => ({
  id: `p-${whatsapp}`,
  first_name: 'Prem',
  last_name: 'Bharti',
  email: 'prem@example.com',
  whatsapp,
  ig_username: 'upharprem',
  created_at: '2026-08-07T09:57:42Z',
  onboarding_complete: false,
  suspended_at: null,
  community_joined_declared_at: null,
  photo_declared_at: null,
  bio_link_declared_at: null,
  skool_affiliate_url: null,
  ...over,
});

beforeEach(() => {
  staff = true;
  visiblePhones = [];
  contactsError = null;
  hpProfiles = {};
  askedHeypubli = [];
  process.env.HEYPUBLI_SUPABASE_URL = HP_URL;
  process.env.HEYPUBLI_SERVICE_ROLE_KEY = 'hp-service-key';
});

describe('the staff gate', () => {
  it('refuses a caller who is not an agent or admin', async () => {
    staff = false;
    const res = await post(['+918207324841']);
    expect(res.status).toBe(401);
  });
});

describe('the caller can only ask about their own leads', () => {
  it('answers for a phone the caller can see in wk_contacts', async () => {
    visiblePhones = ['+918207324841'];
    hpProfiles['+918207324841'] = profile('+918207324841');
    const body = await (await post(['+918207324841'])).json();
    expect(Object.keys(body.journeys)).toEqual(['918207324841']);
    expect(body.ok).toBe(true);
  });

  it('never mentions a phone the caller cannot see to the HeyPubli project', async () => {
    // The whole point. A contractor agent posting somebody else's number must
    // not get that creator's name, email or Instagram handle back, and the
    // number must not even reach the service-role query.
    visiblePhones = ['+918207324841'];
    hpProfiles['+919999999999'] = profile('+919999999999', { first_name: 'Somebody' });
    const res = await post(['+918207324841', '+919999999999']);
    const body = await res.json();
    expect(body.journeys['919999999999']).toBeUndefined();
    expect(askedHeypubli.join(' ')).not.toContain('919999999999');
  });

  it('asks HeyPubli nothing at all when none of the numbers are the caller\'s', async () => {
    visiblePhones = [];
    hpProfiles['+919999999999'] = profile('+919999999999');
    const body = await (await post(['+919999999999'])).json();
    expect(body.journeys).toEqual({});
    expect(askedHeypubli).toEqual([]);
  });
});

describe('could not check is not the same as no account', () => {
  it('says so plainly when the HeyPubli keys are not set', async () => {
    delete process.env.HEYPUBLI_SUPABASE_URL;
    const body = await (await post(['+918207324841'])).json();
    expect(body.configured).toBe(false);
    expect(body.ok).toBe(false);
  });

  it('says so plainly when the wk_contacts read fails', async () => {
    contactsError = { message: 'connection reset' };
    const res = await post(['+918207324841']);
    const body = await res.json();
    // Degrades rather than 500ing: this decorates the inbox and must never be
    // the reason the conversation list fails to render.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.journeys).toEqual({});
  });

  it('is an honest yes when the lookup ran and found nobody', async () => {
    visiblePhones = ['+918207324841'];
    const body = await (await post(['+918207324841'])).json();
    expect(body.ok).toBe(true);
    expect(body.journeys).toEqual({});
  });
});
