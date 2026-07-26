// Funnel notifications: one row per notify-worthy event, fanned out to the bell,
// the desktop pop-up and (via the cron drain) email.
//
// Hugo 2026-07-26: every funnel action notifies, with a date+time stamp and a
// link straight to the lead. He sees every agent's; each agent sees their own.
//
// WRITE-ONLY HERE, ON PURPOSE. notifyFunnelEvent does DB work and nothing else.
// Email is drained separately by api/cron/vsl-automation.ts because:
//   - api/vsl/page.ts is a lead-facing page already carrying ~5s of fetch
//     budget, with no maxDuration override
//   - there is no waitUntil in this stack (no @vercel/functions), so a
//     fire-and-forget send after res.end() may never run
//   - sendNotification THROWS on a Resend 429, and Resend rate-limits ~2/s
// A blank sales page for a prospect is a far worse outcome than a late email.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const APP_URL = process.env.APP_URL || 'https://app.heyelsie.com';

/** Every funnel event that raises a notification, and how it reads to a human.
 *  Keep in lockstep with VslNotifySettings in vsl-settings.ts — the settings
 *  key is the kind with the `vsl_` prefix stripped. */
export const VSL_NOTIFY_KINDS: Record<string, { label: string; hot?: boolean }> = {
  vsl_sent: { label: 'Video sent' },
  vsl_link_click: { label: 'Tapped the link' },
  vsl_open: { label: 'Opened the page' },
  vsl_play: { label: 'Started the video' },
  vsl_watched_50: { label: 'Watched half the video' },
  vsl_watched_90: { label: 'Watched 90% of the video' },
  vsl_watched_100: { label: 'Watched the whole video' },
  vsl_cta_click: { label: 'Clicked "Start £1 Trial"', hot: true },
  vsl_checkout_start: { label: 'Started checkout', hot: true },
  vsl_paid: { label: 'PAID 🎉', hot: true },
};

export interface NotifyPage {
  id: string;
  contact_id: string;
  agent_id?: string;
  business_name?: string;
  owner_first?: string | null;
  town?: string | null;
  slug?: string;
}

/** Record a funnel event for the bell, the pop-up and the email queue.
 *  Never throws — a notification failure must not break a lead-facing page. */
export async function notifyFunnelEvent(args: {
  page: NotifyPage & Record<string, unknown>;
  kind: string;
  /** Overrides the stock label, e.g. the £1-sale email's richer wording. */
  title?: string;
  body?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { page, kind } = args;
    const spec = VSL_NOTIFY_KINDS[kind];
    const who = [page.owner_first, page.business_name].filter(Boolean).join(' · ') ||
      page.business_name || 'A lead';
    const title = args.title || `${who} — ${spec?.label || kind}`;

    const { error } = await supabase.from('wk_notifications').insert({
      agent_id: page.agent_id,
      contact_id: page.contact_id,
      page_id: page.id,
      kind,
      title,
      body: args.body || [page.town, page.slug ? `heyelsie.com/${page.slug}` : null]
        .filter(Boolean).join(' · '),
      // Relative on purpose: react-router cannot navigate to an absolute URL.
      link: `/admin/crm/contacts/${page.contact_id}`,
      meta: args.meta || {},
    });
    if (error) console.error('[vsl-notify] insert failed:', kind, error);
  } catch (e) {
    console.error('[vsl-notify] threw:', e);
  }
}

/** Absolute deep link for the email — the in-app `link` column stays relative. */
export function leadUrl(contactId: string): string {
  return `${APP_URL}/admin/crm/contacts/${contactId}`;
}

/** Europe/London date+time. The stamp Hugo asked for on every event; the
 *  explicit zone is a no-op for UK browsers and the only way it is correct on a
 *  server (which runs UTC) or a mis-set laptop. */
export function stampLondon(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const escHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

interface QueuedRow {
  id: string;
  agent_id: string;
  contact_id: string | null;
  kind: string;
  title: string;
  body: string;
  created_at: string;
}

/** Batch size per run. The cron fires every minute, so a deeper queue simply
 *  drains over the next few minutes rather than being dropped. */
const DRAIN_BATCH = 40;
/** Above this, something is wrong (a replay attack, a runaway loop) — collapse
 *  the run into ONE digest instead of emailing thousands of times. */
const DIGEST_THRESHOLD = 200;

function emailBody(rows: QueuedRow[]): string {
  const lines = rows.map((r) => {
    const link = r.contact_id ? leadUrl(r.contact_id) : '';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">
        <b>${escHtml(r.title)}</b><br>
        <span style="color:#666;font-size:13px;">${escHtml(r.body)}</span><br>
        <span style="color:#999;font-size:12px;">${escHtml(stampLondon(r.created_at))}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;">
        ${link ? `<a href="${escHtml(link)}" style="color:#3C5A87;font-weight:600;">Open the lead →</a>` : ''}
      </td>
    </tr>`;
  });
  return `<div style="font-family:system-ui,sans-serif;">
    <table style="border-collapse:collapse;width:100%;max-width:640px;">${lines.join('')}</table>
  </div>`;
}

/** Drain the email queue. Called from the every-minute cron.
 *
 *  Sending happens HERE, never inline from a request handler: sendNotification
 *  throws on a Resend 429 and there is no waitUntil in this stack, so an inline
 *  send could blank a lead-facing page or silently never run. */
export async function drainNotificationEmails(): Promise<{ sent: number; skipped: number; digest: boolean }> {
  const { getVslSettings } = await import('./vsl-settings.js');
  const { sendEmail } = await import('../../src/integrations/resend/client.js');

  const settings = await getVslSettings();
  const adminTo = process.env.DAILY_REPORT_EMAIL || 'hugodesouzax@gmail.com';

  const { count } = await supabase
    .from('wk_notifications')
    .select('id', { count: 'exact', head: true })
    .is('emailed_at', null);

  const digest = (count || 0) > DIGEST_THRESHOLD;

  const { data, error } = await supabase
    .from('wk_notifications')
    .select('id, agent_id, contact_id, kind, title, body, created_at')
    .is('emailed_at', null)
    .order('created_at', { ascending: true })
    .limit(digest ? DIGEST_THRESHOLD * 5 : DRAIN_BATCH);
  if (error) {
    console.error('[vsl-notify] drain read failed:', error);
    return { sent: 0, skipped: 0, digest: false };
  }
  const rows = (data || []) as QueuedRow[];
  if (!rows.length) return { sent: 0, skipped: 0, digest: false };

  // Which of these are allowed to email at all (Hugo's per-event toggles).
  const allowed = rows.filter((r) => {
    const key = r.kind.replace(/^vsl_/, '') as keyof typeof settings.notify;
    return settings.notify[key] !== false;
  });
  const skipped = rows.length - allowed.length;

  const markDone = async (ids: string[]) => {
    if (!ids.length) return;
    await supabase
      .from('wk_notifications')
      .update({ emailed_at: new Date().toISOString() })
      .in('id', ids);
  };

  if (!allowed.length) {
    await markDone(rows.map((r) => r.id));
    return { sent: 0, skipped, digest: false };
  }

  // Circuit breaker: one summary rather than a flood.
  if (digest) {
    console.warn(`[vsl-notify] queue depth ${count} — sending a digest instead of ${allowed.length} emails`);
    await sendEmail(
      adminTo,
      `HeyElsie funnel — ${allowed.length} events (digest)`,
      emailBody(allowed.slice(0, 200)),
    ).catch((e) => console.error('[vsl-notify] digest send failed:', e));
    await markDone(rows.map((r) => r.id));
    return { sent: 1, skipped, digest: true };
  }

  // Agent addresses, one lookup for the whole batch.
  const agentIds = Array.from(new Set(allowed.map((r) => r.agent_id).filter(Boolean)));
  const { data: profs } = await supabase.from('profiles').select('id, email').in('id', agentIds);
  const emailById = new Map((profs || []).map((p: { id: string; email: string | null }) => [p.id, p.email]));

  let sent = 0;
  const done: string[] = [];
  for (const r of allowed) {
    // Hugo sees every agent's leads; the agent sees only their own.
    const agentEmail = emailById.get(r.agent_id);
    const to = Array.from(new Set([adminTo, agentEmail].filter(Boolean) as string[]));
    const subject = `${r.title}`;
    const html = emailBody([r]);
    for (const addr of to) {
      try {
        await sendEmail(addr, subject, html);
        sent++;
      } catch (e) {
        // Never let one bad address stall the queue.
        console.error('[vsl-notify] send failed:', addr, e);
      }
      // Resend rate-limits around 2/s; stay under it.
      await new Promise((r2) => setTimeout(r2, 600));
    }
    done.push(r.id);
  }
  await markDone(done);
  return { sent, skipped, digest: false };
}
