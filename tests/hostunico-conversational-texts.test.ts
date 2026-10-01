import { describe, it, expect } from 'vitest';
import { reportSms } from '../api/lib/hostunico-report';
import { HOSTUNICO_FOLLOWUP, hostunicoFollowupSms } from '../src/core/hostunicoFollowup';
import { explicitOptOut } from '../api/lib/hostunico-reply-intent';
import { nonGsm7 } from '../api/lib/sms-charset';
import { hostunicoNeedsName } from '../supabase/functions/_shared/hostunico-contact-name';
import { hostunicoCallStep } from '../supabase/functions/_shared/hostunico-call-step';

describe('conversational report sharing', () => {
  it('keeps the link and a single light invitation without opt-out boilerplate', () => {
    const url = 'https://hostunico.com/r/Ab1c2';
    for (const area of [false,true]) {
      const text = reportSms(url,area);
      expect(text).toBe(`Hi, here's your Hostunico ${area ? 'area estimate' : 'property report'}: ${url}\nLet me know what you think.`);
      expect(nonGsm7(text)).toEqual([]);
      expect(text.length).toBeLessThanOrEqual(160);
    }
  });
  it('previews the same follow-up wording that is sent, with no STOP footer', () => {
    for (const step of HOSTUNICO_FOLLOWUP.steps) {
      const text = hostunicoFollowupSms(step.text);
      expect(text).toContain(step.text);
      expect(text).not.toMatch(/opt out|STOP|walkthrough|onboarding/);
      expect(nonGsm7(text)).toEqual([]);
    }
    expect(HOSTUNICO_FOLLOWUP.steps.slice(1).every((step) => !step.approved)).toBe(true);
    expect(explicitOptOut('STOP')).toBe(true);
    expect(explicitOptOut("Don't text me again")).toBe(true);
  });
});

describe('ask for a missing personal name at a natural point', () => {
  it.each(['', 'Student', 'Landlord', 'Acme Properties Ltd', 'studio in Leeds', '07123456789'])('asks when the contact only has %s', (name) => {
    expect(hostunicoNeedsName(name)).toBe(true);
  });
  it.each(['Pedro', 'Jane Smith', 'Hugo - test call'])('does not ask again for %s', (name) => {
    expect(hostunicoNeedsName(name)).toBe(false);
  });
  it('waits until report permission and never interrupts the opening with a name check', () => {
    const input = { mode: 'spareroom', latestCaller: 'Yes please', leadName: 'Student', report: null, transcript: [{ speaker: 'agent', body: 'Would you like me to send you the report?' }] };
    expect(hostunicoCallStep(input)).toBe("SAY: Of course.\nASK: By the way, what's your name?");
    expect(hostunicoCallStep({ ...input, leadName: 'Jane' })).toBeNull();
    expect(hostunicoNeedsName('Student', [{speaker:'agent',body:"By the way, what's your name?"}])).toBe(false);
    expect(hostunicoNeedsName('Student', [{speaker:'caller',body:'My name is Jane'}])).toBe(false);
    expect(hostunicoCallStep({ ...input, transcript: [{ speaker: 'agent', body: 'Is it still available?' }] })).toBeNull();
  });
});
