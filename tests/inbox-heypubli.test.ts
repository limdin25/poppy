import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snippet } from '../src/core/lib/format';

// Hugo, 2026-08-07, looking at the WhatsApp tab of /admin/crm/inbox:
//   every contact says "Name not available" and "Website not available",
//   the cards show no message and no progress, and the right-hand panel
//   shows a phone number and nothing else.
//
// He wants the inbox to tell him at a glance where every lead is on their
// journey and what happens to them next. These are the wiring assertions for
// that; the logic itself is unit-tested in heypubli-journey.test.ts.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const inbox = stripComments(read('src/features/crm/pages/InboxPage.tsx'));
const panel = stripComments(read('src/features/crm/components/journey/JourneyPanel.tsx'));
const hook = stripComments(read('src/features/crm/hooks/useHeypubliJourney.ts'));
const api = stripComments(read('api/crm/heypubli-journey.ts'));
const inboxRaw = read('src/features/crm/pages/InboxPage.tsx');

describe('snippet', () => {
  it('truncates with three full stops, never the ellipsis character', () => {
    // CLAUDE.md rule 11. In an SMS the ellipsis character alone drops the
    // segment from 160 characters to 70; in the UI it is simply the house
    // style, and one rule is cheaper to keep than two.
    const out = snippet('x'.repeat(80), 20);
    expect(out).toBe(`${'x'.repeat(20)}...`);
    expect(out).not.toMatch(/…/);
  });

  it('leaves a short message exactly as it is', () => {
    expect(snippet('I am interested', 48)).toBe('I am interested');
  });

  it('flattens the newlines a WhatsApp message is full of', () => {
    expect(snippet('Hello!\n\nFirst name: lakshmi', 100)).toBe('Hello! First name: lakshmi');
  });

  it('is empty for nothing, so a card renders a gap and not "undefined"', () => {
    expect(snippet(null)).toBe('');
    expect(snippet('   ')).toBe('');
  });
});

describe('the inbox card', () => {
  it('shows a preview of the last message', () => {
    expect(inbox).toMatch(/data-testid={`inbox-preview-\$\{r\.id\}`}/);
    expect(inbox).toMatch(/snippet\(/);
  });

  it('shows the step badge, n of 5', () => {
    expect(inbox).toMatch(/data-testid={`inbox-journey-\$\{r\.id\}`}/);
    expect(inbox).toContain('{r.journey.doneCount}/{r.journey.totalSteps}');
    // Five, from the shared list, never a hardcoded 5 in the page.
    expect(inbox).not.toMatch(/doneCount\}\/5/);
  });

  it('marks a lead with no account differently from a creator on 1 of 5', () => {
    // Hugo's words: a lead who has not signed up must not look like somebody
    // who has. Different testid, different wording, so the two can never be
    // read as the same state.
    expect(inbox).toMatch(/data-testid={`inbox-journey-lead-\$\{r\.id\}`}/);
    expect(inbox).toContain('lead');
  });

  it('drops "Website not available" for a creator, and only for a creator', () => {
    // These are individual people, not businesses; they will never have a
    // website. But the SAME inbox serves the Reviews product, where the
    // website is the whole point, so the line survives for everyone else.
    expect(inbox).toMatch(/\{!r\.isCreatorLead && \(/);
    expect(inbox).toMatch(/\{!activeIsCreatorLead && \(/);
    // The component itself is still there, for every other lead.
    expect(inbox).toContain('<ContactIdentity');
  });

  it('decides "is this a creator" from the stamp the funnel writes', () => {
    // custom_fields.product === 'heypubli', set by wk-partner-api and read by
    // wk-sms-incoming's fan-out. One stamp, three readers, no guessing.
    expect(inbox).toMatch(/product.*===.*'heypubli'|'heypubli'.*===.*product/);
  });
});

describe('the journey panel', () => {
  it('replaced the near-empty contact timeline', () => {
    expect(inbox).toContain('<JourneyPanel');
    expect(inbox).not.toContain('Contact timeline');
  });

  it('lists all five steps with the timestamp each was completed', () => {
    expect(panel).toMatch(/journey\.steps\.map/);
    expect(panel).toMatch(/data-testid={`journey-step-\$\{s\.id\}`}/);
    expect(panel).toContain('formatDateTime(s.at)');
  });

  it('says what happens next, and when', () => {
    expect(panel).toMatch(/nextTouch\(/);
    expect(panel).toMatch(/data-testid="journey-next"/);
    expect(panel).toMatch(/dueLabel\(/);
  });

  it('says plainly that a reply cancels the follow-up', () => {
    // The detail sentences live in the shared module so the panel cannot
    // invent a different promise from the one the ladder keeps.
    const journey = read('src/core/heypubli/journey.ts');
    expect(journey).toContain('cancelled if they reply first');
    expect(journey).toContain('cancelled the moment they reply');
  });

  it('shows the won state instead of a next follow-up', () => {
    expect(panel).toMatch(/data-testid="journey-done"/);
  });

  it('shows who opened the conversation, and when they signed up', () => {
    // NOT "our first outbound". A Facebook lead ad makes the LEAD send the
    // first message, so labelling our first message "we wrote first" put a
    // falsehood at the top of most of these threads.
    expect(panel).toContain("'They messaged us first' : 'We wrote first'");
    expect(panel).toContain('const firstEver = byTime[0]');
    expect(panel).toContain("title: 'Signed up'");
    expect(panel).toContain('ts: journey.signedUpAt');
  });

  it('shows their replies and ours as events', () => {
    expect(panel).toMatch(/direction === 'inbound'/);
  });

  it('shows the video events from the tracking that already exists', () => {
    // wk_vsl_events, read by useContactTimeline. Nothing new was built for
    // this; a second video tracker would be the bug.
    expect(inbox).toMatch(/funnel=\{timeline\.funnel\}/);
    expect(panel).toMatch(/funnel/);
  });

  it('does not re-derive the step list', () => {
    expect(panel).toMatch(/from '@\/core\/heypubli\/journey'/);
    expect(panel).not.toMatch(/'instagram',\s*'community'/);
  });
});

describe('the cross-project lookup', () => {
  it('goes through a server route, never straight from the browser', () => {
    // A second Supabase project with its own service key. The browser has no
    // session there and must never hold that key.
    expect(hook).toContain("fetch('/api/crm/heypubli-journey'");
    expect(hook).not.toMatch(/HEYPUBLI_SERVICE_ROLE_KEY/);
    expect(api).toMatch(/process\.env\.HEYPUBLI_SUPABASE_URL/);
    expect(api).toMatch(/process\.env\.HEYPUBLI_SERVICE_ROLE_KEY/);
  });

  it('joins on the phone number, digits only', () => {
    expect(api).toMatch(/phoneKey\(/);
    expect(hook).toMatch(/phoneKey\(/);
  });

  it('reads Instagram from outstand_connections, never instagram_connections', () => {
    // instagram_connections is empty and always has been. Reading it is how a
    // connected creator got reported to Hugo as not connected.
    expect(api).toContain('outstand_connections');
    expect(api).not.toContain('instagram_connections');
  });

  it('is staff-gated', () => {
    expect(api).toMatch(/wk_is_agent_or_admin/);
    expect(api).toMatch(/Unauthorized/);
  });

  it('degrades instead of 500ing when the keys are missing', () => {
    // This decorates the inbox. It must never be the reason the conversation
    // list fails to render.
    expect(api).toMatch(/configured: false/);
  });

  it('is read-only', () => {
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(api).not.toContain(write);
    }
  });

  it('resolves the phones against wk_contacts with the caller own token first', () => {
    // The HeyPubli query runs on a SERVICE ROLE key, which ignores row-level
    // security. Without this the staff gate alone would let any contractor
    // agent post arbitrary numbers and harvest creator names and emails.
    // Behaviour is pinned in tests/heypubli-journey-route.test.ts.
    expect(api).toContain("who.client");
    expect(api).toContain("'wk_contacts'");
  });
});

describe('could not check is not the same as they never signed up', () => {
  it('carries a tri-state out of the hook, not a bare map', () => {
    // The env vars are not set in production yet. Rendering "they have not
    // signed up" for a lookup that never ran would have shown Hugo every
    // fully onboarded creator as a stranger.
    expect(hook).toMatch(/'loading'/);
    expect(hook).toMatch(/'unavailable'/);
    expect(hook).toMatch(/'ready'/);
    expect(hook).toMatch(/status/);
  });

  it('starts as loading, so the false sentence cannot flash on first paint', () => {
    expect(hook).toMatch(/useState[^;]*'loading'/s);
  });

  it('gives the panel the status, and the panel uses it', () => {
    expect(inbox).toMatch(/journeyStatus=\{/);
    expect(panel).toContain('journeyStatus');
    expect(panel).toMatch(/data-testid="journey-unknown"/);
    expect(panel).toContain('Cannot check HeyPubli right now');
  });

  it('shows no step chip at all when the lookup could not run', () => {
    // Not a "lead" chip, which is a positive claim that they have no account.
    expect(inbox).toMatch(/journeyStatus === 'ready'/);
  });

  it('keeps the honest no-account wording for the case we really did check', () => {
    expect(panel).toContain('No account yet.');
    expect(panel).toMatch(/data-testid="journey-no-account"/);
  });
});

describe('the lookup only asks about creator leads', () => {
  it('never posts a plumber or a Reviews customer to the HeyPubli project', () => {
    // 125 HeyPubli contacts against 5,531 everybody else. Posting all of them
    // was wasted work, it blew the route cap, and it is what made the
    // service-role read worth attacking.
    expect(inbox).toMatch(/journeyContacts[\s\S]{0,400}isHeypubliProduct|journeyContacts[\s\S]{0,400}'heypubli'/);
  });

  it('chunks as a guard rail so growth past the cap is a non-event', () => {
    expect(hook).toMatch(/CHUNK\w*\s*=\s*200/);
    expect(hook).toMatch(/Promise\.all/);
  });

  it('does not let one failed chunk blank the ones that worked', () => {
    expect(hook).toMatch(/anyFailed/);
  });
});

describe('the house punctuation rule', () => {
  const BAD = /[–—‘’“”…]/;

  it('puts no long dash, curly quote or ellipsis character in the journey files', () => {
    for (const f of [
      'src/features/crm/hooks/useHeypubliJourney.ts',
      'src/features/crm/components/journey/JourneyPanel.tsx',
      'api/crm/heypubli-journey.ts',
      'scripts/backfill-lead-names.mjs',
      'scripts/repair-lead-names.mjs',
    ]) {
      expect(read(f), f).not.toMatch(BAD);
    }
  });

  it('names pane 3 of the inbox without one', () => {
    // InboxPage.tsx is years of other people's comments and is not in scope
    // here; this pins the block this feature added.
    expect(inboxRaw).not.toContain('Pane 3 —');
    expect(inboxRaw).toContain('<JourneyPanel');
  });
});
