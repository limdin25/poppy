import { describe, expect, it } from "vitest";
import {
  buildFunnelReport,
  shouldEmailNow,
  shouldPauseNurture,
  ROUTINE_EMAIL_GAP_MS,
  type MonitorData,
} from "./funnel-monitor";

const base = (): MonitorData => ({
  now: new Date("2026-08-07T14:00:00Z"),
  windowStart: new Date("2026-08-07T13:55:00Z"),
  settings: {
    nurture_enabled: true,
    whatsapp_enabled: true,
    onboarding_nudges_enabled: true,
    skool_invites_enabled: true,
    auto_reply_enabled: true,
  },
  newLeads: [],
  nurtureSent: [],
  nurtureFailed: [],
  stuckQueued: 0,
  invitesSent: 0,
  invitesFailed: 0,
  waiting: [],
  neverLooked: [],
  templates: [],
  sheetSync: null,
  heartbeats: { replyStaleMinutes: 2, tickStaleMinutes: 4 },
  refusedBlocked: 0,
  nobodyChasing: [],
  undelivered48h: 0,
  templateDeferredLeads: 0,
  autoReply: { replied: 0, checkIns: 0, refusals: 0, failed: 0, handovers: [] },
  pausedReason: null,
  gatherErrors: [],
});

describe("shouldPauseNurture", () => {
  it("pauses at 3 failed sends in one window, not before", () => {
    expect(shouldPauseNurture(0)).toBe(false);
    expect(shouldPauseNurture(2)).toBe(false);
    expect(shouldPauseNurture(3)).toBe(true);
    expect(shouldPauseNurture(10)).toBe(true);
  });
});

describe("buildFunnelReport", () => {
  it("says quiet when nothing happened", () => {
    const r = buildFunnelReport(base());
    expect(r.subject).toContain("quiet");
    expect(r.html).toContain("Nothing new");
  });

  it("counts leads, sends and waiting threads in the subject", () => {
    const d = base();
    d.newLeads = [
      { first_name: "Aman", source: "fb_lead_form", lane: "partner", status: "captured" },
      { first_name: "Ravi", source: "web_signup", lane: "organic", status: "started" },
    ];
    d.nurtureSent = [{ template_key: "heypubli_welcome", channel: "whatsapp", lead_name: "Aman" }];
    d.waiting = [
      { name: "Prem", phone: "+918207324841", last_inbound_at: "2026-08-07T12:27:00Z", drafts_pending: 0, waiting_minutes: 93 },
    ];
    const r = buildFunnelReport(d);
    expect(r.subject).toContain("2 new");
    expect(r.subject).toContain("1 sent");
    expect(r.subject).toContain("1 waiting");
    expect(r.html).toContain("Prem");
    expect(r.html).toContain("93 min");
  });

  it("shouts PAUSED in the subject when the machine stopped itself", () => {
    const d = base();
    d.pausedReason = "3 failed sends in 5 minutes";
    const r = buildFunnelReport(d);
    expect(r.subject.startsWith("PAUSED")).toBe(true);
    expect(r.html).toContain("3 failed sends");
  });

  it("lists only templates that are not approved yet", () => {
    const d = base();
    d.templates = [
      { sid: "HX1", name: "heypubli_welcome_community", status: "approved", rejection_reason: "" },
      { sid: "HX2", name: "maria_welcome_watch_video_v2", status: "pending", rejection_reason: "" },
    ];
    const r = buildFunnelReport(d);
    expect(r.html).toContain("maria_welcome_watch_video_v2");
    expect(r.html).not.toContain("heypubli_welcome_community");
  });

  it("shows failures loudly with the error code", () => {
    const d = base();
    d.nurtureFailed = [
      { template_key: "heypubli_welcome", channel: "whatsapp", lead_name: "Ravi", error_code: "window_closed" },
    ];
    const r = buildFunnelReport(d);
    expect(r.html).toContain("window_closed");
    expect(r.subject).toContain("1 failed");
  });

  it("reports switched-off engines so a silent funnel is explained", () => {
    const d = base();
    d.settings.nurture_enabled = false;
    const r = buildFunnelReport(d);
    expect(r.html).toContain("nurture OFF");
  });

  it("shows reply-brain work and lists handovers with the reason", () => {
    const d = base();
    d.autoReply = {
      replied: 3,
      checkIns: 1,
      refusals: 1,
      failed: 0,
      handovers: [{ phone: "+919876543210", reason: "asked how much exactly, money goes to a human" }],
    };
    const r = buildFunnelReport(d);
    expect(r.subject).toContain("3 auto-replied");
    expect(r.subject).toContain("1 for you");
    expect(r.html).toContain("Needs a human");
    expect(r.html).toContain("money goes to a human");
  });

  it("says auto-reply OFF when the brain is switched off", () => {
    const d = base();
    d.settings.auto_reply_enabled = false;
    const r = buildFunnelReport(d);
    expect(r.html).toContain("auto-reply OFF");
  });

  it("warns when the lead sheet has not been read for over 10 minutes", () => {
    const d = base();
    d.sheetSync = { lastOkAt: "2026-08-07T13:30:00Z", error: null, staleMinutes: 30 };
    const r = buildFunnelReport(d);
    expect(r.html).toContain("NOT flowing in");
  });

  it("stays calm about the sheet when it was read recently", () => {
    const d = base();
    d.sheetSync = { lastOkAt: "2026-08-07T13:58:00Z", error: null, staleMinutes: 2 };
    const r = buildFunnelReport(d);
    expect(r.html).not.toContain("NOT flowing in");
  });

  it("flags sends stuck in queued and says not to resend by hand", () => {
    const d = base();
    d.stuckQueued = 2;
    const r = buildFunnelReport(d);
    expect(r.html).toContain("stuck in queued");
    expect(r.html).toContain("Do not resend");
  });

  // Problem B, 07 Aug 2026: refusals, silences and handovers send nothing, so
  // in the CRM they look identical to "nobody ever looked". These tests pin the
  // two counts apart: deliberate stops are routine, a never-looked thread is an
  // alarm in the subject line.
  it("shouts IGNORED in the subject when the brain never looked at somebody", () => {
    const d = base();
    d.waiting = d.neverLooked = [
      { name: "Angelica", phone: "+639924711588", last_inbound_at: "2026-08-07T13:42:00Z", drafts_pending: 0, waiting_minutes: 12 },
    ];
    const r = buildFunnelReport(d);
    expect(r.subject).toContain("IGNORED");
    expect(r.html).toContain("NEVER looked");
    expect(r.html).toContain("Angelica");
  });

  it("a deliberate handover is NOT counted as never-looked", () => {
    const d = base();
    d.waiting = [
      { name: "Prem", phone: "+918207324841", last_inbound_at: "2026-08-07T13:00:00Z", drafts_pending: 0, waiting_minutes: 60 },
    ];
    d.autoReply.handovers = [{ phone: "+918207324841", reason: "sent a picture, needs human eyes" }];
    const r = buildFunnelReport(d);
    expect(r.subject).not.toContain("IGNORED");
    expect(r.html).toContain("Needs a human");
  });

  it("warns DEAD BEAT when a cron heartbeat goes stale", () => {
    const d = base();
    d.heartbeats = { replyStaleMinutes: 45, tickStaleMinutes: 3 };
    const r = buildFunnelReport(d);
    expect(r.subject).toContain("DEAD BEAT");
    expect(r.html).toContain("45 minutes");
  });

  it("does not alarm on a heartbeat that has simply never been stamped", () => {
    const d = base();
    d.heartbeats = { replyStaleMinutes: null, tickStaleMinutes: null };
    const r = buildFunnelReport(d);
    expect(r.subject).not.toContain("DEAD BEAT");
  });

  it("lists people nobody is chasing, with why", () => {
    const d = base();
    d.nobodyChasing = [{ name: "Epie", why: "no drip was ever armed for them" }];
    const r = buildFunnelReport(d);
    expect(r.html).toContain("Nobody is chasing");
    expect(r.html).toContain("Epie");
    expect(r.html).toContain("never armed");
  });

  it("says how many leads are stuck behind an unapproved template", () => {
    const d = base();
    d.templates = [{ sid: "HX2", name: "onb2_nudge", status: "pending", rejection_reason: "" }];
    d.templateDeferredLeads = 4;
    const r = buildFunnelReport(d);
    expect(r.html).toContain("4 lead(s) are stuck behind these approvals");
  });

  it("counts undelivered messages loudly", () => {
    const d = base();
    d.undelivered48h = 2;
    const r = buildFunnelReport(d);
    expect(r.html).toContain("never delivered");
  });

  it("mentions blocked-country rows refused at the door", () => {
    const d = base();
    d.refusedBlocked = 27;
    const r = buildFunnelReport(d);
    expect(r.html).toContain("refused at the door");
  });

  it("never contains a long dash, curly quote or ellipsis character", () => {
    const d = base();
    d.newLeads = [{ first_name: "Aman", source: "fb_lead_form", lane: "partner", status: "captured" }];
    d.gatherErrors = ["inbox_summary unreachable"];
    d.pausedReason = "3 failed sends in 5 minutes";
    const r = buildFunnelReport(d);
    const banned = /[–—‘’“”…]/;
    expect(banned.test(r.subject)).toBe(false);
    expect(banned.test(r.html)).toBe(false);
  });
});

// Hugo, 07 Aug 2026: "can you stop send me notifiation to my email every 5 min,
// make it every hour".
//
// The endpoint cannot simply move to an hourly cron: it is also the circuit
// breaker, and the breaker judges a FIXED 15 minute window, so running it once
// an hour would leave it blind to 45 minutes in every 60. So it keeps running
// every 5 minutes and only the EMAIL is throttled. Anything actually broken
// still goes out at once, because that is the whole point of an alarm.
describe("how often Hugo is emailed", () => {
  const ago = (ms: number) => new Date(new Date("2026-08-07T14:00:00Z").getTime() - ms);

  it("stays quiet when nothing is wrong and the last email was recent", () => {
    expect(shouldEmailNow(base(), ago(5 * 60 * 1000)).send).toBe(false);
  });

  it("sends the routine report once the hour is up", () => {
    const d = shouldEmailNow(base(), ago(ROUTINE_EMAIL_GAP_MS + 1000));
    expect(d.send).toBe(true);
    expect(d.reason).toBe("routine");
  });

  it("sends the very first report when it has never emailed", () => {
    expect(shouldEmailNow(base(), null).send).toBe(true);
  });

  // Each of these means something is broken, and a broken funnel that waits up
  // to an hour to tell anybody is worse than no monitor at all.
  it.each([
    ["the drip was paused", { pausedReason: "3 sends failed in 15 minutes" }],
    ["a send failed", { nurtureFailed: [{ template_key: "heypubli_welcome", channel: "whatsapp", lead_name: "Sam", error_code: "63016" }] }],
    ["an invite failed", { invitesFailed: 2 }],
    ["the queue is stuck", { stuckQueued: 4 }],
    ["a gather query failed", { gatherErrors: ["waiting list read failed"] }],
    ["the lead sheet went stale", { sheetSync: { lastOkAt: null, error: "403 from the sheet", staleMinutes: 90 } }],
    ["the brain never looked at a thread", { neverLooked: [{ name: "Angelica", phone: "+639924711588", last_inbound_at: "2026-08-07T13:42:00Z", drafts_pending: 0, waiting_minutes: 12 }] }],
    ["the reply heartbeat went stale", { heartbeats: { replyStaleMinutes: 30, tickStaleMinutes: 2 } }],
    ["the tick heartbeat went stale", { heartbeats: { replyStaleMinutes: 1, tickStaleMinutes: 60 } }],
  ])("emails immediately when %s, even one minute after the last one", (_label, over) => {
    const d = shouldEmailNow({ ...base(), ...(over as Partial<MonitorData>) }, ago(60 * 1000));
    expect(d.send).toBe(true);
    expect(d.reason).toBe("urgent");
  });

  // A lead waiting is the NORMAL state of a working funnel on a busy day. If it
  // forced an email the throttle would do nothing at all and we would be back to
  // one every five minutes, which is the thing being fixed.
  it("does not treat a waiting lead as urgent", () => {
    const d = shouldEmailNow(
      {
        ...base(),
        waiting: [{
          name: "Edelyn", phone: "+639154288063",
          last_inbound_at: "2026-08-07T13:18:00Z", drafts_pending: 0, waiting_minutes: 42,
        }],
      },
      ago(60 * 1000),
    );
    expect(d.send).toBe(false);
  });

  it("is one hour, not five minutes", () => {
    expect(ROUTINE_EMAIL_GAP_MS).toBe(60 * 60 * 1000);
  });
});
