import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseLeadForm,
  displayName,
  isPlaceholderName,
} from '../src/core/heypubli/lead-form';

// Facebook lead ads drop the person straight into WhatsApp with a filled-in
// form as their first message. Real bodies, copied out of wk_sms_messages on
// 2026-08-07:
//
//   Hello! I filled out your form and would like to know more about your business.
//
//   Phone number: +919305415993
//   First name: lakshmi
//
// The CRM never read a word of it, so every one of those leads sat in the
// inbox as its own phone number. That is what this parser is for.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const FORM_NAME_FIRST =
  'Hello! I filled out your form and would like to know more about your business.\n\nFirst name: lakshmi\nPhone number: +919305415993';
const FORM_PHONE_FIRST =
  'Hello! I filled in your form and would like to know more about your business.\n\nPhone number: +918731845745\nFirst name: Samuel\nEmail: sfanai380@gmail.com';
const FORM_BENGALI =
  'হ্যালো! আমি\n\nPhone number: +8801788120101\nFirst name: SH Shakil\nEmail: shshakil00383@gmail.com';

// The two real rows the first backfill run got wrong. Both bodies copied
// verbatim out of wk_sms_messages on 2026-08-07.
const FORM_GREETING =
  'Hello! I filled in your form and would like to know more about your business.\n\nFirst name: Hi\nPhone number: +918281191545';
const FORM_BIO =
  'Hello! I filled in your form and would like to know more about your business.\n\nFirst name: RISHVANTH RAM KOUSHIK| REEL CREATOR| BGMS |\nPhone number: +917989848576\nEmail: rishvanthramk@gmail.com';

describe('parseLeadForm', () => {
  it('reads the first name out of a lead-ad message', () => {
    expect(parseLeadForm(FORM_NAME_FIRST).firstName).toBe('lakshmi');
  });

  it('does not care which order Facebook puts the fields in', () => {
    const p = parseLeadForm(FORM_PHONE_FIRST);
    expect(p.firstName).toBe('Samuel');
    expect(p.email).toBe('sfanai380@gmail.com');
  });

  it('reads the fields even when the greeting is in another language', () => {
    // The greeting line follows the lead's own Facebook locale, the field
    // labels do not. Anchoring on the greeting would have lost every
    // Bengali and Hindi lead, which is most of them.
    const p = parseLeadForm(FORM_BENGALI);
    expect(p.firstName).toBe('SH Shakil');
    expect(p.email).toBe('shshakil00383@gmail.com');
  });

  it('returns nulls for an ordinary message, so nothing is invented', () => {
    expect(parseLeadForm('I am interested')).toEqual({ firstName: null, email: null });
    expect(parseLeadForm('')).toEqual({ firstName: null, email: null });
  });

  it('takes no email when the form carried none', () => {
    expect(parseLeadForm(FORM_NAME_FIRST).email).toBeNull();
  });

  it('refuses an email-shaped nothing rather than storing junk', () => {
    expect(parseLeadForm('Email: not-an-address').email).toBeNull();
  });

  it('ignores a blank field rather than storing an empty name', () => {
    expect(parseLeadForm('First name: \nEmail: a@b.com').firstName).toBeNull();
  });

  it('never lets a runaway line become a name', () => {
    // A pasted essay after "First name:" is not a name. Cap it rather than
    // writing 400 characters into the contact header.
    expect(parseLeadForm(`First name: ${'x'.repeat(400)}`).firstName).toBeNull();
  });

  it('refuses a greeting typed into the name box', () => {
    // Contact +919495068152 really was renamed "Hi", and then really was
    // texted "Hi Hi, Maria from HeyPubli here". The phone number was a better
    // name than that, so nothing at all is better than either.
    expect(parseLeadForm(FORM_GREETING).firstName).toBeNull();
    for (const g of ['hi', 'Hii', 'HELLO', 'hey', 'ok', 'yes', 'sir', 'thanks', 'test']) {
      expect(parseLeadForm(`First name: ${g}`).firstName, g).toBeNull();
    }
  });

  it('keeps a real name that happens to be short', () => {
    // The greeting rule must not eat somebody's actual name.
    for (const n of ['Sam', 'Li', 'Anu', 'Raj', 'Yes-Ann']) {
      expect(parseLeadForm(`First name: ${n}`).firstName, n).toBe(n);
    }
  });

  it('drops the Instagram bio somebody pasted after their name', () => {
    // Contact +917989848576 was named "Rishvanth Ram Koushik| Reel Creator|
    // Bgms |". The pipe is the giveaway: it is a bio, not a name. Everything
    // from the first pipe on is thrown away.
    const p = parseLeadForm(FORM_BIO);
    expect(p.firstName).toBe('RISHVANTH RAM KOUSHIK');
    expect(displayName(p.firstName!)).toBe('Rishvanth Ram Koushik');
    expect(p.email).toBe('rishvanthramk@gmail.com');
  });

  it('never lets a pipe reach a contact name', () => {
    expect(parseLeadForm(FORM_BIO).firstName).not.toContain('|');
    // Nothing usable in front of the pipe means nothing is written.
    expect(parseLeadForm('First name: | Reel Creator |').firstName).toBeNull();
  });

  it('wants letters, not punctuation or emoji, before it calls it a name', () => {
    expect(parseLeadForm('First name: ...').firstName).toBeNull();
    expect(parseLeadForm('First name: 🔥🔥').firstName).toBeNull();
  });
});

describe('displayName', () => {
  it('title-cases the lowercase names Facebook sends', () => {
    expect(displayName('lakshmi')).toBe('Lakshmi');
    expect(displayName('prem')).toBe('Prem');
  });

  it('brings ALL CAPS back down', () => {
    expect(displayName('LAXMAN')).toBe('Laxman');
    expect(displayName('NAYAN ROY')).toBe('Nayan Roy');
  });

  it('leaves a name somebody already cased alone', () => {
    // Mixed case is a decision somebody made. McDonald must not become
    // Mcdonald, and the handle-style names people type into the form
    // ("Iam___sooraj__10") must survive untouched.
    expect(displayName('Nayan Roy')).toBe('Nayan Roy');
    expect(displayName('McDonald')).toBe('McDonald');
    expect(displayName('Iam___sooraj__10')).toBe('Iam___sooraj__10');
  });

  it('leaves non-Latin script alone', () => {
    expect(displayName('স্বপ্ন')).toBe('স্বপ্ন');
  });

  it('collapses the whitespace a copy-paste drags in', () => {
    expect(displayName('  ravindra   kumar ')).toBe('Ravindra Kumar');
  });
});

describe('isPlaceholderName', () => {
  const phone = '+919305415993';

  it('calls the auto-created phone-number name a placeholder', () => {
    // wk-sms-incoming inserts name = the E.164 it just received. That is not
    // a name anybody chose, so overwriting it is safe.
    expect(isPlaceholderName('+919305415993', phone)).toBe(true);
    expect(isPlaceholderName('919305415993', phone)).toBe(true);
    expect(isPlaceholderName('whatsapp:+919305415993', phone)).toBe(true);
  });

  it('calls an empty name a placeholder', () => {
    expect(isPlaceholderName('', phone)).toBe(true);
    expect(isPlaceholderName(null, phone)).toBe(true);
    expect(isPlaceholderName('   ', phone)).toBe(true);
  });

  it('never calls a real name a placeholder', () => {
    // The rule Hugo set: a name somebody typed is never overwritten.
    expect(isPlaceholderName('Lakshmi', phone)).toBe(false);
    expect(isPlaceholderName('Carters Plumbing Ltd', phone)).toBe(false);
  });

  it('treats any bare run of digits as a placeholder, whatever number it is', () => {
    // Old rows were created from a different variant of the same number.
    expect(isPlaceholderName('+44 7426 495169', phone)).toBe(true);
  });
});

describe('the wk-sms-incoming mirror', () => {
  // A Deno edge function cannot import from src/, so the parser is written
  // twice on purpose, exactly like uk-places.ts and its .mjs twin. These
  // assertions are what stop the two drifting apart in silence.
  const fn = read('supabase/functions/wk-sms-incoming/index.ts');

  const shared = read('src/core/heypubli/lead-form.ts');

  it('parses the lead form on ingest', () => {
    expect(fn).toContain('parseLeadForm(body)');
  });

  it('carries character-for-character the same field patterns', () => {
    // The three lines that decide what gets read. Copy them wrong in either
    // file and the two stop agreeing, which is the whole failure mode a
    // hand-written twin has.
    for (const pattern of [
      String.raw`/^[^\S\n]*First\s*name[^\S\n]*:[^\S\n]*(.*)$/im`,
      String.raw`/^[^\S\n]*Email[^\S\n]*:[^\S\n]*(.*)$/im`,
      String.raw`/^[^\s@]+@[^\s@.]+\.[^\s@]+$/`,
    ]) {
      expect(shared).toContain(pattern);
      expect(fn).toContain(pattern);
    }
  });

  it('caps a runaway name at the same length in both files', () => {
    expect(shared).toContain('MAX_NAME = 60');
    expect(fn).toContain('MAX_LEAD_NAME = 60');
  });

  it('never overwrites a name somebody already set', () => {
    expect(fn).toContain('isPlaceholderName(wkContactRow?.name');
    // The same two rules, both files: a bare run of digits is a placeholder,
    // and so is a name equal to the contact's own number.
    for (const rule of [String.raw`/^\d{5,}$/.test(bare)`, 'bare === p']) {
      expect(shared).toContain(rule);
      expect(fn).toContain(rule);
    }
  });

  it('fills gaps only, never clobbering an email we already hold', () => {
    expect(fn).toContain("if (leadForm.email && !wkContactRow?.email) patch.email");
  });

  it('throws away the pipe and the greetings in both files', () => {
    // The live webhook is the path that named a contact "Hi" in the first
    // place. Tightening only the shared module would leave it doing it again
    // on the next lead ad.
    for (const rule of ['GREETING_WORDS', "split('|')[0]"]) {
      expect(shared, rule).toContain(rule);
      expect(fn, rule).toContain(rule);
    }
  });
});

describe('the backfill script', () => {
  // scripts/backfill-lead-names.mjs. It has already been run once. It rewrites
  // contact names in the SHARED CRM, which also holds Reviews customers and
  // receptionist customers, so what it is allowed to touch matters more than
  // what it does.
  const script = read('scripts/backfill-lead-names.mjs');

  it('can only ever reach HeyPubli contacts', () => {
    // Before: any inbound message anywhere containing "First name". A Reviews
    // client forwarding a form would have had their contact renamed.
    expect(script).toContain("custom_fields->>product=eq.heypubli");
    expect(script).toContain('contact_id=in.(');
  });

  it('is still dry by default', () => {
    expect(script).toContain("args.includes('--apply')");
    expect(script).toContain('DRY RUN');
  });

  it('carries the same name rules as the shared module', () => {
    for (const rule of ['GREETING_WORDS', "split('|')[0]", 'MAX_NAME = 60']) {
      expect(script, rule).toContain(rule);
    }
  });
});

describe('the repair script', () => {
  // The two rows the first backfill run wrote wrong. Dry by default, and Hugo
  // runs it himself after reading the plan.
  const repair = read('scripts/repair-lead-names.mjs');

  it('names the two phones it is allowed to touch and nothing else', () => {
    expect(repair).toContain('+919495068152');
    expect(repair).toContain('+917989848576');
  });

  it('is dry by default', () => {
    expect(repair).toContain("args.includes('--apply')");
    expect(repair).toContain('DRY RUN');
  });
});
