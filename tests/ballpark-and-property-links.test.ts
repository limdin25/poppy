// A ballpark gets its own column, and every screen can reach the house.
//
// Hugo, 2026-08-11, after finding a live deal buried on the board:
//   "we need a new pipeline where it says ballpark achieved, where the calls
//    that we got the ballpark it goes there... next to the interested"
//   "if you want a link and go to rightmove from the pipeline or also from the
//    call recording we should be able to go and see the property. I have no
//    link to go see the property on rightmove."
//
// What made it urgent: Dixons agreed GBP 95,000 on the phone at 12:22 and then
// sat in Interested alongside sixty branches that had merely been polite, so
// the callback Pedro promised inside ten minutes never happened.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { phoneTail } from '../src/features/crm/hooks/usePropertyLinks';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SQL = read('supabase/migrations/20260811000001_ballpark_column_and_property_links.sql');
const OUTCOME = read('api/crm/property-outcome.ts');
const BOARD = read('src/features/crm/pages/PipelinesPage.tsx');
const CALLS = read('src/features/crm/pages/CallsPage.tsx');
const CHIPS = read('src/features/crm/components/shared/PropertyLinkChips.tsx');

describe('the phone number is the join, so it must normalise', () => {
  it('reads the scraper format and the E.164 format as the same branch', () => {
    // The scraper stores what Rightmove printed, the ingest route stores E.164.
    // If these two ever disagree the link silently disappears from every card
    // rather than erroring, which is the worst way for it to fail.
    expect(phoneTail('0121 387 6499')).toBe(phoneTail('+441213876499'));
    expect(phoneTail('(0161) 524-1077')).toBe(phoneTail('+441615241077'));
  });

  it('matches the last 9 digits, exactly like the SQL', () => {
    expect(phoneTail('+441213876499')).toBe('213876499');
    expect(SQL).toMatch(/right\(regexp_replace\(coalesce\([^)]*\), '\[\^0-9\]', '', 'g'\), 9\)/);
  });

  it('refuses a number too short to identify anybody', () => {
    // A blank or stubby number tail-matches half the table. Both sides drop it.
    expect(phoneTail('12345')).toBe('');
    expect(phoneTail(null)).toBe('');
    expect(phoneTail(undefined)).toBe('');
    expect(SQL).toMatch(/length\(regexp_replace\(coalesce\([^)]*\), '\[\^0-9\]', '', 'g'\)\) >= 9/);
  });
});

describe('the Ballpark column', () => {
  it('lands immediately after Interested, which is where Hugo asked for it', () => {
    expect(SQL).toMatch(/name = 'Interested'/);
    expect(SQL).toMatch(/v_pos \+ 1/);
  });

  it('requires a follow-up, because a ballpark is a promise to ring back', () => {
    // The Dixons failure in one column setting: the branch agreed a figure and
    // nothing on the board ever asked why nobody had rung them back.
    expect(SQL).toMatch(/'Ballpark',\s*'#B8860B',\s*v_pos \+ 1,\s*v_pos \+ 1,\s*true/);
  });

  it('makes room in two hops, because (pipeline_id, position) is UNIQUE', () => {
    // A straight "position = position + 1" is checked row by row and collides
    // with the row still sitting in the target slot. This failed for real when
    // the migration was first applied.
    expect(SQL).toMatch(/position \+ 1000/);
    expect(SQL).toMatch(/position - 999/);
    expect(SQL).not.toMatch(/set\s+position\s*=\s*position \+ 1\b/);
  });

  it('is idempotent, so re-running the migration adds nothing', () => {
    expect(SQL).toMatch(/if exists \([\s\S]*?name = 'Ballpark'[\s\S]*?\) then\s*continue;/);
  });

  it('leaves the HeyPubli Creators board alone', () => {
    // That pipeline has no Interested column and must never gain a Ballpark.
    expect(SQL).toMatch(/pipeline_id in \(select pipeline_id from wk_pipeline_columns where name = 'Voicemail'\)/);
  });
});

describe('pressing Figure obtained moves the branch card', () => {
  it('moves it on the CRM board, which is a different table from the BRRR board', () => {
    // pushPropertyToPipeline() files the PROPERTY under "Awaiting director" in
    // pipeline_stages. The board Hugo watches is wk_pipeline_columns, and
    // nothing moved a card there until this. Generalised 2026-08-11 from a
    // hardcoded Ballpark to a per-outcome column map (BOARD_COLUMN_FOR), so
    // the column name is now a variable.
    expect(OUTCOME).toMatch(/from\('wk_pipeline_columns'\)[\s\S]*?\.eq\('name', targetColumn\)/);
    expect(OUTCOME).toMatch(/pipeline_column_id: col\.id/);
  });

  it('maps figure_obtained to Ballpark, and the warm states to their own columns', () => {
    // The move is now driven by a table. Figure obtained still lands in
    // Ballpark; Deciding and Follow up (added 2026-08-11) each get their own.
    expect(OUTCOME).toMatch(/figure_obtained: 'Ballpark agreed'/);
    expect(OUTCOME).toMatch(/deciding: 'Offer sent'/);
    expect(OUTCOME).toMatch(/follow_up: 'Follow up'/);
    // The two-call funnel (2026-08-14): a finished discovery call parks the
    // branch under evaluating, so it cannot vanish from the board.
    expect(OUTCOME).toMatch(/qualified: 'Discovery done, evaluating'/);
    // Only mapped outcomes move a card; the rest leave it where it is.
    expect(OUTCOME).toMatch(/const targetColumn = BOARD_COLUMN_FOR\[outcome\]/);
    expect(OUTCOME).toMatch(/if \(targetColumn && property\.wk_contact_id\)/);
  });

  it("uses a stage_move_source the CHECK constraint actually allows", () => {
    // wk_contacts allows agent / automation / import / backfill and nothing
    // else. 'property_outcome' was written first and would have thrown into
    // the catch, leaving the card silently unmoved.
    expect(OUTCOME).toMatch(/stage_move_source: 'agent'/);
    expect(OUTCOME).not.toMatch(/stage_move_source: 'property_outcome'/);
  });

  it('never invents the column, and never fails the agent’s save', () => {
    // The outcome and the deal are already written by this point. A board that
    // did not move must not read back to Pedro as "your call did not save".
    expect(OUTCOME).not.toMatch(/from\('wk_pipeline_columns'\)[\s\S]{0,200}\.insert\(/);
    expect(OUTCOME).toMatch(/no \$\{targetColumn\} column on this board/);
    expect(OUTCOME).toMatch(/board_warning/);
  });

  it('looks for Ballpark on the board the contact is already on', () => {
    // A workspace with several pipelines must not fling the card onto a
    // foreign board just because the name matched there first.
    expect(OUTCOME).toMatch(/pipelineId \? q\.eq\('pipeline_id', pipelineId\) : q/);
  });
});

describe('the Rightmove link reaches both screens Hugo works in', () => {
  it('is on the board and in call history', () => {
    for (const [name, src] of [['PipelinesPage', BOARD], ['CallsPage', CALLS]] as const) {
      expect(src, name).toMatch(/PropertyLinkChips/);
      expect(src, name).toMatch(/usePropertyLinks/);
    }
  });

  it('asks once for the whole page, never once per row', () => {
    // 100 cards must not mean 100 round trips. Both pages pass the full list of
    // phones to the batched RPC.
    expect(SQL).toMatch(/wk_property_links\(p_phones text\[\]\)/);
    expect(BOARD).toMatch(/usePropertyLinks\(boardPhones\)/);
    expect(CALLS).toMatch(/usePropertyLinks\(callPhones\)/);
  });

  it('is staff-gated, because brrr_properties has no RLS at all', () => {
    expect(SQL).toMatch(/security definer/i);
    expect(SQL).toMatch(/public\.wk_is_agent_or_admin\(\)/);
    expect(SQL).toMatch(/revoke all on function public\.wk_property_links\(text\[\]\) from public, anon/);
  });

  it('never offers a chip that goes nowhere', () => {
    expect(SQL).toMatch(/p\.listing_url is not null/);
    expect(CHIPS).toMatch(/links\.length === 0\) return null/);
  });

  it('shows the overflow rather than hiding houses', () => {
    // One agency lists up to eight. A single "view property" link would pick
    // one and silently drop the rest.
    expect(CHIPS).toMatch(/\+\{hidden\.length\} more/);
  });

  it('does not open the edit modal behind the new tab', () => {
    // On the board this sits inside the card's own button.
    expect(CHIPS).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(CHIPS).toMatch(/rel="noopener noreferrer"/);
  });
});
