import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  attachmentSearchToken,
  fileNameFromUrl,
  inboxListPreview,
} from '../src/features/crm/lib/inboxPreview';

const root = resolve(__dirname, '..');

describe('a quote PDF is visible on the list and in search', () => {
  const url =
    'https://loggyxryrhqsbtqpteog.supabase.co/storage/v1/object/public/crm-attachments/inbound-email/abc/1050-QuotePDF-74-Conway-Road-.pdf';

  it('pulls the file name out of our storage URL', () => {
    expect(fileNameFromUrl(url)).toBe('1050-QuotePDF-74-Conway-Road-.pdf');
  });

  it('says PDF and the file name, not the Outlook signature', () => {
    expect(inboxListPreview({
      body: 'Sent from Outlook for iOS',
      mediaUrls: [url],
      attachmentUrl: url,
    })).toBe('PDF: 1050-QuotePDF-74-Conway-Road-.pdf');
  });

  it('searching Conway or 1050 hits the file name', () => {
    const token = attachmentSearchToken([url], url);
    expect(token.toLowerCase()).toContain('conway');
    expect(token).toContain('1050');
  });

  it('a caption-less photo still says Photo', () => {
    expect(inboxListPreview({
      body: '  ',
      mediaUrls: ['https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME'],
    })).toBe('Photo');
  });
});

describe('the inbox actually uses those helpers', () => {
  it('search includes subject and the file name', () => {
    const page = readFileSync(resolve(root, 'src/features/crm/pages/InboxPage.tsx'), 'utf8');
    expect(page).toMatch(/r\.lastSubject/);
    expect(page).toMatch(/r\.lastAttachmentName/);
    expect(page).toMatch(/r\.email/);
  });

  it('does not list the sidebar off a workspace-wide last-1000', () => {
    const hook = readFileSync(resolve(root, 'src/features/crm/hooks/useInboxThreads.ts'), 'utf8');
    expect(hook).toMatch(/wk_inbox_thread_previews/);
    expect(hook).not.toMatch(/\.limit\(1000\)/);
  });
});
