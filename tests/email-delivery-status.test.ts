import { describe, expect, it } from 'vitest';
import { emailDeliveryUpdate, recordEmailDelivery } from '../supabase/functions/_shared/email-delivery-status';

// A tiny stand-in for the Supabase query builder: filters rows, applies the patch.
function fakeDb(tables: Record<string, any[]>, fail = false) {
  return {
    from(table: string) {
      const filters: ((r: any) => boolean)[] = []; let patch: any = null;
      const q: any = {
        update(p: any) { patch = p; return q; },
        eq(k: string, v: any) { filters.push((r) => r[k] === v); return q; },
        in(k: string, v: any[]) { filters.push((r) => v.includes(r[k])); return q; },
        select() {
          const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          if (!fail) rows.forEach((r) => Object.assign(r, patch));
          return Promise.resolve(fail ? { data: null, error: { message: 'down' } } : { data: rows, error: null });
        },
      };
      return q;
    },
  };
}

describe('Resend delivery events on emails the CRM sent', () => {
  it('only bounced and delivered matter', () => {
    expect(emailDeliveryUpdate('email.bounced')?.status).toBe('bounced');
    expect(emailDeliveryUpdate('email.delivered')?.status).toBe('delivered');
    for (const t of ['email.received', 'email.sent', 'email.opened', undefined]) expect(emailDeliveryUpdate(t)).toBeNull();
  });

  it('a bounce marks the message and unlocks the report, even after an earlier delivered', async () => {
    const tables = {
      wk_sms_messages: [{ external_id: 'e1', channel: 'email', direction: 'outbound', status: 'delivered' }, { external_id: 'e1', channel: 'sms', direction: 'outbound', status: 'queued' }],
      sa_property_reports: [{ email_id: 'e1', email_state: 'queued' }],
    };
    expect(await recordEmailDelivery(fakeDb(tables), 'email.bounced', 'e1')).toEqual({ matched: 2 });
    expect(tables.wk_sms_messages[0].status).toBe('bounced');
    expect(tables.wk_sms_messages[1].status).toBe('queued');
    expect(tables.sa_property_reports[0].email_state).toBe('bounced');
  });

  it('a late delivered never hides a bounce', async () => {
    const tables = { wk_sms_messages: [{ external_id: 'e2', channel: 'email', direction: 'outbound', status: 'bounced' }], sa_property_reports: [{ email_id: 'e2', email_state: 'bounced' }] };
    expect(await recordEmailDelivery(fakeDb(tables), 'email.delivered', 'e2')).toEqual({ matched: 0 });
    expect(tables.wk_sms_messages[0].status).toBe('bounced');
    expect(tables.sa_property_reports[0].email_state).toBe('bounced');
  });

  it('an email from another product on the shared Resend account changes nothing', async () => {
    const tables = { wk_sms_messages: [{ external_id: 'crm', channel: 'email', direction: 'outbound', status: 'queued' }], sa_property_reports: [] };
    expect(await recordEmailDelivery(fakeDb(tables), 'email.bounced', 'lemlin-email')).toEqual({ matched: 0 });
    expect(await recordEmailDelivery(fakeDb(tables), 'email.bounced', '')).toEqual({ matched: 0 });
    expect(tables.wk_sms_messages[0].status).toBe('queued');
  });

  it('a database failure throws so Resend retries the event', async () => {
    await expect(recordEmailDelivery(fakeDb({ wk_sms_messages: [], sa_property_reports: [] }, true), 'email.bounced', 'e3')).rejects.toThrow();
  });
});
