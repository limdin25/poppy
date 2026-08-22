// The channel the machine uses to ask Hugo and Pedro a question.
//
// The rules under test are all rules somebody else enforces and we cannot see:
// Meta's, about what a template variable may contain and how a template may
// end. Getting one wrong does not throw, it gets the template rejected days
// later, or gets the message accepted by Twilio and never delivered.

import { describe, it, expect } from 'vitest';
import {
  parseOpsContacts, matchOpsContact, sendablePhone, reachable, unreachable, templateVar,
} from '../api/lib/ops-contacts.js';
import { OPS_QUERY_TEMPLATE_TEXT, OPS_QUERY_TEMPLATE_NAME } from '../api/lib/ops-query.js';

const SHIPPED = JSON.stringify({
  enabled: true,
  contacts: [
    { name: 'Hugo', phone: '+447863992555', role: 'owner' },
    { name: 'Pedro', phone: '', role: 'caller' },
  ],
});

describe('who the machine may interrupt', () => {
  it('reads the settings row as shipped', () => {
    const ops = parseOpsContacts(SHIPPED);
    expect(ops.enabled).toBe(true);
    expect(ops.contacts.map((c) => c.name)).toEqual(['Hugo', 'Pedro']);
  });

  it('takes the object form too, since platform_settings values are not all strings', () => {
    const ops = parseOpsContacts({ enabled: true, contacts: [{ name: 'Hugo', phone: '07863992555' }] });
    expect(reachable(ops)[0].e164).toBe('+447863992555');
  });

  it('a broken settings row is empty, never a crash and never a guess', () => {
    for (const junk of ['', '{not json', null, undefined, 42]) {
      expect(parseOpsContacts(junk).contacts).toEqual([]);
    }
  });

  it('SOMEBODY WITH NO NUMBER IS SKIPPED AND NAMED, never invented', () => {
    const ops = parseOpsContacts(SHIPPED);
    expect(reachable(ops).map((c) => c.name)).toEqual(['Hugo']);
    expect(unreachable(ops).map((c) => c.name)).toEqual(['Pedro']);
  });

  it('switched off means nobody, and the caller has to notice', () => {
    expect(parseOpsContacts('{"enabled":false,"contacts":[]}').enabled).toBe(false);
  });
});

describe('recognising one of ours on the way in', () => {
  const ops = parseOpsContacts(SHIPPED);

  it('matches however the number was written down', () => {
    for (const form of ['+447863992555', '447863992555', '07863992555', '+44 7863 992555']) {
      expect(matchOpsContact(ops, form)?.name).toBe('Hugo');
    }
  });

  it('a builder is not one of ours', () => {
    expect(matchOpsContact(ops, '+447790496576')).toBeNull();
  });

  it('rubbish never matches, which is what keeps a lead out of the ops path', () => {
    for (const junk of ['', '123', 'not a phone']) {
      expect(matchOpsContact(ops, junk)).toBeNull();
    }
  });

  it('an entry with no number cannot be matched by an empty one', () => {
    expect(matchOpsContact(ops, '')).toBeNull();
  });
});

describe('sendablePhone', () => {
  it('normalises a UK mobile written any of the usual ways', () => {
    expect(sendablePhone('07863992555')).toBe('+447863992555');
    expect(sendablePhone('+44 7863 992555')).toBe('+447863992555');
  });

  it('refuses anything it cannot dial', () => {
    for (const junk of ['', 'x', '0786', '++4478']) expect(sendablePhone(junk)).toBeNull();
  });
});

describe('Meta template rules', () => {
  it('the variable never carries a newline, a tab, or a run of spaces', () => {
    const v = templateVar('the viewing at\n10, Stevenson Avenue\t\tLeyland     PR25 4GQ');
    expect(v).not.toMatch(/[\r\n\t]/);
    expect(v).not.toMatch(/\s{2,}/);
  });

  it('an empty variable would have the send rejected outright, so it never is', () => {
    expect(templateVar('')).toBeTruthy();
    expect(templateVar('   ')).toBeTruthy();
  });

  it('a long variable is cut rather than shipped as a paragraph', () => {
    expect(templateVar('x'.repeat(400), 90).length).toBeLessThanOrEqual(90);
  });

  it('THE BODY DOES NOT END ON A VARIABLE, which is a real rejection (subCode 2388299)', () => {
    expect(OPS_QUERY_TEMPLATE_TEXT.trim()).not.toMatch(/\{\{\d+\}\}[\s.,!?]*$/);
  });

  it('the body carries {{1}} and {{2}}, numbered from one with no gaps', () => {
    const nums = [...OPS_QUERY_TEMPLATE_TEXT.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect([...new Set(nums)].sort()).toEqual([1, 2]);
  });

  it('carries none of the punctuation Hugo banned', () => {
    expect(OPS_QUERY_TEMPLATE_TEXT).not.toMatch(/[–—‘’“”…]/);
  });

  it('the name is one Meta will accept', () => {
    expect(OPS_QUERY_TEMPLATE_NAME).toMatch(/^[a-z0-9_]{1,512}$/);
  });

  it('says what it is about rather than being an opaque nudge', () => {
    expect(OPS_QUERY_TEMPLATE_TEXT.toLowerCase()).toContain('unico');
    expect(OPS_QUERY_TEMPLATE_TEXT.toLowerCase()).toContain('reply');
  });
});
