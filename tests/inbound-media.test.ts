import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Hugo 2026-08-03: a HeyPubli lead was asked for their Instagram handle and
// answered with a screenshot. The inbox drew an empty bubble. "need to render
// images, i think he sent."
//
// Two causes, and the second is the one with teeth:
//   1. wk-sms-incoming has always written wk_sms_messages.media_urls, and
//      nothing had ever read that column.
//   2. Twilio media URLs answer 401 without the account credentials. Measured,
//      not assumed, against the real stored URL.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const route = read('api/crm/media.ts');
const hook = read('src/features/crm/hooks/useContactMessages.ts');
const threads = read('src/features/crm/hooks/useInboxThreads.ts');
const component = read('src/features/crm/components/InboundMedia.tsx');
const inbox = read('src/features/crm/pages/InboxPage.tsx');

describe('the column is actually read now', () => {
  it('useContactMessages selects media_urls and exposes it', () => {
    expect(hook).toMatch(/select\('[^']*media_urls[^']*'\)/);
    expect(hook).toMatch(/mediaUrls: Array\.isArray\(r\.media_urls\)/);
  });

  it('the thread renders it, and tells inbound from outbound', () => {
    expect(inbox).toMatch(/<InboundMedia/);
    expect(inbox).toMatch(/mediaCount: m\.mediaUrls\.length/);
  });

  it('a caption-less photo no longer leaves the list row blank', () => {
    expect(threads).toMatch(/select\('[^']*media_urls[^']*'\)/);
    expect(threads).toMatch(/'Photo'/);
  });
});

describe('the media proxy refuses what it should', () => {
  it('will not serve a lead\'s messages to somebody signed out', () => {
    expect(route).toMatch(/supabase\.auth\.getUser\(token\)/);
    expect(route).toMatch(/return json\(401, \{ error: 'Unauthorized' \}\)/);
  });

  it('pins the host, or a forged webhook turns this into an SSRF hole', () => {
    // media_urls holds a URL that arrived on a webhook. Fetching it with our own
    // credentials attached, unpinned, would let a forgery name an internal
    // address and have us read it out loud.
    expect(route).toMatch(/ALLOWED_HOST = 'api\.twilio\.com'/);
    expect(route).toMatch(/parsed\.hostname !== ALLOWED_HOST/);
    expect(route).toMatch(/parsed\.protocol !== 'https:'/);
  });

  it('does not carry our Twilio credentials into the S3 redirect', () => {
    // Twilio 307s to a signed third-party URL. Following that with the
    // Authorization header still set hands the account credentials to another
    // host, so the hop is taken by hand.
    expect(route).toMatch(/redirect: 'manual'/);
    expect(route).toMatch(/upstream = await fetch\(location\)/);
  });

  it('keeps the cache private, because this is one lead\'s message', () => {
    expect(route).toMatch(/'Cache-Control': 'private/);
  });
});

describe('the token never reaches a log', () => {
  it('is sent as a header, not a query string', () => {
    // An <img src> cannot carry a header, which is exactly why the component
    // fetches the bytes and renders a blob instead of pointing the tag at the
    // route with ?token= on the end.
    expect(component).toMatch(/headers: \{ Authorization: `Bearer \$\{token\}` \}/);
    expect(component).not.toMatch(/token=\$\{/);
    expect(route).not.toMatch(/searchParams\.get\('token'\)/);
  });

  it('revokes the blob url, or a long thread leaks one per image', () => {
    expect(component).toMatch(/URL\.revokeObjectURL\(objectUrl\)/);
  });
});
