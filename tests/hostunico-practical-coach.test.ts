import { describe, expect, it } from 'vitest';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales';
import { HOSTUNICO_ANSWERS, HOSTUNICO_PREPARED_KNOWLEDGE } from '../supabase/functions/_shared/hostunico-answer-bank';

describe('practical answers from the failed test call', () => {
  it.each(['Tell me more please.', 'Ok, go on.', 'Yes, please explain to me how it works.', 'Send the report'])('uses live property and report context for %s', (question) => {
    expect(hostunicoInstantAnswer(question)).toBeNull();
  });
  it.each([
    ["What if I don't make any money?", 'owner-no-income', /no percentage management fee.*software fee/],
    ["Who's going to be the cleaner?", 'cleaning', /local cleaner.*assign one/],
    ["Who's going to open the door for the guest?", 'access-owner-present', /guests take the key.*themselves/],
    ["Who's gonna open it?", 'access-owner-present', /lockbox/],
    ['Is there a lock box? How does it work?', 'access', /key inside.*shop/],
    ['Please explain the access and the cleaning.', 'access-and-cleaning', /lockbox.*local cleaner.*photos/],
    ['How can you manage remotely?', 'remote-management', /online.*local cleaner/],
    ['Are you coming to the property?', 'property-visit', /^No,.*setup checklist.*assign a cleaner/],
    ['Can you give an example of a property and how guests get in?', 'access-example', /For example, imagine.*studio.*lockbox/],
    ['Do you pay guaranteed rent?', 'guarantee', /^No,.*keep the booking income/],
  ])('%s gives a usable explanation', (question, key, content) => {
    const answer = hostunicoInstantAnswer(question);
    expect(answer?.key).toBe(`hostunico-${key}`);
    expect(answer?.say).toMatch(content);
    expect(answer?.nextQuestion).toBe('');
  });

  it.each([
    ["I cannot install a lockbox", 'access-no-lockbox'],
    ['How does shop key collection work?', 'access-keyshop'],
    ['What if the key shop closes before they arrive?', 'access-shop-hours'],
    ['Who installs the lockbox?', 'access-installation'],
    ['Do I have to meet every guest?', 'access-owner-present'],
    ['What if the guest is locked out?', 'access-lost-key'],
    ['What about the building fob?', 'access-building-door'],
    ['Who changes the code?', 'access-code-security'],
    ['Can you help set it up?', 'setup-help'],
    ['What is on the onboarding checklist?', 'setup-checklist'],
    ['Who pays for cleaning?', 'cleaning-cost'],
    ['How often is it cleaned?', 'cleaning-frequency'],
    ['Who buys cleaning supplies?', 'cleaning-supplies'],
    ['What if the cleaner is sick?', 'cleaning-backup'],
    ['Can I keep my own cleaner?', 'existing-cleaner'],
    ['Who washes the bedding?', 'linen-change'],
    ['Will you cover my mortgage?', 'owner-loss'],
    ['Will you take a lease?', 'rent-to-rent'],
    ['Can you promise a minimum income?', 'minimum-income'],
    ['Who sets the nightly price?', 'pricing-control'],
    ['What if a guest cancels?', 'cancellations'],
    ['How do you check guests?', 'guest-verification'],
    ['Who creates the Airbnb listing?', 'listing-writing'],
    ["I don't have an Airbnb account", 'no-account'],
    ['This is a landline, can you send the report?', 'report-no-mobile'],
    ['Your report has the wrong postcode', 'report-wrong-facts'],
  ])('uses the specific answer for %s', (question, key) => {
    expect(hostunicoInstantAnswer(question)?.key).toBe(`hostunico-${key}`);
  });

  it.each([
    'How do guests get in, and how much is it?',
    'What does cleaning cost, and who fits the lockbox?',
    'Who pays for cleaning, and what is your management fee?',
    'Who fits the lockbox? And how much is your management fee?',
    'Are you coming to the property, and what are your fees?',
    'How do guest access and cleaning work, and do you guarantee income?',
    'I mean who is going to open it?',
    'Yes please',
    'No, not cleaning. I mean guest access.',
    'Does the shop on my road stay open until midnight?',
  ])('uses context and reasoning when one prepared answer cannot cover %s', (question) => {
    expect(hostunicoInstantAnswer(question)).toBeNull();
  });

  it('shares the concrete delivery facts with the generated coach', () => {
    for (const key of ['remote-management', 'property-visit', 'access', 'access-and-cleaning', 'guarantee']) {
      const answer = HOSTUNICO_ANSWERS.find((a) => a.key === key)!;
      expect(HOSTUNICO_PREPARED_KNOWLEDGE).toContain(answer.say);
    }
    for (const answer of HOSTUNICO_ANSWERS) {
      for (const key of answer.supersedes || []) expect(HOSTUNICO_ANSWERS.some((a) => a.key === key)).toBe(true);
    }
  });
});
