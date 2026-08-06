import { describe, it, expect } from "vitest";
import { advanceStage, stageStampColumn, summariseLeads } from "./signup-leads";
import type { SignupLead } from "@/types/database";

function lead(over: Partial<SignupLead> = {}): SignupLead {
  return {
    id: "l1",
    first_name: "Maria",
    last_name: "Silva",
    email: "maria@gmail.com",
    whatsapp: "+5511999998888",
    email_normalized: "maria@gmail.com",
    status: "started",
    profile_id: null,
    attempts: 1,
    first_seen_at: "2026-08-03T10:00:00Z",
    last_seen_at: "2026-08-03T10:00:00Z",
    sent_to_instagram_at: null,
    connected_at: null,
    created_at: "2026-08-03T10:00:00Z",
    lane: "organic",
    source: "web_signup",
    lane_locked_at: "2026-08-03T10:00:00Z",
    lane_locked_by: null,
    fb_leadgen_id: null,
    fb_form_id: null,
    fb_ad_id: null,
    fb_campaign_id: null,
    whatsapp_e164: null,
    wk_contact_id: null,
    consent_source: null,
    consent_at: null,
    captured_at: null,
    contacted_at: null,
    engaged_at: null,
    invited_at: null,
    nurture_state: "idle",
    nurture_step: 0,
    nurture_next_at: null,
    nurture_last_sent_at: null,
    nurture_stop_reason: null,
    whatsapp_opted_out_at: null,
    whatsapp_undeliverable_code: null,
    approval_state: "none",
    approved_at: null,
    approved_by: null,
    ...over,
  };
}

describe("advanceStage", () => {
  it("moves a brand new lead to whatever stage it arrived at", () => {
    expect(advanceStage(null, "started")).toBe("started");
    expect(advanceStage(undefined, "sent_to_instagram")).toBe("sent_to_instagram");
  });

  it("moves forward through the funnel", () => {
    expect(advanceStage("started", "sent_to_instagram")).toBe("sent_to_instagram");
    expect(advanceStage("sent_to_instagram", "connected")).toBe("connected");
  });

  // The one that matters: a real influencer who opens /signup again would otherwise be
  // knocked back to "started" and show up in the admin list as an abandoned lead.
  it("never goes backwards", () => {
    expect(advanceStage("connected", "started")).toBe("connected");
    expect(advanceStage("connected", "sent_to_instagram")).toBe("connected");
    expect(advanceStage("sent_to_instagram", "started")).toBe("sent_to_instagram");
  });

  it("stays put when the same stage repeats", () => {
    expect(advanceStage("started", "started")).toBe("started");
  });
});

describe("stageStampColumn", () => {
  it("maps the two later stages to their timestamp columns", () => {
    expect(stageStampColumn("sent_to_instagram")).toBe("sent_to_instagram_at");
    expect(stageStampColumn("connected")).toBe("connected_at");
  });

  it("has no column for the first stage, the row itself is the record", () => {
    expect(stageStampColumn("started")).toBeNull();
  });
});

describe("summariseLeads", () => {
  it("counts an empty list without dividing by anything", () => {
    expect(summariseLeads([])).toEqual({
      total: 0,
      started: 0,
      sentToInstagram: 0,
      connected: 0,
      lost: 0,
    });
  });

  // Counted off the stamps, never off status. A connected lead also started and was also
  // sent to Instagram, so reading `status` alone would understate both earlier steps.
  it("counts a connected lead in every step it passed through", () => {
    const stats = summariseLeads([
      lead({
        id: "done",
        status: "connected",
        sent_to_instagram_at: "2026-08-03T10:05:00Z",
        connected_at: "2026-08-03T10:06:00Z",
      }),
    ]);
    expect(stats).toEqual({
      total: 1,
      started: 1,
      sentToInstagram: 1,
      connected: 1,
      lost: 0,
    });
  });

  it("calls anyone without a connected stamp a lost lead", () => {
    const stats = summariseLeads([
      lead({ id: "a" }),
      lead({ id: "b", status: "sent_to_instagram", sent_to_instagram_at: "x" }),
      lead({ id: "c", status: "connected", connected_at: "y" }),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.sentToInstagram).toBe(1);
    expect(stats.connected).toBe(1);
    expect(stats.lost).toBe(2);
  });
});
