// The builder automation is OFF, and this test is what keeps it off.
//
// Hugo, 2026-08-25, showing an inbox with 133 "No builder for Wednesday 26
// August at 2:30pm" emails on one screen, 73 of them about a single viewing:
//
//   "Stop all this email notification and whatsapp for the builder, no more
//    whatsapp automation for builders."
//
// The escalation pass in api/cron/builder-brain.ts had no memory. It re-asked
// on every run, every two minutes from 6am to 10pm, for every viewing without a
// confirmed builder, so one unanswered viewing produced dozens of identical
// emails and WhatsApp messages a day.
//
// Same shape as tests/property-no-ai-calls.test.ts, and for the same reason:
// deleting a schedule is a thing somebody re-adds six weeks later without
// knowing why it went. A failing test explains itself.
//
// WHAT THIS DOES NOT TOUCH: the Find Builders desk at
// /admin/crm/find-builders, where a human picks a builder and presses send.
// Hugo asked to stop the automation, not the ability to message a builder.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const RETIRED_CRONS = [
  'api/cron/builder-outreach.ts',
  'api/cron/builder-brain.ts',
  'api/cron/builder-morning.ts',
];

describe('builder automation stays retired', () => {
  const vercel = JSON.parse(read('vercel.json')) as { crons: { path: string }[] };

  it('registers no builder cron on any schedule', () => {
    const builder = vercel.crons.filter((c) => /builder/i.test(c.path));
    expect(builder, `these would start emailing again: ${builder.map((c) => c.path).join(', ')}`)
      .toEqual([]);
  });

  it('makes every retired builder cron refuse even when called by hand', () => {
    // An unscheduled cron is still one curl away, and the whole point is that
    // this cannot come back by accident.
    for (const path of RETIRED_CRONS) {
      const src = read(path);
      expect(src, `${path} should answer 410`).toContain('res.statusCode = 410');
      expect(src, `${path} should say why`).toMatch(/RETIRED 2026-08-25/);
    }
  });

  it('still runs the refurb reader, which is what replaced the press', () => {
    // Hugo, the same day: "when the property gets transferred to the estimator,
    // please make sure it is already read, instead of waiting for me to press
    // read." That sweep must stay scheduled.
    expect(vercel.crons.some((c) => c.path === '/api/cron/refurb-read')).toBe(true);
  });

  it('keeps the Find Builders desk, which is a human pressing send', () => {
    const desk = read('api/crm/find-builders.ts');
    expect(desk).toContain('sendOutreachRow');
  });
});
