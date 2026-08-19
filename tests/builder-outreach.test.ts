// The outreach engine's pure half, plus the pins that keep the risky parts
// honest: the invite text must pass the same validation the WhatsApp admin
// panel enforces (or Meta submission fails on day one), a blocked draft must
// never send, and the confirm press is the ONE road into 'Viewing booked'.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  OUTREACH_DEFAULTS, loadOutreachSettingsFrom, viewingTimeLabel,
  blockedReasonFor, inviteVars, renderPreview, ukDay,
  INVITE_TEMPLATE_TEXT, MORNING_TEMPLATE_TEXT, VIEWING_BOOKED_COLUMN,
} from '../api/lib/builder-outreach.js';
import { templateProblem, extractTemplateVars, prefillTemplateVars } from '../src/features/crm/lib/waTemplates.js';

const SRC = readFileSync('api/lib/builder-outreach.ts', 'utf8');

describe('the invite template', () => {
  it('passes the same validation the WhatsApp admin panel enforces', () => {
    expect(templateProblem('builder_viewing_invite', INVITE_TEMPLATE_TEXT)).toBeNull();
  });
  it('uses vars 1..3 with no gaps and neither starts nor ends on a blank', () => {
    expect(extractTemplateVars(INVITE_TEMPLATE_TEXT)).toEqual(['1', '2', '3']);
    expect(/^\{\{/.test(INVITE_TEMPLATE_TEXT)).toBe(false);
    expect(/\}\}$/.test(INVITE_TEMPLATE_TEXT)).toBe(false);
  });
  it('renders the preview a human reads before approving', () => {
    // Hugo's own wording, 2026-08-20: "we need something simpler."
    const body = renderPreview(INVITE_TEMPLATE_TEXT, {
      '1': 'Pedro', '2': '12 High Street, Wigan', '3': 'Thursday 21 August at 2:30pm',
    });
    expect(body).toContain('this is Pedro');
    expect(body).toContain('give us a quote at 12 High Street, Wigan');
    expect(body).not.toContain('{{');
  });
});

describe('the 8am morning confirmation', () => {
  it('passes the same validation, and Meta will not take a trailing variable', () => {
    expect(templateProblem('builder_viewing_morning', MORNING_TEMPLATE_TEXT)).toBeNull();
    // The lesson from 20 Aug: a body ending on a blank was REJECTED by Meta
    // even with punctuation after it, so this one closes on a word.
    expect(MORNING_TEMPLATE_TEXT.trim().endsWith('.')).toBe(true);
    expect(/\{\{\d+\}\}\W*$/.test(MORNING_TEMPLATE_TEXT.trim())).toBe(false);
  });
  it('NEVER greets by name: the roster holds companies, not people', () => {
    // Hugo, 2026-08-20: "we cannot have the name". "Good morning MH Building &
    // Roofing Services Ltd" is a mail merge, not a message.
    expect(extractTemplateVars(MORNING_TEMPLATE_TEXT)).toEqual(['1']);
    expect(MORNING_TEMPLATE_TEXT).toContain('Good morning, just want to confirm');
    const body = renderPreview(MORNING_TEMPLATE_TEXT, { '1': 'Oundle Road' });
    expect(body).toBe('Good morning, just want to confirm we are still good for the viewing today at Oundle Road. Thanks.');
  });
  it('the day is UK wall time, so a late-evening viewing is not tomorrow', () => {
    // 23:30 UTC on 20 Aug is 00:30 on the 21st in London (BST).
    expect(ukDay(new Date('2026-08-20T23:30:00Z'))).toBe('2026-08-21');
    expect(ukDay(new Date('2026-08-20T09:00:00Z'))).toBe('2026-08-20');
  });
  it('stamps before sending, so a lost response cannot double-text at 8:05', () => {
    const stampAt = SRC.indexOf('morning_sent_at: new Date().toISOString()');
    const sendAt = SRC.indexOf('ContentSid: sid');
    expect(stampAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(stampAt);
  });
});

describe('viewingTimeLabel', () => {
  it('formats UK wall time, never the server timezone', () => {
    // 13:30 UTC in August is 14:30 in London (BST).
    expect(viewingTimeLabel('2026-08-20T13:30:00Z')).toBe('Thursday 20 August at 2:30pm');
  });
  it('an unparseable time renders empty rather than "Invalid Date" to a builder', () => {
    expect(viewingTimeLabel('not a date')).toBe('');
  });
});

describe('blockedReasonFor', () => {
  const settings = { ...OUTREACH_DEFAULTS, invite_sid: `HX${'0'.repeat(32)}` };
  const prop = { id: 'p1', address: '12 High St, Wigan WN1 1AA', viewing_at: '2026-08-20T13:30:00Z' };
  it('no viewing time blocks the draft, in words the panel shows verbatim', () => {
    expect(blockedReasonFor({ ...prop, viewing_at: null }, settings)).toBe('no_viewing_time');
    expect(blockedReasonFor({ ...prop, viewing_at: '' }, settings)).toBe('no_viewing_time');
  });
  it('a missing or malformed template sid blocks the draft', () => {
    expect(blockedReasonFor(prop, { ...settings, invite_sid: '' })).toBe('template_pending');
    expect(blockedReasonFor(prop, { ...settings, invite_sid: 'not-a-sid' })).toBe('template_pending');
  });
  it('both present means the draft may send', () => {
    expect(blockedReasonFor(prop, settings)).toBeNull();
  });
});

describe('settings', () => {
  it('defaults are manual-first with a daily cap: the auto/manual gate is a flag, not a fork', () => {
    expect(OUTREACH_DEFAULTS.auto_send).toBe(false);
    expect(OUTREACH_DEFAULTS.daily_cap).toBeGreaterThan(0);
  });
  it('bad JSON in platform_settings falls back to the defaults', () => {
    expect(loadOutreachSettingsFrom('not json')).toEqual(OUTREACH_DEFAULTS);
    expect(loadOutreachSettingsFrom('{"auto_send":true}').auto_send).toBe(true);
  });
});

describe('inviteVars', () => {
  it('fills sender, address and UK-time viewing slot', () => {
    const vars = inviteVars({ id: 'p1', address: ' 12 High St ', viewing_at: '2026-08-20T13:30:00Z' });
    expect(vars['2']).toBe('12 High St');
    expect(vars['3']).toBe('Thursday 20 August at 2:30pm');
  });
});

describe('pins on the send and confirm paths', () => {
  it('a blocked draft can never reach Twilio', () => {
    // sendOutreachRow refuses on blocked_reason before any network call.
    expect(SRC).toMatch(/if \(r\.blocked_reason\) return/);
  });
  it('template approval is verified with a synchronous GET before spending', () => {
    expect(SRC).toContain('/ApprovalRequests');
    expect(SRC).toMatch(/waStatus !== 'approved'/);
  });
  it('the message row goes in BEFORE the wire call, the ai-reply double-send rule', () => {
    const insertAt = SRC.indexOf("status: 'sending'");
    const twilioAt = SRC.indexOf('api.twilio.com/2010-04-01');
    expect(insertAt).toBeGreaterThan(-1);
    expect(twilioAt).toBeGreaterThan(insertAt);
  });
  it('the do-not-text tag blocks a builder send like every other send path', () => {
    expect(SRC).toContain("'do-not-text'");
  });
  it('confirm moves the branch card into Viewing booked, on its own board only', () => {
    expect(VIEWING_BOOKED_COLUMN).toBe('Viewing booked');
    expect(SRC).toContain("pipelineId ? q.eq('pipeline_id', pipelineId) : q");
    expect(SRC).toContain("stage_move_source: 'agent'");
  });
  it('only UK mobiles are drafted: WhatsApp cannot reach a landline', () => {
    expect(SRC).toMatch(/isUkMobile/);
  });
});

describe('sending a template by hand when the 24h window is shut', () => {
  it('fills the blanks from the thread, so nobody retypes an address', () => {
    // Hugo, 2026-08-20: by Friday the builder has not written in 24 hours, so
    // the approved template IS the message and the picker has to arrive
    // filled in. Meaning comes from the words before the blank, because a
    // Meta template numbers its variables and names nothing.
    const vars = prefillTemplateVars(MORNING_TEMPLATE_TEXT, {
      person: 'Dave', address: 'Oundle Road, Birmingham', viewingTime: 'Friday at 2:00pm', sender: 'Pedro',
    });
    expect(vars).toEqual({ '1': 'Oundle Road, Birmingham' });
  });

  it('reads all three roles out of the invite template', () => {
    const vars = prefillTemplateVars(INVITE_TEMPLATE_TEXT, {
      person: 'Dave', address: '12 High St', viewingTime: 'Friday at 2:00pm', sender: 'Pedro',
    });
    expect(vars).toEqual({ '1': 'Pedro', '2': '12 High St', '3': 'Friday at 2:00pm' });
  });

  it('leaves an unrecognised blank EMPTY rather than guessing', () => {
    // A blank box is a question. A wrong address is a builder at the wrong
    // house, so nothing is invented to fill a gap.
    const vars = prefillTemplateVars('Your reference is {{1}} and the code is {{2}}.', {
      person: 'Dave', address: '12 High St',
    });
    expect(vars['2']).toBe('');
  });

  it('keeps the old behaviour for templates that predate the rule', () => {
    // {{1}} with no lead-in is still the person being written to.
    expect(prefillTemplateVars('Hi {{1}}, quick question about your listing.', { person: 'Dave' }))
      .toEqual({ '1': 'Dave' });
  });
});
