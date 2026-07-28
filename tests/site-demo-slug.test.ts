import { describe, it, expect } from 'vitest';
import { slugifySite, dedupeSlug, isReservedSlug } from '../src/core/site-demo/slug';

describe('slugifySite', () => {
  it('makes a human readable slug, because it goes in a text message', () => {
    expect(slugifySite('MJR Plumbing')).toBe('mjr-plumbing');
    expect(slugifySite('  Bright Spark Electrical Ltd. ')).toBe('bright-spark-electrical-ltd');
  });

  it('spells out an ampersand rather than dropping it', () => {
    expect(slugifySite('Cooke & Sons')).toBe('cooke-and-sons');
  });

  it('strips apostrophes without leaving a hyphen scar', () => {
    expect(slugifySite("O'Brien Roofing")).toBe('obrien-roofing');
    expect(slugifySite('Dave’s Drains')).toBe('daves-drains');
  });

  it('collapses punctuation runs and never starts or ends with a hyphen', () => {
    const s = slugifySite('!!! Ace   ---  Plumbing ???');
    expect(s).toBe('ace-plumbing');
    expect(s.startsWith('-')).toBe(false);
    expect(s.endsWith('-')).toBe(false);
  });

  it('never returns an empty slug', () => {
    expect(slugifySite('')).toBe('site');
    expect(slugifySite('!!!')).toBe('site');
  });

  it('does not let a business name claim one of our own paths', () => {
    expect(slugifySite('chat')).toBe('chat-site');
    expect(isReservedSlug('checkout')).toBe(true);
  });

  it('keeps a purely numeric name from reading like an id', () => {
    expect(slugifySite('123')).toBe('123-site');
  });

  it('caps the length and still ends cleanly', () => {
    const s = slugifySite('A'.repeat(200));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('dedupeSlug', () => {
  it('leaves a free slug alone', () => {
    expect(dedupeSlug('mjr-plumbing', [])).toBe('mjr-plumbing');
  });

  it('counts up from 2, the way a person would', () => {
    expect(dedupeSlug('mjr-plumbing', ['mjr-plumbing'])).toBe('mjr-plumbing-2');
    expect(dedupeSlug('mjr-plumbing', ['mjr-plumbing', 'mjr-plumbing-2'])).toBe('mjr-plumbing-3');
  });

  it('is case insensitive about what is already taken', () => {
    expect(dedupeSlug('mjr-plumbing', ['MJR-Plumbing'])).toBe('mjr-plumbing-2');
  });

  it('fills a gap rather than always appending', () => {
    expect(dedupeSlug('ace', ['ace', 'ace-3'])).toBe('ace-2');
  });
});
