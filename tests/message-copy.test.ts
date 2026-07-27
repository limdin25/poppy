import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nonGsm7, toGsm7, smsSegments } from '../api/lib/sms-charset';

// Hugo 2026-07-27:
//   "improve the text we're gonna send with the video, say something like if
//    you have any question just shoot me a message at any time"
//   "you say you don't have a website when they don't have"
//   "make sure all the text is well formatted, with paragraphs and everything"
//   "no long dashes ever, we don't use. Make it a rule on the software."
//
// This file is that rule. It fails the build rather than trusting anyone to
// remember, because the cost of forgetting is not cosmetic: see sms-charset.ts.

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const load = async () => import('../api/lib/vsl-settings');

describe('the GSM-7 rule', () => {
  it('catches the em dash Hugo banned', () => {
    expect(nonGsm7('Here — look')).toEqual(['—']);
    expect(nonGsm7('Here, look')).toEqual([]);
  });

  it('catches the curly apostrophe too, which costs exactly as much', () => {
    expect(nonGsm7('the video’s only 90 seconds')).toEqual(['’']);
  });

  it('leaves the pound sign alone — it is in the table', () => {
    expect(nonGsm7('It is just £1 to start')).toEqual([]);
  });

  it('rewrites an em dash into punctuation, not into a hyphen', () => {
    // "Hi Jon - here's your video" reads like a bullet point. A comma reads
    // like a person.
    expect(toGsm7('Hi Jon — here is your video')).toBe('Hi Jon, here is your video');
    expect(nonGsm7(toGsm7('“Don’t — really…”'))).toEqual([]);
  });

  it('prices the difference, which is the whole argument', () => {
    const clean = 'x'.repeat(200);
    expect(smsSegments(clean)).toBe(2);
    // One em dash anywhere in those 200 characters costs a third segment.
    expect(smsSegments(`${'x'.repeat(199)}—`)).toBe(3);
  });
});

describe('every message we send a lead', () => {
  const messages = async () => {
    const { DEFAULT_VSL_SETTINGS: s } = await load();
    return [
      ['send_template', s.send_template],
      ['send_template_no_site', s.send_template_no_site],
      ...Object.entries(s.rules).map(([k, r]) => [`rules.${k}`, r.template] as [string, string]),
    ] as Array<[string, string]>;
  };

  it('contains no long dash and nothing else outside GSM-7', async () => {
    for (const [name, text] of await messages()) {
      expect(`${name}: ${nonGsm7(text).join('')}`).toBe(`${name}: `);
    }
  });

  it('is under three texts once a real name and URL are filled in', async () => {
    const { fillTemplate } = await load();
    for (const [name, tpl] of await messages()) {
      const filled = fillTemplate(tpl, {
        first: 'Jonathan',
        business: 'Carters Plumbing & Gas Ltd',
        url: 'https://heyelsie.com/carters-plumbing-and-gas-ltd',
        agent: 'Hugo',
      });
      expect(`${name}: ${smsSegments(filled)}`).toBe(`${name}: ${Math.min(smsSegments(filled), 2)}`);
    }
  });
});

describe('the message that carries the video', () => {
  it('invites a reply, in Hugo’s words', async () => {
    const { DEFAULT_VSL_SETTINGS: s } = await load();
    for (const t of [s.send_template, s.send_template_no_site]) {
      expect(t).toMatch(/any questions/i);
      expect(t).toMatch(/message me|reply/i);
    }
  });

  it('is laid out in paragraphs, not one run-on line', async () => {
    const { DEFAULT_VSL_SETTINGS: s } = await load();
    for (const t of [s.send_template, s.send_template_no_site]) {
      expect(t.split('\n\n').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('puts the link on its own line so it is tappable, not buried mid-sentence', async () => {
    const { DEFAULT_VSL_SETTINGS: s } = await load();
    for (const t of [s.send_template, s.send_template_no_site]) {
      expect(t).toMatch(/\n\{url\}/);
    }
  });

  it('tells a lead with no website why the audit starts on Google', async () => {
    const { DEFAULT_VSL_SETTINGS: s } = await load();
    expect(s.send_template_no_site).toMatch(/couldn't find a website/i);
    expect(s.send_template_no_site).toMatch(/Google/);
    // The offer was withdrawn on 2026-07-26. Mentioning the missing website
    // must never slide back into promising to build one.
    expect(s.send_template_no_site).not.toMatch(/free website|build you|make you a (new )?(site|website)/i);
    // …and the lead who HAS a website must not be told they haven't.
    expect(s.send_template).not.toMatch(/couldn't find a website/i);
  });
});

describe('fillTemplate keeps the layout it was given', () => {
  it('does not collapse the paragraph breaks into a single line', async () => {
    const { fillTemplate } = await load();
    // The old cleanup was /\s{2,}/g → ' ', and \s matches \n. It flattened
    // every paragraph the moment the template gained one.
    const out = fillTemplate('Hi {first},\n\nHere it is:\n{url}\n\nAny questions?', {
      first: 'Jon', url: 'https://x.test/a',
    });
    expect(out).toBe('Hi Jon,\n\nHere it is:\nhttps://x.test/a\n\nAny questions?');
  });

  it('still squeezes runs of spaces and the gap a missing name leaves', async () => {
    const { fillTemplate } = await load();
    expect(fillTemplate('Hi {first}, it is {agent}', { agent: 'Hugo' })).toBe('Hi, it is Hugo');
    expect(fillTemplate('a  b   c', {})).toBe('a b c');
  });

  it('drops a line that is left empty by a missing token', async () => {
    const { fillTemplate } = await load();
    // Three blank lines in a row is what a stripped token leaves behind, and a
    // lead reads that as a broken message.
    expect(fillTemplate('a\n\n{business}\n\nb', { business: '' })).not.toMatch(/\n{3}/);
  });
});

describe('the AI reply prompt', () => {
  const mig = read('supabase/migrations/20260727000012_no_em_dash.sql');

  it('bans the long dash in the model’s own output', () => {
    expect(mig).toMatch(/long dash|em dash/i);
  });

  it('does not itself contain one', () => {
    const prompt = mig.split('$prompt$')[1] ?? '';
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt).not.toContain('—');
  });
});
