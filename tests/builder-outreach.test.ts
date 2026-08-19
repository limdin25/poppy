// The outreach engine's pure half, plus the pins that keep the risky parts
// honest: the invite text must pass the same validation the WhatsApp admin
// panel enforces (or Meta submission fails on day one), a blocked draft must
// never send, and the confirm press is the ONE road into 'Viewing booked'.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  OUTREACH_DEFAULTS, loadOutreachSettingsFrom, viewingTimeLabel,
  blockedReasonFor, inviteVars, renderPreview,
  INVITE_TEMPLATE_TEXT, VIEWING_BOOKED_COLUMN,
} from '../api/lib/builder-outreach.js';
import { templateProblem, extractTemplateVars } from '../src/features/crm/lib/waTemplates.js';

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
    const body = renderPreview(INVITE_TEMPLATE_TEXT, {
      '1': 'Pedro', '2': '12 High Street, Wigan', '3': 'Thursday 21 August at 2:30pm',
    });
    expect(body).toContain('this is Pedro from Unico Property Group');
    expect(body).toContain('12 High Street, Wigan');
    expect(body).not.toContain('{{');
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
