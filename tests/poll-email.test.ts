import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test the email-specific helper functions extracted from poll.ts
import { stripHtml, cleanEmailBody, isEmailSpam, normalizeSubject } from '../api/lib/email-utils';

describe('Email Polling Utilities', () => {
  describe('stripHtml', () => {
    it('strips HTML tags and decodes entities', () => {
      const html = '<p>Hello &amp; welcome</p><br><script>evil()</script>';
      const result = stripHtml(html);
      expect(result).toContain('Hello & welcome');
      expect(result).not.toContain('<p>');
      expect(result).not.toContain('script');
    });

    it('converts br and p to newlines', () => {
      const html = 'Line 1<br>Line 2</p>Line 3';
      const result = stripHtml(html);
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
    });
  });

  describe('cleanEmailBody', () => {
    it('strips quoted replies', () => {
      const body = 'My actual reply\n\nOn Mon, 5 May 2026 wrote:\n> old message text';
      const result = cleanEmailBody(body);
      expect(result).toBe('My actual reply');
    });

    it('removes long tracking URLs', () => {
      const longUrl = 'https://tracking.example.com/' + 'a'.repeat(130);
      const body = `Check this out ${longUrl} thanks`;
      const result = cleanEmailBody(body);
      expect(result).not.toContain('tracking.example.com');
      expect(result).toContain('Check this out');
    });
  });

  describe('isEmailSpam', () => {
    it('detects noreply senders', () => {
      expect(isEmailSpam('noreply@company.com', 'Update', 'body')).toBe(true);
    });

    it('detects marketing emails', () => {
      expect(isEmailSpam('promo@deals.com', 'Unsubscribe now', 'click to unsubscribe from this list')).toBe(true);
    });

    it('allows real emails', () => {
      expect(isEmailSpam('john@gmail.com', 'Need a plumber', 'Hi, my boiler broke')).toBe(false);
    });
  });

  describe('normalizeSubject', () => {
    it('strips Re: and Fwd: prefixes', () => {
      expect(normalizeSubject('Re: Fwd: Hello')).toBe('hello');
    });

    it('handles empty subjects', () => {
      expect(normalizeSubject('')).toBe('');
    });

    it('lowercases for matching', () => {
      expect(normalizeSubject('URGENT Request')).toBe('urgent request');
    });
  });
});
