import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), builders: {} as Record<string, any> }));
vi.mock('@/integrations/supabase/browser', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

import { TRAINING_LABEL, setTrainingMaterial } from '../src/features/crm/lib/trainingMaterial';
import TrainingMaterialToggle from '../src/features/crm/components/live-call/TrainingMaterialToggle';
import { fetchPage } from '../src/features/crm/dialer-pro/history/CallHistoryPro';
import { ObjectionsList, filterObjections, type ObjectionRow } from '../src/features/crm/pages/ObjectionsPage';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const migration = read('supabase/migrations/20261003000001_training_material_and_objections.sql');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    const b: any = {};
    for (const m of ['select', 'eq', 'order', 'range', 'in', 'maybeSingle']) b[m] = vi.fn(() => b);
    b.then = (ok: any) => Promise.resolve({ data: [], count: 3, error: null }).then(ok);
    mocks.builders[table] = b;
    return b;
  });
});

describe('Good objections / training material', () => {
  it('uses the exact label Pedro asked for', () => {
    expect(TRAINING_LABEL).toBe('Good objections / training material');
    const html = renderToStaticMarkup(createElement(TrainingMaterialToggle, { callId: 'c1', initial: false }));
    expect(html).toContain('Good objections / training material');
    expect(renderToStaticMarkup(createElement(TrainingMaterialToggle, { callId: null }))).toBe('');
  });

  it('is a separate tag that never clobbers the outcome, the stage, the next step or do not contact', () => {
    const fn = migration.slice(migration.indexOf('create or replace function public.wk_set_training_material'), migration.indexOf('revoke all on function'));
    expect(fn).toMatch(/set training_material = p_on/);
    for (const forbidden of ['disposition_column_id', 'pipeline_column_id', 'do_not_call', 'next_step', 'wk_contacts', 'status =']) expect(fn).not.toContain(forbidden);
    expect(fn).toContain('security definer');
    expect(fn).toContain('(c.agent_id = auth.uid() or public.wk_is_admin())');
    expect(migration).toContain('revoke all on function public.wk_set_training_material(uuid, boolean, text) from public, anon;');
    // The outcome buttons are untouched: the tag is not one of them.
    const pane = read('src/features/crm/components/live-call/SaListingPane.tsx');
    expect(pane).toContain('<TrainingMaterialToggle callId={currentCallId} />');
    expect(pane).not.toMatch(/key: 'training/);
    expect(read('api/crm/sa-outcome.ts')).not.toMatch(/training/);
  });

  it('saves through the narrow database function', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await setTrainingMaterial('call-1', true, 'great price objection');
    expect(mocks.rpc).toHaveBeenCalledWith('wk_set_training_material', { p_call: 'call-1', p_on: true, p_note: 'great price objection' });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(setTrainingMaterial('someone-elses', true)).rejects.toThrow(/only tag your own calls/);
  });

  it('history filters by the tag inside the current desk and counts the tagged calls', async () => {
    const page = await fetchPage(0, 'pedro', 'sa', true);
    const eq = mocks.builders.wk_calls.eq;
    expect(eq).toHaveBeenCalledWith('desk', 'sa');
    expect(eq).toHaveBeenCalledWith('training_material', true);
    expect(eq).toHaveBeenCalledWith('agent_id', 'pedro');
    expect(page.trainingTotal).toBe(3);
    const history = read('src/features/crm/dialer-pro/history/CallHistoryPro.tsx');
    expect(history).toContain('<TrainingMaterialToggle callId={call.id}');
    expect(read('src/features/crm/pages/CallsPage.tsx')).toContain("searchParams.get('training') === '1'");
  });
});

describe('wk_objections access', () => {
  it('agents read, only admins write, RLS on', () => {
    expect(migration).toContain('alter table public.wk_objections enable row level security;');
    expect(migration).toMatch(/wk_objections_read on public\.wk_objections\s+for select to authenticated using \(public\.wk_is_agent_or_admin\(\)\)/);
    expect(migration).toMatch(/wk_objections_admin_write on public\.wk_objections\s+for all to authenticated using \(public\.wk_is_admin\(\)\) with check \(public\.wk_is_admin\(\)\)/);
  });
  it('the page reads only the current desk and only active rows', () => {
    const page = read('src/features/crm/pages/ObjectionsPage.tsx');
    expect(page).toMatch(/\.eq\('desk', desk\)\s*\n\s*\.eq\('is_active', true\)/);
  });
  it('the sidebar shows Objections on the Hostunico desk only', () => {
    const nav = read('src/features/crm/layout/Smsv2Sidebar.tsx');
    expect(nav).toContain("{ label: 'Objections', path: '/admin/crm/objections'");
    expect(nav).toMatch(/SA_NAV = new Set\(\[[^\]]*'Objections'/);
    expect(nav).toContain("desk === 'sa' || !['Report follow-ups', 'Objections'].includes(label)");
    expect(read('src/features/crm/CrmApp.tsx')).toContain('<Route path="objections" element={<ObjectionsPage />} />');
  });
});

describe('the Objections page', () => {
  const rows: ObjectionRow[] = [
    { id: '1', category: 'Timing', objection: 'I need to think about it.', example_quotes: [], call_ids: [], times_heard: 0, best_rebuttal: 'Of course.', our_rebuttal_seen: null, created_at: '2026-10-03T22:00:00Z' },
    { id: '2', category: 'Price', objection: 'Your fee is too expensive.', example_quotes: ['the fee is a lot'], call_ids: ['c1', 'c2'], times_heard: 8, best_rebuttal: 'Most managers charge somewhere between 15 and 20 percent, ours is 9 percent plus VAT.', our_rebuttal_seen: 'It is 9 percent.', created_at: '2026-10-03T22:00:00Z' },
  ];
  it('sorts by times heard and searches every field', () => {
    expect(filterObjections(rows, '').map((r) => r.id)).toEqual(['2', '1']);
    expect(filterObjections(rows, 'fee is a lot').map((r) => r.id)).toEqual(['2']);
    expect(filterObjections(rows, 'nothing like this')).toEqual([]);
  });
  it('renders the note, the answer to say and links to re-listen to the calls', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ObjectionsList, { rows, query: '', myCalls: new Set(['c1']) })));
    expect(html).toContain('Generated on 3 October 2026 from 2 real calls');
    expect(html).toContain('Say this');
    expect(html).toContain('Heard 8 times');
    expect(html).toContain('Standard objection');
    expect(html).toContain('href="/admin/crm/calls/c1"');
    expect(html).not.toContain('/admin/crm/calls/c2');
    expect(html).not.toMatch(/[‒-―‘’“”…]/);
  });
});
