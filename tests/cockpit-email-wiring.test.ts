// THE COCKPIT AND THE PIPELINE SEND THE SAME EMAIL (17 Aug 2026).
//
// Hugo, looking at one deal on two screens: "it half works in the pipeline but
// the information doesn't get crossed over to the cockpit, which is the main
// intelligence." He was exactly right. On Welwyn Park Road the pipeline modal
// offered leanne@movewithzest.co.uk with the evidence for it and carried the
// proof of funds; the cockpit's gate on the same deal said "there is no email
// address for this branch", carried no attachment, and opened "Hi Pedro"
// because the pinned note mentions Pedro.
//
// Root cause of all three: logic that only one surface could reach. The lookup
// lived inside an edge route, the proof-of-funds rule lived inside a React
// component, and the recipient was never passed to the drafter. These pins keep
// each of them in ONE place that both surfaces call.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { needsProofOfFunds } from '../api/lib/proof-of-funds';
import { firstNameFromEmail } from '../api/lib/branch-email-lookup';
import { fixGreeting, redactFigures } from '../api/lib/draft-guards';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('one branch-email lookup, both surfaces', () => {
  it('the lookup lives in a lib and the route delegates to it', () => {
    const route = read('api/crm/branch-emails.ts');
    expect(route).toMatch(/findBranchEmails\(supabase/);
    // The route must not keep its own copy of the query.
    expect(route).not.toMatch(/wrote_about_house/);
  });

  it('the cockpit gate and the cockpit read resolve the same address', () => {
    expect(read('api/crm/cockpit-action.ts')).toMatch(/bestBranchEmail/);
    expect(read('api/crm/cockpit.ts')).toMatch(/bestBranchEmail/);
  });

  it('the gate checks the RESOLVED address, not the branch row\'s empty field', () => {
    const action = read('api/crm/cockpit-action.ts');
    expect(action).toMatch(/contactEmail: sendTo\.email/);
    expect(action).toMatch(/to_email: sendTo\.email/);
    // A branch's own saved address always wins over a lookup: the lookup is
    // only consulted when the contact itself has none.
    expect(action).toMatch(/const own = \(bundle\.email \?\? ''\)\.trim\(\);[\s\S]{0,200}if \(own\)/);
  });

  it('the evidence travels with the address, so nobody sends to a guess', () => {
    expect(read('api/crm/cockpit-action.ts')).toMatch(/sendToEvidence/);
    expect(read('src/features/crm/components/cockpit/ActionConfirmDialog.tsx'))
      .toMatch(/sendToEvidence/);
  });
});

describe('one proof-of-funds rule, both surfaces', () => {
  it('the rule lives in the lib and the component imports it', () => {
    const modal = read('src/features/crm/components/contacts/ContactSmsModal.tsx');
    expect(modal).toMatch(/import \{ needsProofOfFunds \} from '.*api\/lib\/proof-of-funds'/);
    // No second copy of the words that decide it.
    expect(modal).not.toMatch(/proof of fund\|pof/);
  });

  it('the signing lives in the lib and the route delegates', () => {
    const route = read('api/crm/proof-of-funds.ts');
    expect(route).toMatch(/signProofOfFunds\(supabase\)/);
    expect(route).not.toMatch(/createSignedUrl/);
  });

  it('the cockpit send attaches it when the deal asked for it', () => {
    const action = read('api/crm/cockpit-action.ts');
    expect(action).toMatch(/attachment_url: attachment\.url/);
    expect(action).toMatch(/signProofOfFunds/);
  });

  it('matches on the deal\'s own words, never speculatively', () => {
    expect(needsProofOfFunds({ brief: { blockers: ['Agent wants proof of funds'] } })).toBe(true);
    expect(needsProofOfFunds({ pinnedNote: 'blocked on POF until Monday' })).toBe(true);
    expect(needsProofOfFunds({ brief: { doNow: ['Ring the branch'] } })).toBe(false);
    expect(needsProofOfFunds(null)).toBe(false);
  });
});

describe('the statement\'s own total is a figure the email may quote', () => {
  // The figure fence blocked the entire proof-of-funds email on 17 Aug for
  // naming GBP 102,071. That figure is not about the house, so it is not on the
  // deal file, but it IS written on the document being attached and it is
  // stored on the proof-of-funds record (total_gbp). Refusing it made the one
  // email the deal was waiting on impossible to send from the cockpit.
  it('the lib reports the total and the gate allows exactly that figure', () => {
    expect(read('api/lib/proof-of-funds.ts')).toMatch(/totalGbp/);
    const action = read('api/crm/cockpit-action.ts');
    expect(action).toMatch(/const extraFigures = proof\?\.totalGbp \? \[proof\.totalGbp\] : null/);
    expect(action).toMatch(/extraFigures,/);
  });

  it('the allowance is per-email, never a widening of the deal file', () => {
    const stress = read('api/lib/deal-stress-test.ts');
    expect(stress).toMatch(/extraFigures\?: number\[\] \| null/);
    // Both fences honour it: "not on the file" and "no offer made yet".
    expect(stress).toMatch(/\.\.\.\(input\.extraFigures \?\? \[\]\)/);
    expect(stress).toMatch(/const extras = \(input\.extraFigures \?\? \[\]\)/);
    // The deal state itself is untouched: figuresOnFile stays about the house.
    expect(read('api/lib/deal-state.ts')).not.toMatch(/total_gbp|proof_of_funds/);
  });
});

describe('the email is addressed to the person it is sent to', () => {
  it('takes back a greeting that names one of ours', () => {
    // The exact failure: a draft bound for Leanne opened "Hi Pedro,".
    const out = fixGreeting('Hi Pedro,\n\nI have attached our proof of funds.', 'Leanne');
    expect(out.split('\n')[0]).toBe('Hi Leanne,');
    // The body is untouched: "pass it to Lucy" is legitimate.
    expect(fixGreeting('Hi Pedro,\n\nPass it to Lucy.', 'Leanne')).toContain('Pass it to Lucy.');
  });

  it('leaves a correct greeting exactly as written', () => {
    const text = 'Dear Leanne,\n\nThank you.';
    expect(fixGreeting(text, 'Leanne')).toBe(text);
    expect(fixGreeting('Hi Leanne Jameson,\n\nx', 'Leanne')).toBe('Hi Leanne Jameson,\n\nx');
  });

  it('falls back to Hello rather than guessing a name', () => {
    expect(fixGreeting('Hi Pedro,\n\nx', null).split('\n')[0]).toBe('Hello,');
  });

  it('reads a first name off an address, and refuses shared inboxes', () => {
    expect(firstNameFromEmail('leanne@movewithzest.co.uk')).toBe('Leanne');
    expect(firstNameFromEmail('laurenford@farrellheyworth.co.uk')).toBe('Laurenford');
    expect(firstNameFromEmail('info@zest.co.uk')).toBeNull();
    expect(firstNameFromEmail('enquiries@x.com')).toBeNull();
    expect(firstNameFromEmail(null)).toBeNull();
  });

  it('the drafter is TOLD the recipient and the cockpit passes it', () => {
    expect(read('api/crm/draft-offer-email.ts')).toMatch(/recipientName/);
    expect(read('api/crm/draft-offer-email.ts')).toMatch(/fixGreeting\(finish\(s\), body\.recipientName\)/);
    expect(read('api/crm/cockpit-action.ts')).toMatch(/recipientName: sendTo\?\.recipientName/);
    // And the NAME reaches the model's facts, not just its rules: a rule about
    // a name is useless without the name, which is why a told-to-address-the-
    // recipient draft still opened "Hello,".
    expect(read('api/crm/draft-offer-email.ts')).toMatch(/THE PERSON YOU ARE WRITING TO/);
  });
});

describe('an internal note never hands a model our figures', () => {
  // The comment directly above the do_now stripper says it: "forbidding a
  // model to mention a number while showing it the number is a hope, not a
  // fence." The pinned note was still going over verbatim, and on Welwyn Park
  // Road the model quoted the offer out of it into a proof-of-funds email.
  // Because the offer on that deal IS the walk-away, two money fences fired
  // and the email could not be sent at all.
  it('redacts money and keeps the instruction', () => {
    const note = 'Our offer: GBP 103,600 (ready to go). Worth 140k done up. '
      + 'Agent will not put it forward without proof of funds, decide today.';
    const out = redactFigures(note);
    expect(out).not.toMatch(/103,600|140k/);
    expect(out).toContain('without proof of funds, decide today');
    expect(redactFigures('at \u00a396,375 they said no')).not.toMatch(/96,375/);
  });

  it('the drafter redacts the pinned note and the blockers', () => {
    const src = read('api/crm/draft-offer-email.ts');
    expect(src).toMatch(/redactFigures\(c\.pinnedNote\)/);
    expect(src).toMatch(/redactFigures\(b\)/);
  });
});

describe('one number for the calling list', () => {
  it('the cockpit counts the dialer queue itself', () => {
    // Hugo, 17 Aug: the footer said 97 while the dialer said 168, because the
    // footer counted branches holding a house and the queue holds discovery
    // branches too.
    expect(read('api/crm/cockpit.ts')).toMatch(/wk_dialer_queue/);
    expect(read('src/features/crm/pages/DealCockpitPage.tsx')).toMatch(/callingListQueued/);
  });
});
