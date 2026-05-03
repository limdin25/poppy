import { describe, it, expect } from 'vitest';
import { isSpamEmail } from '../src/core/lib/spam-filter';

describe('isSpamEmail', () => {
  describe('legitimate emails', () => {
    it('passes a normal business inquiry', () => {
      expect(isSpamEmail(
        'john@smithplumbing.co.uk', 'John Smith',
        'Booking enquiry', 'Hi, I need a plumber for next Tuesday please.',
      )).toBe(false);
    });

    it('passes a personal email', () => {
      expect(isSpamEmail(
        'sarah@gmail.com', 'Sarah Jones',
        'Re: Your message', 'Thanks, that works for me!',
      )).toBe(false);
    });

    it('passes a client follow-up', () => {
      expect(isSpamEmail(
        'mike@acme.com', 'Mike Chen',
        'Invoice question', 'Can you resend the invoice from last week?',
      )).toBe(false);
    });
  });

  describe('noreply / marketing senders', () => {
    it('flags noreply@ sender', () => {
      expect(isSpamEmail(
        'noreply@somecompany.com', 'Some Company',
        'Your order update', 'Your order has shipped.',
      )).toBe(true);
    });

    it('flags no-reply@ sender', () => {
      expect(isSpamEmail(
        'no-reply@shop.com', 'Shop',
        'Sale starts now', 'Big sale this weekend.',
      )).toBe(true);
    });

    it('flags newsletter@ sender', () => {
      expect(isSpamEmail(
        'newsletter@brand.com', 'Brand Weekly',
        'This weeks digest', 'Here is your weekly roundup.',
      )).toBe(true);
    });
  });

  describe('known spam domains', () => {
    it('flags mailchimp.com', () => {
      expect(isSpamEmail(
        'bounce@mailchimp.com', 'Mailchimp',
        'Campaign results', 'Your campaign was sent.',
      )).toBe(true);
    });

    it('flags etsy.com', () => {
      expect(isSpamEmail(
        'email@email.etsy.com', 'Etsy',
        'a zest for the best', 'And deals on vintage finds.',
      )).toBe(true);
    });

    it('flags skool.com', () => {
      expect(isSpamEmail(
        'noreply@skool.com', 'The Outreach Collective',
        '2 new notifications since 9:13 pm', '2 new notifications.',
      )).toBe(true);
    });

    it('flags cyberimpact.com', () => {
      expect(isSpamEmail(
        'jane.field.theharmonydiaries.com@email.cyberimpact.com', 'Jane Field',
        '1.3 lbs per day', 'why people are adding this dessert daily.',
      )).toBe(true);
    });

    it('flags signalheadline.com', () => {
      expect(isSpamEmail(
        'info@signalheadline.com', 'Your Wallet',
        '$431 waiting for you - finalize receipt', 'Claim your money now.',
      )).toBe(true);
    });
  });

  describe('unsubscribe link detection', () => {
    it('flags emails with unsubscribe link', () => {
      expect(isSpamEmail(
        'hello@legit-looking.com', 'Company',
        'Monthly update', 'Here is our update. Click here to unsubscribe.',
      )).toBe(true);
    });

    it('flags emails with opt-out', () => {
      expect(isSpamEmail(
        'info@company.com', 'Company',
        'News', 'Latest news... To opt-out of these emails click here.',
      )).toBe(true);
    });

    it('flags emails with view in browser', () => {
      expect(isSpamEmail(
        'hello@brand.com', 'Brand',
        'Weekly deals', 'View this email in your browser. Big savings inside!',
      )).toBe(true);
    });
  });

  describe('spam subject patterns', () => {
    it('flags money waiting subjects', () => {
      expect(isSpamEmail(
        'info@random.com', 'Random',
        '$431 WAITING FOR YOU - FINALIZE', 'Click to claim.',
      )).toBe(true);
    });

    it('flags weight loss subjects', () => {
      expect(isSpamEmail(
        'tips@health.com', 'Health Tips',
        '1.3 lbs per day results', 'Amazing weight loss.',
      )).toBe(true);
    });

    it('flags notification digest subjects', () => {
      expect(isSpamEmail(
        'alerts@platform.com', 'Platform',
        '5 new notifications since yesterday', 'You have new activity.',
      )).toBe(true);
    });
  });

  describe('spam body signals (needs 2+)', () => {
    it('does not flag with only 1 body signal', () => {
      expect(isSpamEmail(
        'someone@email.com', 'Someone',
        'Health tips', 'This will help eliminate joint pain naturally.',
      )).toBe(false);
    });

    it('flags with 2+ body signals', () => {
      expect(isSpamEmail(
        'someone@email.com', 'Someone',
        'Health tips', 'Eliminate neuropathy pain and restore energy naturally!',
      )).toBe(true);
    });
  });
});
