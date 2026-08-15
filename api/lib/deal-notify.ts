// Sending something to Hugo from the cockpit.
//
// Deliberately its OWN thin file rather than a new branch inside
// api/lib/vsl-notify.ts. That module is the funnel's, its VSL_NOTIFY_KINDS map
// is the funnel's vocabulary, and a property escalation has nothing to do with
// a lead watching a video. Adding a case to it would mean editing a live file
// to gain nothing.
//
// It writes to the same wk_notifications table, so the bell, the desktop pop-up
// and the every-minute email drain in api/cron/notify-drain.ts all pick it up
// with no change to any of them.
//
// The drain filters on settings.notify[kind minus the vsl_ prefix]; an unknown
// key reads as undefined, which is not false, so a deal_* notification emails
// by default. That is the behaviour we want here and it needs no edit there.

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

/** Raise one notification. NEVER THROWS: failing to tell somebody about a deal
 *  must not undo the thing that was done about it. */
export async function notifyDeal(sb: Sb, args: {
  agentId: string;
  contactId?: string | null;
  title: string;
  body: string;
  /** Relative, because react-router cannot navigate an absolute URL. */
  link: string;
}): Promise<void> {
  try {
    await (sb.from('wk_notifications') as any).insert({
      agent_id: args.agentId,
      contact_id: args.contactId ?? null,
      kind: 'deal_needs_hugo',
      title: args.title.slice(0, 160),
      body: args.body.slice(0, 900),
      link: args.link,
    });
  } catch (e) {
    console.warn('[deal-notify] could not raise', String(e).slice(0, 200));
  }
}
