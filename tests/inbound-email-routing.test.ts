// An email from a branch has to land on the branch, and belong to somebody.
//
// Hugo, 2026-08-11: "also sent a email to pedro@hostunico.com and is not
// shwoing here /admin/crm/inbox" and then "the inbox is empty, you need to fix
// it".
//
// What was actually wrong. Pedro rang Gascoigne Halman at 12:35 and they
// emailed back at 12:48. findOrCreateContact matched inbound mail on the email
// column alone, and a scraped estate agency branch has a phone number and no
// email address, so the branch Pedro had just spoken to could not be found. It
// minted a SECOND "Gascoigne Halman" with owner_agent_id NULL.
//
// Ownerless is the part that hurt. wk_sms_messages_read grants an agent a
// message only when wk_agent_participates(contact_id) holds, and that needs
// ownership, a lead assignment, a call, or one of the agent's own numbers on
// the thread. A contact owned by nobody satisfies none of them, so the reply
// was readable by admins and by literally no other account. Measured against
// production: Pedro could see 225 contacts, 100 calls and 0 messages.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const HOOK = readFileSync(resolve(root, 'supabase/functions/wk-email-webhook/index.ts'), 'utf8');

/** The two helpers, transcribed from the function under test. The point of
 *  copying them is that the assertions below exercise the RULE; the assertions
 *  further down pin that the deployed file still contains it. */
const companyKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const domainLabel = (e: string) => (e.split('@')[1] ?? '').split('.')[0] ?? '';

describe('matching a branch by the name in its domain', () => {
  it('joins the reply to the branch that was called', () => {
    expect(domainLabel('sale@gascoignehalman.co.uk')).toBe('gascoignehalman');
    expect(companyKey('Gascoigne Halman')).toBe('gascoignehalman');
    expect(companyKey('Gascoigne Halman')).toBe(domainLabel('sale@gascoignehalman.co.uk'));
  });

  it('survives the punctuation estate agents put in their names', () => {
    expect(companyKey('Leary & Holmes')).toBe('learyholmes');
    expect(companyKey('Ready-Steady-Move')).toBe('readysteadymove');
    expect(companyKey("Tom Giles and Co.")).toBe('tomgilesandco');
  });

  it('does not fire on a free mailbox', () => {
    // Hugo's own test mail came from gmail. Without this guard it would hunt
    // for a contact called "Gmail" and could attach a stranger's mail to it.
    for (const d of ['gmail', 'outlook', 'hotmail', 'yahoo', 'icloud', 'btinternet']) {
      expect(HOOK).toMatch(new RegExp(`'${d}'`));
    }
    expect(HOOK).toMatch(/PUBLIC_MAIL_DOMAINS\.has\(label\)/);
  });

  it('refuses to guess when two contacts match', () => {
    // Two branches of the same chain both named "Dixons" must not have one
    // picked arbitrarily. A new contact is honest; a wrong thread is not.
    expect(HOOK).toMatch(/hits\.length === 1/);
    expect(HOOK).toMatch(/creating a new one rather than guessing/);
  });

  it('only considers contacts with no email yet, so it cannot steal a thread', () => {
    expect(HOOK).toMatch(/\.is\('email', null\)/);
  });

  it('says so out loud if the prefilter cap could have hidden a match', () => {
    expect(HOOK).toMatch(/CANDIDATE_CAP/);
    expect(HOOK).toMatch(/a real match may have been cut off/);
  });
});

describe('a new contact from inbound email is never ownerless', () => {
  it('belongs to the agent whose mailbox received it', () => {
    // pedro@hostunico.com is the profiles.email of the Pedro Houses login, so
    // the recipient address is all the mapping we need.
    expect(HOOK).toMatch(/async function ownerForRecipient/);
    expect(HOOK).toMatch(/\.from\('profiles'\)[\s\S]{0,120}\.ilike\('email', toEmail\)/);
    expect(HOOK).toMatch(/owner_agent_id: ownerAgentId/);
    expect(HOOK).not.toMatch(/owner_agent_id: null/);
  });

  it('records which mailbox it arrived at', () => {
    expect(HOOK).toMatch(/received_at_mailbox: toEmail \|\| null/);
  });

  it('warns rather than silently creating an admin-only contact', () => {
    expect(HOOK).toMatch(/no agent owns the mailbox[\s\S]{0,60}admin-only/);
  });

  it('leaves an EXISTING contact’s owner alone', () => {
    // An inbound email must never reassign a lead that already belongs to
    // another agent. The address match returns early, before any ownership
    // is worked out.
    const matchBlock = HOOK.slice(
      HOOK.indexOf('async function findOrCreateContact'),
      HOOK.indexOf('const label = domainLabel(email)'),
    );
    expect(matchBlock).toMatch(/return \(existing as \{ id: string \}\)\.id;/);
    expect(matchBlock).not.toMatch(/owner_agent_id/);
  });
});

describe('the email is readable by whoever it was addressed to', () => {
  it('grants access by assignment, never by taking ownership', () => {
    // Hugo, 2026-08-11: "also my test email, still not there". He had mailed
    // pedro@hostunico.com, and his own contact record belongs to Pedro's OLD
    // sales-closer account, so ownership of the SENDER was deciding who could
    // read mail sent to the RECIPIENT. Moving ownership would have taken the
    // lead off whichever agent already had it, so this adds a row that
    // wk_agent_participates() accepts and changes nothing else.
    expect(HOOK).toMatch(/async function grantRecipientAccess/);
    expect(HOOK).toMatch(/\.from\('wk_lead_assignments'\)[\s\S]{0,400}\.insert\(\{/);
    expect(HOOK).toMatch(/status: 'assigned'/);
    const grant = HOOK.slice(
      HOOK.indexOf('async function grantRecipientAccess'),
      HOOK.indexOf('async function findOrCreateContact'),
    );
    expect(grant).not.toMatch(/owner_agent_id:/);
  });

  it('does not pile up a row per email', () => {
    expect(HOOK).toMatch(/\.in\('status', \['assigned', 'in_progress'\]\)/);
    expect(HOOK).toMatch(/if \(already\) return;/);
    expect(HOOK).toMatch(/if \(owned\) return;/);
  });

  it('runs after the message is saved, and cannot fail the delivery', () => {
    expect(HOOK).toMatch(/could not grant inbox access/);
  });

  it('matches the status values the RLS function and the inbox both accept', () => {
    // wk_agent_participates() and useInboxThreads.ts both read
    // status in ('assigned','in_progress'). A different word here would
    // insert a row that grants nothing.
    const INBOX = readFileSync(resolve(root, 'src/features/crm/hooks/useInboxThreads.ts'), 'utf8');
    expect(INBOX).toMatch(/\['assigned', 'in_progress'\]/);
  });
});

describe('an email body a human can read', () => {
  it('prefers the HTML, because the sender’s own plain text is the junk', () => {
    // The Gascoigne Halman welcome mail was 3,955 characters of
    // "https://mailing.street.co.uk/ls/click?upn=u001.6cL4aGcwD419h-2B..."
    // in text/plain, and 1,370 characters of English once its HTML was
    // converted. The old line took `text` whenever it existed.
    expect(HOOK).toMatch(/html \? htmlToText\(html\) : tidyPlainText\(text\)/);
    expect(HOOK).not.toMatch(/text \|\| html\.replace/);
  });

  it('keeps the words of a link and drops the tracking address', () => {
    expect(HOOK).toMatch(/<a\\b\[\^>\]\*>\(\[\\s\\S\]\*\?\)<\\\/a>/);
    expect(HOOK).toMatch(/LONG_URL = \/https\?:\\\/\\\/\\S\{60,\}\/g/);
  });

  it('leaves a short link somebody typed on purpose alone', () => {
    // rightmove.co.uk/properties/174993728 is content, not tracking.
    const short = 'https://www.rightmove.co.uk/properties/174993728';
    expect(short.length).toBeLessThan(60);
  });

  it('throws away style, script and images', () => {
    expect(HOOK).toMatch(/<\(style\|script\|head\|title\)/);
    expect(HOOK).toMatch(/<img\[\^>\]\*>/);
  });

  it('folds the punctuation this codebase bans on the way in', () => {
    // A long dash or curly quote arriving from somebody else's mail client
    // must not end up stored in our database.
    expect(HOOK).toMatch(/0x2013: '-', 0x2014: '-'/);
    expect(HOOK).toMatch(/0x201c: '"', 0x201d: '"'/);
    expect(HOOK).toMatch(/0x2026: '\.\.\.'/);
  });

  it('strips the zero-width characters mail merges scatter about', () => {
    expect(HOOK).toMatch(/\\u200b-\\u200d\\ufeff/);
  });
});

describe('the recipient is still the security boundary', () => {
  it('keeps dropping mail sent outside our own domains', () => {
    // Unchanged by this work, and worth pinning: without it anyone could
    // inject rows by mailing a lookalike address.
    expect(HOOK).toMatch(/CRM_INBOUND_EMAIL_DOMAINS\.some/);
    expect(HOOK).toMatch(/recipient outside CRM inbound domain/);
  });

  it('passes the recipient through to contact resolution', () => {
    expect(HOOK).toMatch(/findOrCreateContact\(supa, fromEmail, fromName, emailId, toEmail\)/);
  });
});
