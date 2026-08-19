// Builder events into the bell (Hugo, 2026-08-19: "notifications there for
// things like builder looking for an answer, builder confirmed").
//
// Its OWN thin file, the same shape and the same reasoning as deal-notify.ts:
// vsl-notify's kind map is the funnel's vocabulary and a builder replying has
// nothing to do with a lead watching a video. It writes the same
// wk_notifications table, so the bell, the desktop pop-up and the every-minute
// email drain pick it up with no change to any of them. The drain emails
// unknown kinds by default (undefined !== false), which is what we want.

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

export type BuilderNotifyKind = 'builder_reply' | 'builder_confirmed' | 'builder_scrape_empty';

/** Raise one builder notification for each admin. NEVER THROWS: failing to
 *  ring the bell must not undo the thing that was done. */
export async function notifyBuilderEvent(sb: Sb, args: {
  kind: BuilderNotifyKind;
  agentIds: string[];
  contactId?: string | null;
  title: string;
  body: string;
  /** Relative, because react-router cannot navigate an absolute URL. */
  link: string;
}): Promise<void> {
  try {
    if (!args.agentIds.length) return;
    await (sb.from('wk_notifications') as any).insert(args.agentIds.map((agentId) => ({
      agent_id: agentId,
      contact_id: args.contactId ?? null,
      kind: args.kind,
      title: args.title.slice(0, 160),
      body: args.body.slice(0, 900),
      link: args.link,
    })));
  } catch (e) {
    console.warn('[builder-notify] could not raise', String(e).slice(0, 200));
  }
}

/** Everybody who counts as an admin, as PROFILE ids: wk_notifications.agent_id
 *  references profiles, and admin_users.id is its own random uuid, NOT the
 *  auth id, so the allowlist has to be joined to profiles by email (the same
 *  resolution the cockpit escalation uses). Empty list rather than a throw. */
export async function builderNotifyRecipients(sb: Sb): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const [{ data: byRole }, { data: rows }] = await Promise.all([
      sb.from('profiles').select('id').eq('workspace_role', 'admin'),
      sb.from('admin_users').select('email').limit(50),
    ]);
    for (const r of (byRole ?? []) as Array<{ id?: string }>) if (r.id) ids.add(r.id);
    const emails = ((rows ?? []) as Array<{ email?: string }>)
      .map((r) => String(r.email ?? '').trim()).filter(Boolean);
    if (emails.length) {
      const { data: byEmail } = await sb.from('profiles').select('id').in('email', emails);
      for (const r of (byEmail ?? []) as Array<{ id?: string }>) if (r.id) ids.add(r.id);
    }
  } catch (e) {
    console.warn('[builder-notify] could not resolve admins', String(e).slice(0, 160));
  }
  return [...ids];
}
