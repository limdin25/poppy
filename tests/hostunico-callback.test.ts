import { describe, it, expect, vi } from 'vitest';
vi.mock('@/integrations/supabase/browser', () => ({ supabase: {} }));
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { callbackDisplayNumber, callbackSmsLine, callbackFirstName } from '../supabase/functions/_shared/hostunico-callback';
import { reportSms, hostunicoCallback } from '../api/lib/hostunico-report';
import { saEmailTemplate } from '../src/features/crm/components/live-call/SaEmailPane';
import { nonGsm7, smsSegments } from '../api/lib/sms-charset';

// Hugo, 3 Oct 2026: whoever receives the report must be able to ring Pedro
// back, so the decision maker can reach him. The number is read from the
// database by the sending agent, never typed into the code.

const LONG_DASH = /[‒-―‘’“”…]/;
const url = 'https://hostunico.com/r/Ab1c2';

describe('callback number formatting', () => {
  it('turns a UK mobile into the national format people dial', () => {
    expect(callbackDisplayNumber('+447462167894')).toBe('07462 167894');
  });
  it('formats London and other UK landlines readably', () => {
    expect(callbackDisplayNumber('+442071234567')).toBe('020 7123 4567');
    expect(callbackDisplayNumber('+441614960000')).toBe('01614 960000');
  });
  it('leaves a foreign number in full international form', () => {
    expect(callbackDisplayNumber('+12025550123')).toBe('+12025550123');
  });
  it('refuses junk', () => {
    expect(callbackDisplayNumber('')).toBeNull();
    expect(callbackDisplayNumber(null)).toBeNull();
    expect(callbackDisplayNumber('not a number')).toBeNull();
  });
  it('takes a clean GSM-7 first name from the profile name', () => {
    expect(callbackFirstName('Pedro Houses')).toBe('Pedro');
    expect(callbackFirstName('  José ')).toBe('Jose');
    expect(callbackFirstName('')).toBe('');
  });
});

describe('the report SMS carries the callback number', () => {
  const callback = { number: '07462 167894', name: 'Pedro' };
  it('ends with a short call-me-back line', () => {
    for (const area of [false, true]) {
      const text = reportSms(url, area, callback);
      expect(text).toContain(url);
      expect(text).toContain('Let me know what you think.');
      expect(text.endsWith('Call or text me back on 07462 167894, Pedro.')).toBe(true);
      expect(nonGsm7(text)).toEqual([]);
      expect(smsSegments(text)).toBeLessThanOrEqual(2);
      expect(text).not.toMatch(LONG_DASH);
    }
  });
  it('works without a name', () => {
    expect(reportSms(url, false, { number: '07462 167894', name: '' })).toMatch(/Call or text me back on 07462 167894\.$/);
  });
  it('sends exactly the old text when no number can be resolved', () => {
    expect(reportSms(url, false, null)).toBe(`Hi, here's your Hostunico property report: ${url}\nLet me know what you think.`);
  });
  it('the line itself is GSM-7', () => {
    expect(nonGsm7(callbackSmsLine(callback))).toEqual([]);
  });
});

describe('resolving the sending agent number from the database', () => {
  type Rows = Record<string, Record<string, unknown>[]>;
  const fake = (rows: Rows) => ({
    from(table: string) {
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: (rows[table] || []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: (rows[table] || []).filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
      };
      return q;
    },
  });
  it('uses the agent default caller id first', async () => {
    const supa = fake({
      profiles: [{ id: 'a1', name: 'Pedro Houses', default_caller_id_number_id: 'n1' }],
      wk_numbers: [{ id: 'n1', e164: '+447462167894', is_active: true }],
    });
    expect(await hostunicoCallback(supa as never, 'a1')).toEqual({ e164: '+447462167894', number: '07462 167894', name: 'Pedro' });
  });
  it('falls back to the Hostunico campaign number', async () => {
    const supa = fake({
      profiles: [{ id: 'a1', name: 'Pedro Houses', default_caller_id_number_id: null }],
      wk_campaign_numbers: [{ campaign_id: '5d9657f9-d9b4-4e27-a2d1-83db80867f92', number_id: 'n2', wk_numbers: { e164: '+447462167894', is_active: true, channel: 'sms' } }],
    });
    expect((await hostunicoCallback(supa as never, 'a1'))?.number).toBe('07462 167894');
  });
  it('returns null when nothing resolves', async () => {
    expect(await hostunicoCallback(fake({ profiles: [{ id: 'a1', name: 'Pedro', default_caller_id_number_id: null }] }) as never, 'a1')).toBeNull();
  });
});

describe('the report email carries the callback number', () => {
  const base = { address: '1 High St', street: 'High St', rent: '1,000', fromName: 'Pedro', reportUrl: url };
  it('has it in the body and under the signature', () => {
    const { body } = saEmailTemplate({ ...base, callbackNumber: '07462 167894' });
    expect(body).toContain('You can call me back on 07462 167894.');
    expect(body.trim().endsWith('Pedro\nHostunico\n07462 167894')).toBe(true);
    expect(body).not.toMatch(LONG_DASH);
  });
  it('keeps the old email when no number is known', () => {
    const { body } = saEmailTemplate(base);
    expect(body).not.toContain('call me back');
    expect(body.trim().endsWith('Pedro\nHostunico')).toBe(true);
  });
});

describe('every report send path passes the number', () => {
  it('sa-report uses it for both the draft and the send', () => {
    const src = readFileSync(resolve(__dirname, '../api/crm/sa-report.ts'), 'utf8');
    expect(src.match(/reportSms\([^)]*callback\)/g)?.length).toBe(2);
    expect(src).toContain('hostunicoCallback(supa, auth.user.id)');
  });
  it('the report panel hands it to the email and warns when missing', () => {
    const src = readFileSync(resolve(__dirname, '../src/features/crm/components/live-call/SaReportPanel.tsx'), 'utf8');
    expect(src).toContain('callbackNumber={report?.callback?.number}');
    expect(src).toContain('No callback number');
  });
});
