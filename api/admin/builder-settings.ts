// The builder outreach settings, with a screen for the first time.
//
// Until now the `builder_outreach` row in `platform_settings` had no reader and
// no writer anywhere in the product. The four Twilio template SIDs, the daily
// cap, the search radius and the auto-send switch were all edited by hand in
// the database, which is why nobody could tell whether a template was wired up
// without opening SQL.
//
// ADMIN ONLY, deliberately, while the rest of the Find builders desk is open to
// Pedro. Turning auto-send on, or pasting a new approved template, changes what
// goes out to real builders on every house at once. That is Hugo's press.
//
// EDGE is fine here: no Buffer, no Twilio call, just a read and a merge.

import { requireAdminAny } from '../lib/require-admin.js';
import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import {
  loadOutreachSettings,
  saveOutreachSettings,
  type OutreachSettings,
} from '../lib/builder-outreach.js';

export const config = { runtime: 'edge' };

const HX = /^HX[0-9a-f]{32}$/i;

/** Sanity, not paranoia. Each bound is the point past which the number stops
 *  describing anything real: a 100km "local builder" is an hour each way for a
 *  free quote, and a daily cap of 500 is not a cap. */
const NUMBERS: Record<string, { min: number; max: number }> = {
  daily_cap: { min: 1, max: 200 },
  radius_m: { min: 1_000, max: 40_000 },
  max_new_builders: { min: 1, max: 40 },
};

// One shape rather than a discriminated union: tsconfig.api.json is
// deliberately non-strict, so a union discriminated on a boolean literal does
// not narrow here and every read of .error is an error.
function validate(patch: Record<string, unknown>): { value?: Partial<OutreachSettings>; error?: string } {
  const out: Record<string, unknown> = {};

  if ('auto_send' in patch) {
    if (typeof patch.auto_send !== 'boolean') return { error: 'auto_send must be on or off.' };
    out.auto_send = patch.auto_send;
  }

  for (const [key, bound] of Object.entries(NUMBERS)) {
    if (!(key in patch)) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < bound.min || n > bound.max) {
      return { error: `${key.replace(/_/g, ' ')} must be a whole number between ${bound.min} and ${bound.max}.` };
    }
    out[key] = n;
  }

  for (const key of ['invite_sid', 'followup_sid', 'morning_sid', 'query_sid'] as const) {
    if (!(key in patch)) continue;
    const v = String(patch[key] ?? '').trim();
    // Empty is allowed and means "not wired up yet", which the block rules
    // already report as template_pending rather than failing at the wire.
    if (v && !HX.test(v)) {
      return { error: `${key.replace(/_/g, ' ')} must look like HX followed by 32 characters, or be left empty.` };
    }
    out[key] = v;
  }

  return { value: out as Partial<OutreachSettings> };
}

export default async function handler(req: Request): Promise<Response> {
  const admin = await requireAdminAny(req);
  if (admin instanceof Response) return admin;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;

  if (req.method === 'GET') {
    return Response.json({ settings: await loadOutreachSettings(sb) });
  }

  if (req.method === 'POST') {
    let body: { settings?: Record<string, unknown> };
    try { body = await req.json() as typeof body; }
    catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

    const checked = validate(body.settings ?? {});
    if (checked.error) return Response.json({ error: checked.error }, { status: 400 });
    const patch = checked.value ?? {};
    if (!Object.keys(patch).length) {
      return Response.json({ error: 'Nothing to save.' }, { status: 400 });
    }

    // saveOutreachSettings merges onto what is already there, so a screen that
    // only knows about invite_sid can never blank query_sid and silently stop
    // every ops escalation.
    const settings = await saveOutreachSettings(sb, patch);

    await sb.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'builder_settings_save',
      target_type: 'platform_settings',
      metadata: { changed: Object.keys(patch) },
    });

    return Response.json({ ok: true, settings });
  }

  return new Response('Method not allowed', { status: 405 });
}
