// Edit-contact email save.
//
// Hugo, 2026-09-01, inbox screenshot on Everyday Home Improvements: typing
// an email and hitting Save did not stick. Two bugs stacked:
//   1. The follow-up list arriving a beat after open sat in the same effect
//      that copies the contact into the draft, so the typed address was wiped
//      and Save wrote the empty original.
//   2. An UPDATE that RLS refused returned 200 and zero rows, so the toast
//      still said Saved.
//
// CRM component tests under src/features/crm are excluded from vitest
// (no jsdom). This file is the run that actually ships: the pure helper,
// plus source pins so neither bug can come back quietly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeContactEmail } from '../src/features/crm/hooks/useContactPersistence';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MODAL = read('src/features/crm/components/contacts/EditContactModal.tsx');
const PERSIST = read('src/features/crm/hooks/useContactPersistence.ts');
const INBOX = read('src/features/crm/pages/InboxPage.tsx');

describe('normalizeContactEmail', () => {
  it('trims and lowercases the address Everyday Home would type', () => {
    expect(normalizeContactEmail('  Jim@EverydayHome.CO.UK  ')).toBe('jim@everydayhome.co.uk');
  });

  it('turns blank, spaces, tabs, null and undefined into null', () => {
    expect(normalizeContactEmail('')).toBeNull();
    expect(normalizeContactEmail('   ')).toBeNull();
    expect(normalizeContactEmail('\t\n')).toBeNull();
    expect(normalizeContactEmail(null)).toBeNull();
    expect(normalizeContactEmail(undefined)).toBeNull();
  });

  it('keeps plus-addressing and dots', () => {
    expect(normalizeContactEmail('Hugo+office@hostunico.com')).toBe('hugo+office@hostunico.com');
    expect(normalizeContactEmail('first.last@ddmresidential.co.uk')).toBe(
      'first.last@ddmresidential.co.uk',
    );
  });

  it('is a no-op on an already-canonical address', () => {
    expect(normalizeContactEmail('jim@everydayhome.co.uk')).toBe('jim@everydayhome.co.uk');
  });

  it('does not invent an address out of punctuation', () => {
    expect(normalizeContactEmail('@')).toBe('@');
    expect(normalizeContactEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('the modal does not wipe a typed email', () => {
  it('resets the draft only when the lead id changes', () => {
    const draftEffect = MODAL.match(/setDraft\(contact\);[\s\S]*?\}, \[([^\]]+)\]/);
    expect(draftEffect?.[1].replace(/\s/g, '')).toBe('contactId');
    expect(draftEffect?.[1]).not.toContain('nextFollowup');
    expect(draftEffect?.[1]).not.toMatch(/(^|[^a-zA-Z])contact([^I]|$)/);
  });

  it('follow-up loads update the timer, not the form', () => {
    expect(MODAL).toMatch(/setFollowupDueLocal\(local\);[\s\S]*?\}, \[contactId, nextFollowup\]/);
    const followupEffect = MODAL.match(
      /useEffect\(\(\) => \{\n    if \(nextFollowup\) \{[\s\S]*?\}, \[contactId, nextFollowup\]/,
    );
    expect(followupEffect?.[0]).not.toContain('setDraft');
  });

  it('Save canonicalises the email before onSave, so the store matches the row', () => {
    expect(MODAL).toMatch(/const email = normalizeContactEmail\(draft\.email\);/);
    expect(MODAL).toMatch(/onSave\(\{ \.\.\.draft, email: email \?\? undefined \}\)/);
  });

  it('the email box is a labelled email input, not an anonymous text field', () => {
    expect(MODAL).toMatch(/aria-label="Email"/);
    expect(MODAL).toMatch(/type="email"/);
  });
});

describe('the write actually lands', () => {
  it('normalises email in patchContact, not only in the modal', () => {
    expect(PERSIST).toMatch(/if \('email' in cleaned\)/);
    expect(PERSIST).toMatch(/normalizeContactEmail\(/);
  });

  it('selects the updated row so a silent RLS miss cannot toast Saved', () => {
    expect(PERSIST).toMatch(/\.update\(cleaned\)\s*\n\s*\.eq\('id', contactId\)\s*\n\s*\.select\('id'\)/);
    expect(PERSIST).toContain("return 'Save did not land on this lead'");
    expect(PERSIST).toMatch(/rows\.length === 0/);
  });

  it('still names a unique-email clash', () => {
    expect(PERSIST).toContain("return 'This email is already used by another contact'");
  });

  it('the inbox save path still sends email through to patchContact', () => {
    expect(INBOX).toMatch(/email: updated\.email \?\? null/);
  });
});

describe('a failed create does not close the modal', () => {
  // Pedro, 2026-09-02: added RW Design, closed the form, then could not find
  // the lead. Save called onSave and closed immediately, so a missing phone
  // toasted behind the already-gone modal and wrote nothing.
  it('Save waits for onSave and stays open when it returns false', () => {
    expect(MODAL).toMatch(/if \(result !== false\) onClose\(\)/);
    expect(MODAL).toMatch(/Promise\.resolve\(onSave\(/);
  });

  it('creating a contact without a name or phone returns false', () => {
    const contactsPage = read('src/features/crm/pages/ContactsPage.tsx');
    expect(contactsPage).toMatch(/const saveNewContact = async \(draft: Contact\): Promise<boolean>/);
    expect(contactsPage).toMatch(/pushToast\('Name and phone are required', 'error'\);/);
    expect(contactsPage).toMatch(/return false;/);
    expect(contactsPage).toMatch(/pushToast\('Invalid phone number', 'error'\);/);
  });
});
