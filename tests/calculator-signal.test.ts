import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Hugo 2026-07-27: "add a track as well for the leads that played with
// calculator, maybe just add a Calculator Icon, when that happens, add the icon
// on the lead card across the entire crm."
//
// The beacon already existed end to end (page sends it, track accepts it, the
// CHECK permits it) and had fired zero times, because nothing anywhere showed
// it to a human. An event row is not a lead card.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const mig = read('supabase/migrations/20260727000013_vsl_calculator.sql');
const track = stripComments(read('api/vsl/track.ts'));
const settings = stripComments(read('api/lib/vsl-settings.ts'));
const notify = stripComments(read('api/lib/vsl-notify.ts'));
const chip = stripComments(read('src/features/crm/components/shared/CalcChip.tsx'));

describe('the migration', () => {
  it('denormalises onto the page, so a 1,100-card board needs no extra query', () => {
    expect(mig).toMatch(/add column if not exists calc_at\s+timestamptz/);
    expect(mig).toMatch(/add column if not exists calc_count/);
  });

  it('backfills from the events already logged', () => {
    expect(mig).toMatch(/from wk_vsl_events where type = 'calc'/);
  });

  it('re-revokes after the DROP — the function is SECURITY DEFINER', () => {
    // CREATE grants EXECUTE to PUBLIC. Without the revoke, anon could call it
    // and set any page to 'paid'. This has bitten before.
    const dropIdx = mig.indexOf('drop function if exists public.wk_vsl_advance');
    const revokeIdx = mig.indexOf('revoke all on function public.wk_vsl_advance');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(revokeIdx).toBeGreaterThan(dropIdx);
    // `authenticated` explicitly: Supabase default privileges grant EXECUTE on
    // NEW functions to it, so a DROP+CREATE silently widens the ACL. Observed
    // for real when this migration was applied.
    expect(mig).toMatch(/from public, anon, authenticated/);
    expect(mig).toMatch(/grant execute on function public\.wk_vsl_advance[\s\S]{0,200}to service_role/);
  });

  it('derives first_calc from the COUNTER, like every other first-touch flag', () => {
    // Timestamps are written only on a rank advance, so a dropped beacon would
    // leave one NULL forever and every reload would re-report "first".
    expect(mig).toMatch(/v_first_calc\s*:=\s*p_calc\s+and\s+r\.calc_count\s*=\s*0/);
  });

  it('never lets the calculator count as watched', () => {
    // Playing with the calculator proves presence on the page, nothing more.
    expect(track).toMatch(/type === 'calc'[\s\S]{0,400}advanceVslState\(page, 'opened'/);
    expect(track).not.toMatch(/type === 'calc'[\s\S]{0,400}'watched'/);
  });
});

describe('the signal reaches the server', () => {
  it('advanceVslState forwards it to the RPC', () => {
    expect(settings).toMatch(/calc\?: boolean;/);
    expect(settings).toMatch(/p_calc: extra\.calc \?\? false/);
    expect(settings).toMatch(/first_calc: boolean;/);
  });

  it('has a notification kind AND a toggle, or it would email unconditionally', () => {
    // The email gate is `settings.notify[key] !== false`, so an UNKNOWN key
    // emails by default. The toggle is required, not cosmetic.
    expect(notify).toMatch(/vsl_calc: \{ label:/);
    expect(settings).toMatch(/\n\s*calc: boolean;/);
    expect(settings).toMatch(/calc: true,/);
  });
});

describe('the icon', () => {
  it('renders nothing at all when the lead never touched it', () => {
    // A greyed-out calculator on 3,500 leads trains everyone to stop seeing
    // the lit one.
    expect(chip).toMatch(/if \(!calcAt\) return null;/);
  });

  it('says what it means on hover, with the count and the time', () => {
    expect(chip).toMatch(/Played with the value calculator/);
    expect(chip).toMatch(/Europe\/London/);
    expect(chip).toMatch(/data-testid="calc-chip"/);
  });

  it('is on every lead surface in the CRM', () => {
    for (const f of [
      'src/features/crm/pages/VideoFunnelPage.tsx',
      'src/features/crm/pages/InboxPage.tsx',
      'src/features/crm/pages/PipelinesPage.tsx',
      'src/features/crm/pages/ContactsPage.tsx',
      'src/features/crm/pages/ContactDetailPage.tsx',
      'src/features/crm/dialer-pro/DialerProPage.tsx',
    ]) {
      expect(`${f}: ${/<CalcChip/.test(read(f))}`).toBe(`${f}: true`);
    }
  });

  it('is fed by the two shared batched hooks, never a per-card query', () => {
    const fn = read('src/features/crm/hooks/useContactFunnelStatus.ts');
    const vp = read('src/features/crm/hooks/useContactVslPages.ts');
    expect(fn).toMatch(/calc_at, calc_count/);
    expect(fn).toMatch(/calcAt: r\.calc_at \?\? null/);
    expect(vp).toMatch(/calc_at, calc_count/);
    expect(vp).toMatch(/calcAt: r\.calc_at \?\? null/);
  });

  it('memoises the single-contact id lists, or the query refires every render', () => {
    for (const f of [
      'src/features/crm/pages/ContactDetailPage.tsx',
      'src/features/crm/dialer-pro/DialerProPage.tsx',
    ]) {
      expect(`${f}: ${/const funnelIds = useMemo\(/.test(read(f))}`).toBe(`${f}: true`);
    }
  });
});
