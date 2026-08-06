import { describe, it, expect } from "vitest";
import { buildPostsForMember, buildPostsForItem, jitterMinutes } from "./campaigns";
import type { Campaign, CampaignItem } from "@/types/database";

const NOW = new Date("2026-06-10T12:00:00Z");

const campaign: Campaign = {
  id: "camp-1",
  name: "Campanha Principal",
  description: null,
  brand_id: "brand-default",
  is_default: true,
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

function item(overrides: Partial<CampaignItem>): CampaignItem {
  return {
    id: "item-x",
    campaign_id: "camp-1",
    brand_id: null,
    media_type: "story_image",
    media_url: "https://cdn.example.com/story.jpg",
    caption: "Olha isso!",
    scheduled_at: "2026-06-12T17:00:00Z",
    instagram_options: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

const pastStory = item({ id: "item-past", scheduled_at: "2026-06-08T17:00:00Z" });
const futureStory = item({ id: "item-thu", scheduled_at: "2026-06-12T17:00:00Z" });
const futureReel = item({
  id: "item-reel",
  media_type: "reel",
  media_url: "https://cdn.example.com/reel.mp4",
  scheduled_at: "2026-06-15T18:00:00Z",
});


// Posts carry a deterministic 0-90 minute per-creator jitter (see jitterMinutes), so a
// scheduled time is asserted as a window from its base, not an exact second.
function withinJitter(actual: string | null | undefined, baseIso: string) {
  const base = new Date(baseIso).getTime();
  const t = new Date(actual ?? "").getTime();
  expect(t).toBeGreaterThanOrEqual(base);
  expect(t).toBeLessThanOrEqual(base + 90 * 60 * 1000);
}

describe("buildPostsForMember", () => {
  it("schedule mode: materializes only future items at their own times", () => {
    const rows = buildPostsForMember({
      campaign,
      items: [pastStory, futureStory, futureReel],
      profileId: "user-1",
      startNow: false,
      provider: "outstand",
      now: NOW,
    });
    expect(rows.map((r) => r.campaign_item_id)).toEqual(["item-thu", "item-reel"]);
    withinJitter(rows[0].scheduled_at, "2026-06-12T17:00:00.000Z");
    withinJitter(rows[1].scheduled_at, "2026-06-15T18:00:00.000Z");
  });

  it("start-now: the campaign's first item is scheduled immediately, not duplicated", () => {
    const rows = buildPostsForMember({
      campaign,
      items: [futureStory, futureReel],
      profileId: "user-1",
      startNow: true,
      provider: "outstand",
      now: NOW,
    });
    // first item (Thursday story) fires now; reel keeps its own time
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.campaign_item_id === "item-thu");
    withinJitter(first?.scheduled_at, NOW.toISOString());
    const reel = rows.find((r) => r.campaign_item_id === "item-reel");
    withinJitter(reel?.scheduled_at, "2026-06-15T18:00:00.000Z");
  });

  it("start-now: a first item already in the past still fires now", () => {
    const rows = buildPostsForMember({
      campaign,
      items: [pastStory, futureReel],
      profileId: "user-1",
      startNow: true,
      provider: "outstand",
      now: NOW,
    });
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.campaign_item_id === "item-past");
    withinJitter(first?.scheduled_at, NOW.toISOString());
  });

  it("falls back to the campaign brand and skips items with no brand at all", () => {
    const noBrandCampaign = { ...campaign, brand_id: null };
    const withOwnBrand = item({ id: "item-own", brand_id: "brand-own" });
    const rows = buildPostsForMember({
      campaign: noBrandCampaign,
      items: [withOwnBrand, futureStory],
      profileId: "user-1",
      startNow: false,
      provider: "outstand",
      now: NOW,
    });
    // futureStory has no item brand and no campaign brand → skipped
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_item_id).toBe("item-own");
    expect(rows[0].brand_id).toBe("brand-own");
  });

  it("stamps rows as pending campaign posts for the right profile/provider", () => {
    const rows = buildPostsForMember({
      campaign,
      items: [futureStory],
      profileId: "user-9",
      startNow: false,
      provider: "heypubli",
      now: NOW,
    });
    expect(rows[0]).toMatchObject({
      profile_id: "user-9",
      brand_id: "brand-default",
      media_type: "story_image",
      status: "pending",
      provider: "heypubli",
      campaign_id: "camp-1",
      campaign_item_id: "item-thu",
    });
  });
});

describe("buildPostsForItem", () => {
  it("creates one pending post per member for a future item", () => {
    const rows = buildPostsForItem({
      campaign,
      item: futureReel,
      profileIds: ["user-1", "user-2"],
      provider: "outstand",
      now: NOW,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.profile_id).sort()).toEqual(["user-1", "user-2"]);
    withinJitter(rows[0].scheduled_at, "2026-06-15T18:00:00.000Z");
  });

  it("returns nothing for an item whose time already passed", () => {
    const rows = buildPostsForItem({
      campaign,
      item: pastStory,
      profileIds: ["user-1"],
      provider: "outstand",
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it("returns nothing when neither the item nor the campaign has a brand", () => {
    const rows = buildPostsForItem({
      campaign: { ...campaign, brand_id: null },
      item: futureReel,
      profileIds: ["user-1"],
      provider: "outstand",
      now: NOW,
    });
    expect(rows).toEqual([]);
  });
});

describe("jitterMinutes", () => {
  it("is deterministic: same creator + item always lands on the same minute", () => {
    expect(jitterMinutes("profile-a", "item-1")).toBe(jitterMinutes("profile-a", "item-1"));
  });

  it("stays inside the 0 to 90 minute window", () => {
    for (let i = 0; i < 50; i++) {
      const j = jitterMinutes(`profile-${i}`, "item-1");
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(90);
    }
  });

  it("spreads creators out instead of stacking them on one second", () => {
    const values = new Set(
      Array.from({ length: 30 }, (_, i) => jitterMinutes(`profile-${i}`, "item-1")),
    );
    // 30 creators over 91 slots: collisions happen, a single slot must not.
    expect(values.size).toBeGreaterThan(10);
  });
});
