import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cron must READ its timings from platform_settings.site_demo_ladder. If it
// hardcodes them, editing a delay on the flow canvas relabels a picture without
// changing what the system does, which is worse than not having the canvas.
//
// The supabase client is created at module load, so it is mocked before import.

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

let storedValue: string | null = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: storedValue === null ? null : { value: storedValue } }),
        }),
      }),
      upsert: async (row: { value: string }) => {
        storedValue = row.value;
        return { error: null };
      },
    }),
  }),
}));

const load = async () => import('../api/lib/site-demo');

beforeEach(() => {
  storedValue = null;
  vi.resetModules();
});

describe('the cron reads its timings from platform_settings', () => {
  it('falls back to the documented defaults when the key is absent', async () => {
    const { getLadderConfig } = await load();
    const { DEFAULT_LADDER_CONFIG } = await import('../src/core/site-demo/ladder');
    expect(await getLadderConfig()).toEqual(DEFAULT_LADDER_CONFIG);
  });

  it('uses the stored value when it is there', async () => {
    storedValue = JSON.stringify({ engage_1_minutes: 45, max_outbound_calls: 1 });
    const { getLadderConfig } = await load();
    const cfg = await getLadderConfig();
    expect(cfg.engage_1_minutes).toBe(45);
    expect(cfg.max_outbound_calls).toBe(1);
    // untouched fields keep their defaults rather than becoming undefined
    expect(cfg.unopened_1_hours).toBe(2);
  });

  it('survives a corrupt value rather than stopping the funnel', async () => {
    storedValue = '{not json at all';
    const { getLadderConfig } = await load();
    const { DEFAULT_LADDER_CONFIG } = await import('../src/core/site-demo/ladder');
    expect(await getLadderConfig()).toEqual(DEFAULT_LADDER_CONFIG);
  });

  it('ignores out-of-range numbers a bad save could write', async () => {
    storedValue = JSON.stringify({ unopened_1_hours: -3, engage_2_hours: 'soon' });
    const { getLadderConfig } = await load();
    const cfg = await getLadderConfig();
    expect(cfg.unopened_1_hours).toBe(2);
    expect(cfg.engage_2_hours).toBe(2);
  });

  it('merges a partial save over what was already stored', async () => {
    storedValue = JSON.stringify({ engage_1_minutes: 45 });
    const { saveLadderConfig } = await load();
    const saved = await saveLadderConfig({ ai_call_1_hours: 12 });
    expect(saved.engage_1_minutes).toBe(45);
    expect(saved.ai_call_1_hours).toBe(12);
    expect(JSON.parse(storedValue!)).toMatchObject({ engage_1_minutes: 45, ai_call_1_hours: 12 });
  });
});

describe('the ladder key is separate from the settings key', () => {
  // Saving a timing from the flow canvas must not be able to clobber the master
  // switch or the quiet hours, which live in a different panel entirely.
  it('uses its own platform_settings key', async () => {
    const { SITE_DEMO_LADDER_KEY, SITE_DEMO_SETTINGS_KEY } = await load();
    expect(SITE_DEMO_LADDER_KEY).toBe('site_demo_ladder');
    expect(SITE_DEMO_LADDER_KEY).not.toBe(SITE_DEMO_SETTINGS_KEY);
  });
});
