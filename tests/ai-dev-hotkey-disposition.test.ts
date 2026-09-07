// AI_DEV_HOTKEY disposition: pipeline column + property outcome button stay wired
// together. If one drifts the card moves nowhere or the button 400s.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MIGRATION = read('supabase/migrations/20260907000001_ai_dev_hotkey_column.sql');
const OUTCOME = read('api/crm/property-outcome.ts');
const PANE = read('src/features/crm/components/live-call/PropertiesPane.tsx');

describe('AI_DEV_HOTKEY disposition', () => {
  it('migration adds the column on the property board only, idempotently', () => {
    expect(MIGRATION).toMatch(/name = 'AI_DEV_HOTKEY'/);
    expect(MIGRATION).toMatch(/name = 'Voicemail'/);
    expect(MIGRATION).toMatch(/if exists/);
  });

  it('property-outcome accepts ai_dev_hotkey and maps it to the column name', () => {
    expect(OUTCOME).toMatch(
      /const OUTCOMES = \['qualified', 'figure_obtained', 'deciding', 'follow_up', 'ai_dev_hotkey', 'not_qualified', 'callback', 'no_answer'\]/,
    );
    expect(OUTCOME).toMatch(/ai_dev_hotkey: 'AI_DEV_HOTKEY'/);
    expect(OUTCOME).not.toMatch(/PIPELINE_OUTCOMES.*ai_dev_hotkey/);
  });

  it('the Houses tab shows a matching outcome button', () => {
    expect(PANE).toMatch(/key: 'ai_dev_hotkey'/);
    expect(PANE).toMatch(/label: 'AI_DEV_HOTKEY'/);
  });
});
