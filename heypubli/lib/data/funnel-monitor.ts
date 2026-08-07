// The funnel's heartbeat email to Hugo. Pure report-building only, no I/O, so every
// sentence the email can produce is unit-tested, including the no-long-dash rule.
//
// Design rule: the email must explain a SILENT funnel as loudly as a busy one. "Nothing
// new" plus "nurture OFF" tells Hugo exactly why nobody was messaged. A report that only
// speaks when things happen reads as healthy while a switched-off machine rots the leads.

export interface MonitorSettings {
  nurture_enabled: boolean;
  whatsapp_enabled: boolean;
  onboarding_nudges_enabled: boolean;
  skool_invites_enabled: boolean;
  auto_reply_enabled: boolean;
}

export interface MonitorHandover {
  phone: string;
  reason: string;
}

export interface MonitorAutoReply {
  replied: number;
  checkIns: number;
  refusals: number;
  failed: number;
  handovers: MonitorHandover[];
}

/** A thread whose newest brain action is a reply that never left. */
export interface MonitorReplyFailed {
  phone: string;
  status: string;
  at: string;
}

export interface MonitorLead {
  first_name: string;
  source: string;
  lane: string;
  status: string;
}

export interface MonitorSend {
  template_key: string;
  channel: string;
  lead_name: string;
}

export interface MonitorFailure extends MonitorSend {
  error_code: string | null;
}

export interface MonitorWaiting {
  name: string;
  phone: string;
  last_inbound_at: string | null;
  drafts_pending: number;
  waiting_minutes: number | null;
}

export interface MonitorTemplate {
  sid: string;
  name: string;
  status: string;
  rejection_reason: string;
}

export interface SheetSyncHealth {
  lastOkAt: string | null;
  error: string | null;
  staleMinutes: number | null;
}

export interface MonitorHeartbeats {
  /** Minutes since /api/funnel/reply last completed a run. Null = never stamped
   *  (fresh migration), which is not an alarm. */
  replyStaleMinutes: number | null;
  tickStaleMinutes: number | null;
}

export interface MonitorNobodyChasing {
  name: string;
  why: string;
}

export interface MonitorData {
  now: Date;
  windowStart: Date;
  settings: MonitorSettings;
  newLeads: MonitorLead[];
  nurtureSent: MonitorSend[];
  nurtureFailed: MonitorFailure[];
  /** Sends started more than 15 min ago and never resolved: a crashed or hung run. */
  stuckQueued: number;
  invitesSent: number;
  invitesFailed: number;
  waiting: MonitorWaiting[];
  /** The subset of `waiting` whose newest inbound has NO funnel_replies row at
   *  all and who is not opted out: the brain NEVER LOOKED. Zero is the only
   *  acceptable steady state; anything here is an alarm, counted separately
   *  from "handed to you on purpose". */
  neverLooked: MonitorWaiting[];
  templates: MonitorTemplate[];
  sheetSync: SheetSyncHealth | null;
  heartbeats: MonitorHeartbeats;
  /** Blocked-country ad rows refused at the door on the last sheet read. */
  refusedBlocked: number;
  /** People no engine will ever contact again, with why. A ladder that ends in
   *  silence is only acceptable when this list says so out loud. */
  nobodyChasing: MonitorNobodyChasing[];
  /** WhatsApp messages Twilio accepted then failed to deliver, last 48h. */
  undelivered48h: number;
  /** Threads whose LATEST brain action is a reply whose SEND failed (last 48h).
   *  The person received nothing and one-action-per-message means no retry, so
   *  without this list the thread stays broken silently while its inbox badge
   *  said "answered". Found 07 Aug 2026 on a WhatsApp privacy-ID thread
   *  (+2579..., 16 digits, unaddressable by Twilio). autoReply.failed alarms
   *  at the moment of failure; this is the standing list until a human acts. */
  replyFailedStanding: MonitorReplyFailed[];
  /** Active drip leads whose CURRENT step points at an unapproved template, so
   *  their next message defers 24h, every day, until Meta moves. A silent
   *  daily deferral is indistinguishable from a working ladder; this is the
   *  number that makes it loud. */
  templateDeferredLeads: number;
  autoReply: MonitorAutoReply;
  pausedReason: string | null;
  gatherErrors: string[];
}

export interface MonitorReport {
  subject: string;
  html: string;
}

/**
 * 3 failed sends inside one 5 minute window is a broken machine, not bad luck, and a
 * broken machine must stop itself rather than burn the rest of the batch. One or two can
 * be a dead number or a closed window, which is normal life.
 */
export function shouldPauseNurture(failedInWindow: number): boolean {
  return failedInWindow >= 3;
}

/** Hugo, 07 Aug 2026: "stop send me notification to my email every 5 min, make it
 *  every hour." The cron keeps its 5 minute beat (the circuit breaker needs it); only
 *  the EMAIL is throttled. */
export const ROUTINE_EMAIL_GAP_MS = 60 * 60 * 1000;

export interface EmailDecision {
  send: boolean;
  reason?: "routine" | "urgent";
}

/** The reply cron runs every minute; ten missed beats is a dead cron, not jitter. */
export const REPLY_HEARTBEAT_STALE_MIN = 10;
/** The tick runs every five minutes; twenty is four missed beats. */
export const TICK_HEARTBEAT_STALE_MIN = 20;

export function heartbeatAlarms(h: MonitorHeartbeats): string[] {
  const out: string[] = [];
  if (h.replyStaleMinutes !== null && h.replyStaleMinutes > REPLY_HEARTBEAT_STALE_MIN) {
    out.push(`the reply brain has not completed a run for ${h.replyStaleMinutes} minutes`);
  }
  if (h.tickStaleMinutes !== null && h.tickStaleMinutes > TICK_HEARTBEAT_STALE_MIN) {
    out.push(`the drip tick has not completed a run for ${h.tickStaleMinutes} minutes`);
  }
  return out;
}

/**
 * Whether THIS run's report goes to Hugo's inbox. Anything broken goes out at once,
 * that is the whole point of an alarm; everything else waits for the hourly slot. A
 * waiting lead is deliberately NOT urgent: on a busy day that is the funnel's normal
 * state, and treating it as an alarm would put us back to an email every 5 minutes.
 */
export function shouldEmailNow(d: MonitorData, lastEmailAt: Date | null): EmailDecision {
  const urgent =
    Boolean(d.pausedReason) ||
    d.nurtureFailed.length > 0 ||
    d.invitesFailed > 0 ||
    d.stuckQueued > 0 ||
    d.autoReply.failed > 0 ||
    d.gatherErrors.length > 0 ||
    // A thread the brain never looked at is a person being ignored right now.
    // Unlike a deliberate handover, it shouts on every run until it is zero.
    d.neverLooked.length > 0 ||
    heartbeatAlarms(d.heartbeats).length > 0 ||
    Boolean(d.sheetSync && (d.sheetSync.error || (d.sheetSync.staleMinutes ?? 0) > 10));
  if (urgent) return { send: true, reason: "urgent" };
  if (!lastEmailAt || d.now.getTime() - lastEmailAt.getTime() > ROUTINE_EMAIL_GAP_MS) {
    return { send: true, reason: "routine" };
  }
  return { send: false };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildFunnelReport(d: MonitorData): MonitorReport {
  const parts: string[] = [];
  const autoActivity =
    d.autoReply.replied + d.autoReply.checkIns + d.autoReply.refusals + d.autoReply.failed;
  const busy =
    d.newLeads.length +
      d.nurtureSent.length +
      d.nurtureFailed.length +
      d.invitesSent +
      autoActivity >
    0;

  let subject: string;
  if (d.pausedReason) {
    subject = `PAUSED: HeyPubli funnel stopped itself (${d.pausedReason})`;
  } else if (d.neverLooked.length > 0) {
    subject = `IGNORED: ${d.neverLooked.length} thread(s) the brain never looked at`;
  } else if (heartbeatAlarms(d.heartbeats).length > 0) {
    subject = `DEAD BEAT: a funnel cron has stopped running`;
  } else if (!busy) {
    subject = `HeyPubli funnel quiet, ${d.waiting.length} waiting`;
  } else {
    const bits = [`${d.newLeads.length} new`, `${d.nurtureSent.length} sent`];
    if (d.autoReply.replied) bits.push(`${d.autoReply.replied} auto-replied`);
    if (d.autoReply.handovers.length) bits.push(`${d.autoReply.handovers.length} for you`);
    if (d.nurtureFailed.length + d.autoReply.failed)
      bits.push(`${d.nurtureFailed.length + d.autoReply.failed} failed`);
    bits.push(`${d.waiting.length} waiting`);
    subject = `HeyPubli funnel: ${bits.join(", ")}`;
  }

  parts.push(
    `<p style="color:#6b7280;font-size:13px">Window: ${d.windowStart.toISOString().slice(0, 16).replace("T", " ")} to ${d.now.toISOString().slice(0, 16).replace("T", " ")} UTC</p>`,
  );

  if (d.pausedReason) {
    parts.push(
      `<p style="background:#fee2e2;padding:10px;border-radius:6px"><strong>The drip paused itself: ${esc(d.pausedReason)}.</strong> Nothing more sends until it is turned back on. Reply to this email or tell Claude to resume.</p>`,
    );
  }

  // The two counts Hugo must never have to guess apart: ignored vs deliberate.
  if (d.neverLooked.length) {
    parts.push(
      `<h3 style="margin:14px 0 4px;color:#b91c1c">The brain NEVER looked at these (${d.neverLooked.length})</h3>`,
      `<p style="color:#b91c1c">These people wrote to us and no decision of any kind was made. Not a handover, not a deliberate silence: nothing. This should always be zero.</p>`,
      "<ul>" +
        d.neverLooked
          .map((w) => `<li>${esc(w.name)} (${esc(w.phone)}), waiting ${w.waiting_minutes ?? "?"} min</li>`)
          .join("") +
        "</ul>",
    );
  }

  for (const alarm of heartbeatAlarms(d.heartbeats)) {
    parts.push(
      `<p style="background:#fee2e2;padding:10px;border-radius:6px"><strong>Heartbeat missed: ${esc(alarm)}.</strong> If Vercel crons are down, this email may be the last one; the Elsie app's independent watchdog also checks these stamps.</p>`,
    );
  }

  const off: string[] = [];
  if (!d.settings.nurture_enabled) off.push("nurture OFF");
  if (!d.settings.whatsapp_enabled) off.push("whatsapp OFF");
  if (!d.settings.onboarding_nudges_enabled) off.push("onboarding nudges OFF");
  if (!d.settings.skool_invites_enabled) off.push("skool invites OFF");
  if (!d.settings.auto_reply_enabled) off.push("auto-reply OFF");
  if (off.length) {
    parts.push(
      `<p style="background:#fef3c7;padding:8px;border-radius:6px"><strong>Switched off:</strong> ${off.join(", ")}</p>`,
    );
  }

  if (!busy) {
    parts.push("<p>Nothing new this window: no new leads, nothing sent, nothing failed.</p>");
  }

  if (d.newLeads.length) {
    parts.push(`<h3 style="margin:14px 0 4px">New leads (${d.newLeads.length})</h3>`);
    parts.push(
      "<ul>" +
        d.newLeads
          .map(
            (l) =>
              `<li>${esc(l.first_name)} (${esc(l.source)}, ${esc(l.lane)}, now ${esc(l.status)})</li>`,
          )
          .join("") +
        "</ul>",
    );
  }

  if (d.nurtureSent.length) {
    parts.push(`<h3 style="margin:14px 0 4px">Messages sent (${d.nurtureSent.length})</h3>`);
    parts.push(
      "<ul>" +
        d.nurtureSent
          .map((s) => `<li>${esc(s.lead_name)}: ${esc(s.template_key)} via ${esc(s.channel)}</li>`)
          .join("") +
        "</ul>",
    );
  }

  if (autoActivity > 0) {
    const bits: string[] = [];
    if (d.autoReply.replied) bits.push(`${d.autoReply.replied} replied`);
    if (d.autoReply.checkIns) bits.push(`${d.autoReply.checkIns} check-ins`);
    if (d.autoReply.refusals) bits.push(`${d.autoReply.refusals} refusals handled`);
    if (d.autoReply.failed) bits.push(`<strong>${d.autoReply.failed} failed</strong>`);
    parts.push(`<p>Reply brain: ${bits.join(", ")}</p>`);
  }

  if (d.autoReply.handovers.length) {
    parts.push(
      `<h3 style="margin:14px 0 4px;color:#b45309">Needs a human (${d.autoReply.handovers.length})</h3>`,
    );
    parts.push(
      "<ul>" +
        d.autoReply.handovers
          .map((h) => `<li>${esc(h.phone)}: ${esc(h.reason)}</li>`)
          .join("") +
        "</ul>",
    );
  }

  if (d.invitesSent || d.invitesFailed) {
    parts.push(
      `<p>Skool invites: ${d.invitesSent} sent${d.invitesFailed ? `, <strong>${d.invitesFailed} failed</strong>` : ""}</p>`,
    );
  }

  if (d.stuckQueued > 0) {
    parts.push(
      `<p style="color:#b91c1c"><strong>${d.stuckQueued} send(s) stuck in queued for over 15 minutes.</strong> A run crashed or hung mid-send; those leads may or may not have been messaged. Do not resend by hand.</p>`,
    );
  }

  if (d.sheetSync) {
    if (d.sheetSync.error) {
      parts.push(
        `<p style="color:#b91c1c"><strong>Lead sheet problem:</strong> ${esc(d.sheetSync.error)}</p>`,
      );
    }
    if (d.sheetSync.staleMinutes !== null && d.sheetSync.staleMinutes > 10) {
      parts.push(
        `<p style="color:#b91c1c"><strong>The lead sheet has not been read successfully for ${d.sheetSync.staleMinutes} minutes.</strong> New Facebook leads are NOT flowing in.</p>`,
      );
    }
  }

  if (d.nurtureFailed.length) {
    parts.push(
      `<h3 style="margin:14px 0 4px;color:#b91c1c">Failed sends (${d.nurtureFailed.length})</h3>`,
    );
    parts.push(
      "<ul>" +
        d.nurtureFailed
          .map(
            (f) =>
              `<li>${esc(f.lead_name)}: ${esc(f.template_key)} via ${esc(f.channel)}, error ${esc(f.error_code ?? "unknown")}</li>`,
          )
          .join("") +
        "</ul>",
    );
  }

  if (d.waiting.length) {
    parts.push(
      `<h3 style="margin:14px 0 4px">Waiting on a reply from us (${d.waiting.length})</h3>`,
    );
    parts.push(
      "<ul>" +
        d.waiting
          .map(
            (w) =>
              `<li>${esc(w.name)} (${esc(w.phone)}), waiting ${w.waiting_minutes ?? "?"} min${w.drafts_pending ? `, ${w.drafts_pending} draft ready to approve` : ""}</li>`,
          )
          .join("") +
        "</ul>",
    );
  }

  if (d.refusedBlocked > 0) {
    parts.push(
      `<p style="background:#fef3c7;padding:8px;border-radius:6px">${d.refusedBlocked} ad row(s) from a blocked country were refused at the door. If ads are really off there, this number should fall to zero as the sheet stops growing.</p>`,
    );
  }

  if (d.undelivered48h > 0) {
    parts.push(
      `<p style="color:#b91c1c"><strong>${d.undelivered48h} WhatsApp message(s) in the last 48h were accepted by Twilio and then never delivered.</strong> Those people were NOT reached, whatever the send log says.</p>`,
    );
  }

  if (d.replyFailedStanding.length) {
    parts.push(
      `<h3 style="margin:14px 0 4px;color:#b91c1c">Replies that FAILED to send (${d.replyFailedStanding.length})</h3>`,
      `<p style="color:#b91c1c">The brain answered these people and the send itself failed, so they received nothing. One action per message means the machine will not retry; each needs a human, or accepting the number cannot be reached (a 16-digit "phone" is a WhatsApp privacy ID and no message can ever be sent to it).</p>`,
      "<ul>" +
        d.replyFailedStanding
          .map((f) => `<li>${esc(f.phone)}: ${esc(f.status)}, ${esc(f.at.slice(0, 16).replace("T", " "))} UTC</li>`)
          .join("") +
        "</ul>",
    );
  }

  if (d.nobodyChasing.length) {
    parts.push(
      `<h3 style="margin:14px 0 4px">Nobody is chasing these (${d.nobodyChasing.length})</h3>`,
      `<p style="color:#6b7280">Every ladder that applied to them has finished or never armed. They will not hear from us again unless you or Claude restart them.</p>`,
      "<ul>" +
        d.nobodyChasing.map((n) => `<li>${esc(n.name)}: ${esc(n.why)}</li>`).join("") +
        "</ul>",
    );
  }

  const unapproved = d.templates.filter((t) => t.status !== "approved");
  if (unapproved.length) {
    parts.push(`<h3 style="margin:14px 0 4px">Templates still with Meta</h3>`);
    parts.push(
      "<ul>" +
        unapproved
          .map(
            (t) =>
              `<li>${esc(t.name || t.sid)}: ${esc(t.status)}${t.rejection_reason ? `, reason: ${esc(t.rejection_reason)}` : ""}</li>`,
          )
          .join("") +
        "</ul>",
    );
    if (d.templateDeferredLeads > 0) {
      parts.push(
        `<p style="color:#b45309"><strong>${d.templateDeferredLeads} lead(s) are stuck behind these approvals right now:</strong> their next drip message defers 24 hours, every day, until Meta approves. They are not being chased in the meantime.</p>`,
      );
    }
  }

  if (d.gatherErrors.length) {
    parts.push(
      `<p style="color:#b91c1c">Monitor could not read: ${d.gatherErrors.map(esc).join("; ")}</p>`,
    );
  }

  return { subject, html: parts.join("\n") };
}
