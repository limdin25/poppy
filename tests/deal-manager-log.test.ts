// The cockpit's memory, and the two ways it could leak.
//
// Written 2026-08-15 with the table itself. Hugo asked for "a dedicated log
// column showing the full history and reasoning for every move", and a history
// is only worth having if it cannot be forged and cannot show the wrong person
// the wrong thing.
//
// The two rules this file exists to hold:
//
//   1. NOBODY WRITES TO IT FROM A BROWSER. Every row is service-role, written
//      after the stress test ran. A browser that could insert here could write
//      a log entry saying an offer was approved.
//   2. HUGO'S LANE IS IN THE DATABASE, NOT IN A FILTER. blocked_needs_hugo,
//      figure_mismatch and stage_mismatch reach Hugo only. Putting that in RLS
//      means a future page that forgets to filter still cannot leak it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const SQL = readFileSync(
  resolve(root, 'supabase/migrations/20260815000002_deal_manager_log.sql'),
  'utf8',
);

describe('the table', () => {
  it('exists and hangs off the property', () => {
    expect(SQL).toMatch(/create table if not exists public\.wk_deal_manager_log/);
    // Cascade: a house that is deleted takes its history with it rather than
    // leaving orphan rows the cockpit would try to render against nothing.
    expect(SQL).toMatch(/property_id\s+uuid not null references public\.brrr_properties\(id\) on delete cascade/);
  });

  it('carries all five kinds of event, because one stream is the point', () => {
    for (const kind of [
      'assessment', 'fallback_refused', 'action_executed', 'action_blocked', 'human_note',
    ]) {
      expect(SQL).toContain(`'${kind}'`);
    }
    expect(SQL).toMatch(/kind text not null check \(kind in \(/);
  });

  it('freezes the state and the checks rather than joining them', () => {
    // A deal is re-priced every night. A join would show today's reasoning
    // beside next week's numbers.
    expect(SQL).toMatch(/state\s+jsonb/);
    expect(SQL).toMatch(/checks\s+jsonb/);
    expect(SQL).toMatch(/comment on column public\.wk_deal_manager_log\.state is/);
  });

  it('holds the four reads the cockpit actually makes', () => {
    expect(SQL).toMatch(/wk_deal_manager_log_property_idx[\s\S]*?\(property_id, created_at desc\)/);
    expect(SQL).toMatch(/wk_deal_manager_log_created_idx[\s\S]*?\(created_at desc\)/);
    expect(SQL).toMatch(/wk_deal_manager_log_latest_assessment_idx[\s\S]*?where kind in \('assessment', 'fallback_refused'\)/);
    expect(SQL).toMatch(/wk_deal_manager_log_hash_idx[\s\S]*?where kind = 'assessment'/);
  });
});

describe('who can read it, and who can write it', () => {
  it('has row level security switched on', () => {
    expect(SQL).toMatch(/alter table public\.wk_deal_manager_log enable row level security/);
  });

  it('lets staff read, and names all three escalation flags as Hugo only', () => {
    const policy = SQL.match(/create policy wk_deal_manager_log_read[\s\S]*?;/)?.[0] ?? '';
    expect(policy).toMatch(/wk_is_agent_or_admin\(\)/);
    expect(policy).toMatch(/wk_is_admin\(\)/);
    for (const flag of ['blocked_needs_hugo', 'figure_mismatch', 'stage_mismatch']) {
      expect(policy).toContain(flag);
    }
  });

  it('gives NOBODY an insert or update policy', () => {
    // Not "no policy we happened to write". The absence is the security
    // property, so the test asserts the absence rather than the presence.
    const forInsert = /create policy[\s\S]*?for insert/i.test(SQL);
    const forUpdate = /create policy[\s\S]*?for update/i.test(SQL);
    expect(forInsert).toBe(false);
    expect(forUpdate).toBe(false);
    // The one `for all` policy is admin-gated on both sides of the fence.
    const all = SQL.match(/create policy wk_deal_manager_log_admin_all[\s\S]*?;/)?.[0] ?? '';
    expect(all).toMatch(/using \(wk_is_admin\(\)\) with check \(wk_is_admin\(\)\)/);
  });
});

describe('the cockpit read', () => {
  it('is security definer with the staff gate INSIDE it', () => {
    // SECURITY DEFINER bypasses RLS, so the predicate is the only door.
    expect(SQL).toMatch(/create function public\.wk_deal_cockpit_rows/);
    expect(SQL).toMatch(/language sql stable security definer set search_path = public/);
    expect(SQL).toMatch(/public\.wk_is_agent_or_admin\(\)\)/);
  });

  it('names the service role explicitly, or the cron sweeps nothing forever', () => {
    // wk_is_agent_or_admin() reads auth.uid() and the JWT email. A server holds
    // neither, so it returns FALSE for the service role. Without this clause
    // api/cron/deal-sweep.ts gets zero rows on every run and reports a clean
    // sweep of nothing, which is the same silent-empty-result shape that hid
    // the missing wk_calls.disposition column.
    //
    // Verified against the live database on 2026-08-15: service role 179 rows,
    // Pedro's own account 179 rows, anon denied outright.
    expect(SQL).toMatch(/where \(auth\.role\(\) = 'service_role' or public\.wk_is_agent_or_admin\(\)\)/);
  });

  it('is revoked from public and anon', () => {
    // A fresh SECURITY DEFINER function is EXECUTE to public until told
    // otherwise. This is the same load-bearing revoke as wk_vsl_advance.
    expect(SQL).toMatch(/revoke all on function public\.wk_deal_cockpit_rows\(int\) from public, anon/);
    expect(SQL).toMatch(/grant execute on function public\.wk_deal_cockpit_rows\(int\) to authenticated/);
  });

  it('drops before creating, because the row type changes', () => {
    const drop = SQL.indexOf('drop function if exists public.wk_deal_cockpit_rows');
    const create = SQL.indexOf('create function public.wk_deal_cockpit_rows');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  it('resolves a call outcome by JOIN, because wk_calls has no disposition column', () => {
    // The bug this replaces: api/crm/deal-manager.ts selected a column called
    // `disposition`, which does not exist, so the query errored and every deal
    // came back with an empty call history and looked untouched.
    expect(SQL).toMatch(/'disposition', kcol\.name/);
    expect(SQL).toMatch(/left join wk_pipeline_columns kcol on kcol\.id = k\.disposition_column_id/);
    expect(SQL).not.toMatch(/k\.disposition\b(?!_column_id)/);
  });

  it('returns histories as arrays, so buildDealState stays the only aggregator', () => {
    // Returning counts here would put a second opinion on "the last touch" in
    // SQL, and two places deciding one fact is the bug this codebase keeps
    // having.
    expect(SQL).toMatch(/calls\s+jsonb/);
    expect(SQL).toMatch(/messages\s+jsonb/);
    expect(SQL).toMatch(/followups\s+jsonb/);
    expect(SQL).toMatch(/coalesce\(cl\.rows, '\[\]'::jsonb\)/);
  });

  it('leaves withdrawn and dead houses out of somebody\'s day', () => {
    expect(SQL).toMatch(/p\.status not in \('auditor_killed', 'not_qualified'\)/);
  });

  it('caps what one call can pull back', () => {
    expect(SQL).toMatch(/limit greatest\(1, least\(coalesce\(p_limit, 200\), 400\)\)/);
  });
});

describe('house rules', () => {
  it('has no long dashes and no curly punctuation', () => {
    // Hugo, 2026-07-27: "no long dashes ever, we don't use."
    expect(SQL).not.toMatch(/[–—‘’“”…]/);
  });
});
