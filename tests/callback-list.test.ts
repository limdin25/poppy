// The top stripe that says who came back to us.
//
// Hugo, 2026-08-26: "if someone calls us back it should show on the top... so
// he can click and go to the inbox. Only the people that we have contacted
// before. No marketing emails." And: "make visible always."
//
// Two halves, tested in two places:
//   * WHO may appear is a database rule (wk_callbacks_open, migration
//     20260826000001): something of ours must have gone to them BEFORE they
//     came back. The SQL half is pinned at the bottom of this file by reading
//     the migration, because a rule that quietly loosens is the failure mode.
//   * ORDER and WORDING are here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  orderCallbacks,
  actionLabel,
  whoLabel,
  displayName,
  agoLabel,
  headline,
  tone,
  type Callback,
} from '../src/features/crm/lib/callbackList';

function row(over: Partial<Callback>): Callback {
  return {
    contactId: 'c1',
    name: 'A Builder',
    phone: '+447700900001',
    leadType: 'builder',
    kind: 'sms',
    cameBackAt: '2026-08-26T12:00:00Z',
    missed: false,
    preview: '',
    ...over,
  };
}

describe('order', () => {
  it('puts a missed call above a newer text, because a text can be read later', () => {
    const missedYesterday = row({
      contactId: 'jl', name: 'JL BRICKWORK', kind: 'call', missed: true,
      cameBackAt: '2026-08-25T09:00:00Z',
    });
    const textJustNow = row({ contactId: 'x', cameBackAt: '2026-08-26T15:00:00Z' });
    const out = orderCallbacks([textJustNow, missedYesterday]);
    expect(out[0].contactId).toBe('jl');
  });

  it('puts the newest missed call first among missed calls', () => {
    const old = row({ contactId: 'a', kind: 'call', missed: true, cameBackAt: '2026-08-25T09:00:00Z' });
    const recent = row({ contactId: 'b', kind: 'call', missed: true, cameBackAt: '2026-08-26T09:00:00Z' });
    expect(orderCallbacks([old, recent]).map((r) => r.contactId)).toEqual(['b', 'a']);
  });

  it('is newest first once no calls were missed', () => {
    const a = row({ contactId: 'a', cameBackAt: '2026-08-26T09:00:00Z' });
    const b = row({ contactId: 'b', kind: 'email', cameBackAt: '2026-08-26T11:00:00Z' });
    expect(orderCallbacks([a, b]).map((r) => r.contactId)).toEqual(['b', 'a']);
  });

  it('does not mutate what it was given', () => {
    const rows = [row({ contactId: 'a' }), row({ contactId: 'b', kind: 'call', missed: true })];
    orderCallbacks(rows);
    expect(rows.map((r) => r.contactId)).toEqual(['a', 'b']);
  });

  it('treats an ANSWERED inbound call as an ordinary event, not an emergency', () => {
    const answered = row({ contactId: 'a', kind: 'call', missed: false, cameBackAt: '2026-08-25T09:00:00Z' });
    const text = row({ contactId: 'b', cameBackAt: '2026-08-26T09:00:00Z' });
    expect(orderCallbacks([answered, text])[0].contactId).toBe('b');
  });
});

describe('wording', () => {
  it('says what they did in plain words', () => {
    expect(actionLabel(row({ kind: 'call', missed: true }))).toBe('missed call');
    expect(actionLabel(row({ kind: 'call', missed: false }))).toBe('called');
    expect(actionLabel(row({ kind: 'sms' }))).toBe('texted');
    expect(actionLabel(row({ kind: 'whatsapp' }))).toBe('WhatsApp');
    expect(actionLabel(row({ kind: 'email' }))).toBe('emailed');
  });

  it('labels the two kinds of person we chase, and nothing else', () => {
    expect(whoLabel(row({ leadType: 'builder' }))).toBe('Builder');
    expect(whoLabel(row({ leadType: 'estate_agent' }))).toBe('Agent');
    expect(whoLabel(row({ leadType: null }))).toBeNull();
  });

  it('does not print the phone number twice for a nameless contact', () => {
    expect(displayName(row({ name: '+447700900001', phone: '+447700900001' })))
      .toBe('+447700900001');
    expect(displayName(row({ name: '', phone: '+447700900001' })))
      .toBe('+447700900001');
  });

  it('reads as a sentence when it is empty, and it is never blank', () => {
    expect(headline([])).toBe('Nobody is waiting on us');
  });

  it('names the first person and counts the rest', () => {
    const now = Date.parse('2026-08-26T15:00:00Z');
    const out = headline([
      row({ contactId: 'jl', name: 'JL BRICKWORK', kind: 'call', missed: true, cameBackAt: '2026-08-26T14:40:00Z' }),
      row({ contactId: 'b', name: 'Fox Built', kind: 'whatsapp', cameBackAt: '2026-08-26T14:55:00Z' }),
    ], now);
    expect(out).toBe('JL BRICKWORK missed call, 20m ago and 1 other');
  });

  it('pluralises the others', () => {
    const now = Date.parse('2026-08-26T15:00:00Z');
    const out = headline([
      row({ contactId: 'a', name: 'One', cameBackAt: '2026-08-26T14:00:00Z' }),
      row({ contactId: 'b', name: 'Two', cameBackAt: '2026-08-26T13:00:00Z' }),
      row({ contactId: 'c', name: 'Three', cameBackAt: '2026-08-26T12:00:00Z' }),
    ], now);
    expect(out).toContain('and 2 others');
  });

  it('carries no long dash, curly quote or ellipsis, anywhere', () => {
    const src = readFileSync('src/features/crm/lib/callbackList.ts', 'utf8')
      + readFileSync('src/features/crm/components/followups/CallbackBanner.tsx', 'utf8');
    expect(src).not.toMatch(/[–—‘’“”…]/);
  });

  it('ages honestly', () => {
    const now = Date.parse('2026-08-26T15:00:00Z');
    expect(agoLabel('2026-08-26T15:00:00Z', now)).toBe('just now');
    expect(agoLabel('2026-08-26T14:30:00Z', now)).toBe('30m ago');
    expect(agoLabel('2026-08-26T12:00:00Z', now)).toBe('3h ago');
    expect(agoLabel('2026-08-24T15:00:00Z', now)).toBe('2d ago');
  });
});

describe('tone', () => {
  it('goes red only for a missed call', () => {
    expect(tone([row({ kind: 'call', missed: true })])).toBe('missed');
    expect(tone([row({ kind: 'sms' })])).toBe('waiting');
    expect(tone([])).toBe('clear');
  });
});

describe('the banner is on screen even when there is nothing on it', () => {
  // Hugo asked for this in as many words. A strip that only appears when
  // something is wrong is a strip nobody looks at, because its absence and its
  // failure look the same.
  const BANNER = readFileSync('src/features/crm/components/followups/CallbackBanner.tsx', 'utf8');
  const LAYOUT = readFileSync('src/features/crm/layout/Smsv2Layout.tsx', 'utf8');

  it('never returns null', () => {
    expect(BANNER).not.toMatch(/return null/);
  });

  it('says something calm rather than nothing when the list is empty', () => {
    expect(BANNER).toMatch(/Nothing to call back/);
  });

  it('is mounted in the CRM layout, above the follow-up banner', () => {
    expect(LAYOUT).toMatch(/<CallbackBanner \/>/);
    expect(LAYOUT.indexOf('<CallbackBanner />')).toBeLessThan(LAYOUT.indexOf('<FollowupBanner />'));
  });

  it('pushes the full-screen call room down by its own height', () => {
    const live = readFileSync('src/features/crm/components/live-call/LiveCallScreen.tsx', 'utf8');
    const pads = live.match(/paddingTop: '[^']+'/g) ?? [];
    expect(pads.length).toBeGreaterThan(0);
    for (const p of pads) expect(p).toContain('--callback-banner-h');
  });
});

describe('the database rule about who may appear', () => {
  const SQL = readFileSync('supabase/migrations/20260826000001_callbacks_open.sql', 'utf8');

  it('requires something of OURS to have gone out BEFORE they came back', () => {
    // This one line is the whole "no marketing emails" rule. It is a rule about
    // history, not a list of senders, so nothing needs maintaining as new
    // spammers appear.
    expect(SQL).toMatch(/ours\.first_at\s*<\s*n\.at/);
  });

  it('counts an inbound CALL, not only a message', () => {
    expect(SQL).toMatch(/'call'\s+as kind/);
    expect(SQL).toMatch(/c\.direction = 'inbound'/);
  });

  it('matches an inbound call on the number as well as on contact_id', () => {
    // wk_calls.contact_id was set on 14 of 145 inbound legs over thirty days,
    // so a contact_id-only join would miss almost every callback.
    expect(SQL).toMatch(/left join wk_contacts ct on ct\.phone = c\.from_e164/);
    expect(SQL).toMatch(/coalesce\(c\.contact_id, ct\.id\)/);
  });

  it('lets a dialled call count as having contacted them, answered or not', () => {
    // "Did we contact them" and "did we answer them" are different questions
    // and the migration keeps two separate CTEs for exactly that reason.
    expect(SQL).toMatch(/ever_ours as \(/);
    expect(SQL).toMatch(/answered_by_us as \(/);
  });

  it('only counts a real conversation as having answered them', () => {
    expect(SQL).toMatch(/coalesce\(c\.duration_sec, 0\) >= 20/);
  });

  it('shares the inbox suppression table, so Answered clears both places', () => {
    expect(SQL).toMatch(/wk_thread_attention/);
    expect(SQL).toMatch(/att\.handled_at/);
  });

  it('stores no boolean that a send path could forget to clear', () => {
    expect(SQL).not.toMatch(/alter table wk_calls add column/i);
    expect(SQL).toMatch(/greatest\(/);
  });

  it('keeps the retired creator funnel out', () => {
    expect(SQL).toMatch(/<> 'heypubli'/);
  });
});
