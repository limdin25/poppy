// An email in the inbox has to read like an email.
//
// Hugo, 2026-08-11: "emaisl is not nicelly formated".
//
// The webhook had already been fixed to store clean paragraphed text, so this
// was the second half of the same complaint and a different bug entirely: the
// thread bubble rendered the body as a bare `{m.body}` expression with no
// whitespace rule. React handed the browser a string full of newlines and CSS
// collapsed every one, so a nine-paragraph estate agency reply arrived as one
// unbroken wall. SMS and WhatsApp had it too; email just showed it worst,
// being the only channel anyone writes paragraphs in.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  linkPieces,
  splitTrailing,
  isLong,
  previewCut,
  COLLAPSE_OVER,
} from '../src/features/crm/lib/messageText';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const BUBBLE = read('src/features/crm/components/shared/MessageBody.tsx');
const INBOX = read('src/features/crm/pages/InboxPage.tsx');
const TIMELINE = read('src/features/crm/components/live-call/CallTimeline.tsx');

/** The real reply from Keaze, trimmed. This is what Pedro has to read. */
const KEAZE = [
  'Hello Pedro,',
  '',
  'Thank you for showing interest in - Rose Way, Edwalton NG12 4JE',
  '',
  'This property is managed by Platform Housing , I have passed on your contact details to them.',
  '',
  'Email: sales@platformhg.com',
  '',
  'Contact Number: 0333 200 7304',
].join('\n');

describe('the newlines the sender wrote survive to the screen', () => {
  it('the bubble sets a whitespace rule, which is the entire bug', () => {
    expect(BUBBLE).toMatch(/whitespace-pre-wrap break-words/);
  });

  it('the inbox no longer renders the body as a bare expression', () => {
    expect(INBOX).toMatch(/<MessageBody\s/);
    // The exact line that caused it. `{m.body}` alone, on its own line.
    expect(INBOX).not.toMatch(/^\s*\{m\.body\}\s*$/m);
  });

  it('the dialer call timeline was fixed too', () => {
    // Pedro reads that panel while he is on the phone.
    expect(TIMELINE).toMatch(/whitespace-pre-wrap break-words">\{row\.body\}/);
  });
});

describe('addresses and links in a reply are clickable', () => {
  it('turns the agency email address into a mailto', () => {
    const mail = linkPieces(KEAZE).find((p) => p.href?.startsWith('mailto:'));
    expect(mail?.href).toBe('mailto:sales@platformhg.com');
    expect(mail?.text).toBe('sales@platformhg.com');
  });

  it('keeps a full stop out of the link', () => {
    expect(splitTrailing('sales@platformhg.com.')).toEqual(['sales@platformhg.com', '.']);
    expect(splitTrailing('https://a.co/x),')).toEqual(['https://a.co/x', '),']);
    const pieces = linkPieces('write to sales@platformhg.com.');
    expect(pieces.find((p) => p.href)?.href).toBe('mailto:sales@platformhg.com');
    expect(pieces.map((p) => p.text).join('')).toBe('write to sales@platformhg.com.');
  });

  it('gives a bare www address a scheme so the link works', () => {
    expect(linkPieces('see www.gascoignehalman.co.uk today')
      .find((p) => p.href)?.href).toBe('https://www.gascoignehalman.co.uk');
  });

  it('leaves an http link exactly as written', () => {
    const url = 'https://www.rightmove.co.uk/properties/174993728';
    expect(linkPieces(`the house ${url} is nice`).find((p) => p.href)?.href).toBe(url);
  });

  it('never loses or duplicates a character', () => {
    // The join of every piece must reproduce the original exactly, or the
    // agent is reading something the sender did not write.
    for (const s of [KEAZE, 'no links here at all', 'a@b.co', 'www.x.com, https://y.co/z!']) {
      expect(linkPieces(s).map((p) => p.text).join('')).toBe(s);
    }
  });

  it('handles a body with no links without falling over', () => {
    expect(linkPieces('plain').map((p) => p.text).join('')).toBe('plain');
    expect(linkPieces('')).toEqual([]);
  });
});

describe('a legal footer does not bury the message', () => {
  it('leaves a normal reply alone', () => {
    // The real Keaze body before its footer is well under the threshold.
    expect(isLong(KEAZE)).toBe(false);
    expect(previewCut(KEAZE)).toBe(KEAZE);
  });

  it('folds a message with a confidentiality notice bolted on', () => {
    const withFooter = KEAZE + '\n\n' + 'Just so you know... this email and any files transmitted with it are confidential. '.repeat(12);
    expect(withFooter.length).toBeGreaterThan(COLLAPSE_OVER);
    expect(isLong(withFooter)).toBe(true);
    const cut = previewCut(withFooter);
    expect(cut.length).toBeLessThan(withFooter.length);
    // The useful part is what survives.
    expect(cut).toContain('Rose Way, Edwalton NG12 4JE');
  });

  it('cuts at a paragraph break rather than mid-sentence', () => {
    const long = ('Paragraph about the property. '.repeat(6) + '\n\n').repeat(6);
    const cut = previewCut(long);
    expect(cut.endsWith('.') || cut.endsWith('. ')).toBe(true);
  });

  it('offers the rest rather than hiding it', () => {
    expect(BUBBLE).toMatch(/Show full message/);
    expect(BUBBLE).toMatch(/Show less/);
  });
});

describe('safety and layout', () => {
  it('never injects sender HTML into the page', () => {
    // This text arrives from strangers by email. Comments are stripped first,
    // because the file explains in prose that it deliberately does NOT use
    // dangerouslySetInnerHTML, and a test that matched that sentence would be
    // asserting against its own documentation rather than against the code.
    const code = BUBBLE
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('gives email the room a paragraph needs', () => {
    // 60% is right for a text message and squeezes an agency reply.
    expect(INBOX).toMatch(/ch === 'email' \? 'max-w-\[85%\]' : 'max-w-\[60%\]'/);
  });

  it('a link click does not also open whatever is behind it', () => {
    expect(BUBBLE).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(BUBBLE).toMatch(/rel="noopener noreferrer"/);
  });
});
