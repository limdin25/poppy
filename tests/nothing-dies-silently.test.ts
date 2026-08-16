// NOTHING DIES SILENTLY (16 Aug 2026, the unbreakable audit, phase 2).
//
// The failure class: a broken query returns {error} that nobody reads, an
// empty result wears the same face as a quiet day, and a cron returns 200
// whatever happened downstream. These pins keep the loud paths loud.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('the deadman watches, and the beats exist', () => {
  it('the system deadman cron is registered every 10 minutes', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };
    const entry = vercel.crons.find((c) => c.path === '/api/cron/system-deadman');
    expect(entry?.schedule).toBe('*/10 * * * *');
  });

  it('the deal sweep stamps its heartbeat after a successful run', () => {
    expect(read('api/cron/deal-sweep.ts')).toMatch(/deal_sweep_last_ok_at/);
  });

  it('the VPS heartbeat endpoint exists and is behind the ingest secret', () => {
    const src = read('api/properties/heartbeat.ts');
    expect(src).toMatch(/x-ingest-secret/);
    expect(src).toMatch(/vps_overnight_last_ok_at/);
  });

  it('the deadman reads every beat it promises to watch', () => {
    const src = read('api/cron/system-deadman.ts');
    for (const beat of ['deal_sweep_last_ok_at', 'vps_overnight_last_ok_at', "'dead'", 'emailed_at']) {
      expect(src).toContain(beat);
    }
    // The test-fire switch: an untested alarm is not an alarm.
    expect(src).toMatch(/threshold.*=== '0'/);
  });
});

describe('failures answer with failure', () => {
  it('the jobs pump returns non-200 when a downstream worker failed', () => {
    const src = read('api/cron/crm-jobs-pump.ts');
    expect(src).toMatch(/status: ok \? 200 : 502/);
  });

  it('the report cron does not claim ok:true when the email died', () => {
    const src = read('api/cron/daily-agent-reports.ts');
    expect(src).toMatch(/reports saved but the email failed/);
  });

  it('a broken cockpit query THROWS instead of showing an empty, green board', () => {
    const src = read('api/lib/deal-manager-run.ts');
    expect(src).toMatch(/throw new Error\(`wk_deal_cockpit_rows failed/);
    expect(src).toMatch(/throw new Error\(`wk_deal_manager_log read failed/);
    expect(src).not.toMatch(/cockpit rows failed', error\.message\);\s*\n\s*return \[\]/);
  });

  it('a failed stages read offers NO move targets, never an unscoped list', () => {
    const src = read('api/crm/cockpit.ts');
    expect(src).toMatch(/colsErr \|\| propertyPipelineId === null \? \[\]/);
  });

  it('the health page reads {error} off its Supabase probes', () => {
    const src = read('api/admin/system/health.ts');
    expect(src).toMatch(/const \{ error \} = await supabaseAdmin\.from\('businesses'\)/);
  });

  it('a qualified deal that misses the pipeline is shouted, not swallowed', () => {
    const src = read('api/lib/brrr.ts');
    expect(src).toMatch(/QUALIFIED deal pipeline push FAILED/);
    expect(src).not.toMatch(/if \(outcome === 'qualified'\) \{\s*\n\s*await pushPropertyToPipeline\(property as BrrrProperty, qualification\)\.catch\(\(\) => null\)/);
  });

  it('owner notification reads use maybeSingle and say their errors', () => {
    const src = read('api/lib/notify.ts');
    expect(src).not.toMatch(/\.eq\('business_id', businessId\)\s*\n\s*\.single\(\)/);
    expect(src).toMatch(/settings read failed/);
  });
});
