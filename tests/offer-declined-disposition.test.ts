// Offer declined disposition: pipeline column + property outcome button stay wired
// together. If one drifts the card moves nowhere or the button 400s.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MIGRATION = read('supabase/migrations/20260907000001_ai_dev_hotkey_column.sql');
const RENAME = read('supabase/migrations/20260907000002_rename_ai_dev_hotkey_to_offer_declined.sql');
const OUTCOME = read('api/crm/property-outcome.ts');
const PANE = read('src/features/crm/components/live-call/PropertiesPane.tsx');

describe('Offer declined disposition', () => {
  it('migration adds the column on the property board only, idempotently', () => {
    expect(MIGRATION).toMatch(/name = 'Offer declined'/);
    expect(MIGRATION).toMatch(/name = 'Ballpark agreed'/);
    expect(MIGRATION).toMatch(/name = 'Follow up'/);
    expect(MIGRATION).toMatch(/if exists/);
  });

  it('renames the mistaken AI_DEV_HOTKEY column on boards that already have it', () => {
    expect(RENAME).toMatch(/AI_DEV_HOTKEY/);
    expect(RENAME).toMatch(/Offer declined/);
  });

  it('property-outcome accepts offer_declined and maps it to the column name', () => {
    expect(OUTCOME).toMatch(
      /const OUTCOMES = \['qualified', 'figure_obtained', 'deciding', 'follow_up', 'offer_declined', 'not_qualified', 'callback', 'no_answer'\]/,
    );
    expect(OUTCOME).toMatch(/offer_declined: 'Offer declined'/);
    expect(OUTCOME).not.toMatch(/PIPELINE_OUTCOMES.*offer_declined/);
  });

  it('the Houses tab shows a matching outcome button', () => {
    expect(PANE).toMatch(/key: 'offer_declined'/);
    expect(PANE).toMatch(/label: 'Offer declined'/);
  });
});
