import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Hugo 2026-07-27: "when I go to templates, I don't see the templates for
// sending the video. It should be there as well."
//
// The video messages live in platform_settings.vsl_automation, not in
// wk_sms_templates — so the Templates page genuinely never showed them. An
// agent reading Templates was reading an incomplete list of what this CRM
// sends on their behalf.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = stripComments(read('src/features/crm/pages/TemplatesPage.tsx'));
const list = stripComments(read('src/features/crm/components/templates/VideoTemplateList.tsx'));
const api = stripComments(read('api/crm/vsl-templates.ts'));

describe('the Templates page', () => {
  it('has a Video tab beside SMS / WhatsApp / Email', () => {
    expect(page).toMatch(/id: 'video'/);
    expect(page).toMatch(/<VideoTemplateList/);
  });
});

describe('the Video template list', () => {
  it('shows the message the agent sends on the call', () => {
    expect(list).toMatch(/send_template/);
    expect(list).toMatch(/send_template_no_site/);
  });

  it('shows every automatic follow-up too, so nothing sends unseen', async () => {
    // This used to grep for five hardcoded keys. It kept its own list, so when
    // the sequence was rebuilt on 2026-07-27 the page rendered NOTHING for the
    // new rules and an agent reading it saw an empty follow-up section. Both the
    // order and the wording now come from the sequence, so the page cannot fall
    // behind the schedule again.
    expect(list).toMatch(/RULE_ORDER = VSL_SEQUENCE\.map/);
    expect(list).toMatch(/VSL_SEQUENCE\.map\(\(r\) => \[r\.key, r\.label\]\)/);
    const { VSL_SEQUENCE } = await import('../api/lib/vsl-sequence');
    expect(VSL_SEQUENCE.length).toBeGreaterThanOrEqual(15);
    for (const r of VSL_SEQUENCE) expect(r.label.length).toBeGreaterThan(3);
  });

  it('says which follow-ups are switched off rather than hiding them', () => {
    expect(list).toMatch(/Off|Paused/);
  });

  it('explains the merge fields — they are not the {first_name} used elsewhere', () => {
    // The SMS worker substitutes {first_name}; the video templates take
    // {first} {business} {url} {agent}. Two different vocabularies on one page
    // is exactly how someone writes a token that never fills.
    expect(list).toMatch(/\{first\}/);
    expect(list).toMatch(/\{business\}/);
    expect(list).toMatch(/\{url\}/);
    expect(list).toMatch(/\{agent\}/);
  });

  it('is read-only for an agent and editable for an admin', () => {
    expect(list).toMatch(/isAdmin/);
  });
});

describe('the route behind it', () => {
  it('lets any CRM agent READ what goes out in their name', () => {
    expect(api).toMatch(/wk_is_agent_or_admin/);
  });

  it('lets only an admin write', () => {
    expect(api).toMatch(/requireAdmin|is_admin/);
  });

  it('saves through the shared deep-merge, never a whole-blob overwrite', () => {
    // saveVslSettings deep-merges; a raw upsert here would wipe the notify
    // toggles and the five rules the funnel page owns.
    expect(api).toMatch(/saveVslSettings/);
    expect(api).not.toMatch(/from\('platform_settings'\)/);
  });
});
