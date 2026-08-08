// Hugo, 08 Aug 2026: "we should see all the creators there, filter by
// creators, all the videos that are posted, the amount of views, views per
// creator... most viewed video... all type of filters", and "how many
// followers, people following etc, how many followers gained, everything we
// should be tracking."

import { describe, expect, it } from "vitest";
import {
  buildCreatorStats,
  summarise,
  type MetricsSnapshot,
  type StatsInput,
  type StatsPost,
} from "./creator-stats";

const now = new Date("2026-08-08T20:00:00Z");

function snap(profileId: string, at: string, followers: number, views: number): MetricsSnapshot {
  return {
    profile_id: profileId,
    captured_at: at,
    followers,
    following: 100,
    posts: 10,
    views,
    likes: 5,
    comments: 1,
    shares: 0,
    saves: 2,
    reach: views - 10,
    accounts_engaged: 3,
    total_interactions: 8,
  };
}

/** A post with no numbers read yet, which is the honest default. */
function post(over: Partial<StatsPost> & { profileId: string }): StatsPost {
  return {
    masterSeq: null,
    masterTitle: null,
    publishedAt: null,
    status: "pending",
    platformPostUrl: null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    reach: null,
    metricsCapturedAt: null,
    views24h: null,
    likes24h: null,
    ...over,
  };
}

const input: StatsInput = {
  accounts: [
    { profileId: "p1", igUsername: "alpha", firstName: "Ann", isConnected: true, connectedAt: "2026-08-01T00:00:00Z" },
    { profileId: "p2", igUsername: "beta", firstName: "Ben", isConnected: true, connectedAt: "2026-08-05T00:00:00Z" },
    { profileId: "p3", igUsername: "gamma", firstName: "Gus", isConnected: false, connectedAt: "2026-07-01T00:00:00Z" },
  ],
  snapshots: [
    snap("p1", "2026-08-01T07:00:00Z", 100, 1000),
    snap("p1", "2026-08-07T20:00:00Z", 120, 4000),
    snap("p1", "2026-08-08T19:00:00Z", 150, 5000),
    snap("p2", "2026-08-08T19:00:00Z", 40, 200),
  ],
  posts: [
    post({ profileId: "p1", masterSeq: 1, masterTitle: "Demo 1", publishedAt: "2026-08-08T09:00:00Z", status: "published", platformPostUrl: "https://instagram.com/p/AAA", views: 248, likes: 6, views24h: 200 }),
    post({ profileId: "p1", masterSeq: 2, masterTitle: "Demo 2", publishedAt: "2026-08-08T17:00:00Z", status: "published", views: 110 }),
    post({ profileId: "p2", masterSeq: 1, masterTitle: "Demo 1", publishedAt: null, status: "pending" }),
  ],
};

describe("creator stats", () => {
  it("uses each creator's most recent reading, not an older one", () => {
    const rows = buildCreatorStats(input, now);
    const alpha = rows.find((r) => r.igUsername === "alpha")!;
    expect(alpha.followers).toBe(150);
    expect(alpha.views).toBe(5000);
  });

  it("works out followers gained, which no endpoint reports", () => {
    const rows = buildCreatorStats(input, now);
    const alpha = rows.find((r) => r.igUsername === "alpha")!;
    // 150 now against 120 a day ago, and 100 a week ago.
    expect(alpha.followersGained24h).toBe(30);
    expect(alpha.followersGained7d).toBe(50);
  });

  it("says nothing rather than zero when there is no history to compare", () => {
    const rows = buildCreatorStats(input, now);
    const beta = rows.find((r) => r.igUsername === "beta")!;
    // One reading only. Reporting "0 gained" would read as "flat", which is a
    // different and wrong claim from "we have not measured yet".
    expect(beta.followersGained24h).toBeNull();
  });

  it("carries a creator with no readings at all instead of dropping them", () => {
    const rows = buildCreatorStats(input, now);
    const gamma = rows.find((r) => r.igUsername === "gamma")!;
    expect(gamma).toBeTruthy();
    expect(gamma.followers).toBeNull();
    expect(gamma.isConnected).toBe(false);
  });

  it("counts only published posts per creator, not pending ones", () => {
    const rows = buildCreatorStats(input, now);
    expect(rows.find((r) => r.igUsername === "alpha")!.postsPublished).toBe(2);
    expect(rows.find((r) => r.igUsername === "beta")!.postsPublished).toBe(0);
  });

  it("totals a selection of creators, which is the point of the filter", () => {
    const rows = buildCreatorStats(input, now);
    const both = summarise(rows.filter((r) => ["alpha", "beta"].includes(r.igUsername ?? "")));
    expect(both.followers).toBe(190);
    expect(both.views).toBe(5200);
    expect(both.postsPublished).toBe(2);
    expect(both.creators).toBe(2);
  });

  it("totals ignore creators we have never measured, rather than counting them as zero", () => {
    const rows = buildCreatorStats(input, now);
    const all = summarise(rows);
    expect(all.creators).toBe(3);
    expect(all.measured).toBe(2);
    expect(all.followers).toBe(190);
  });

  it("ranks by views so the top performer is findable", () => {
    const rows = buildCreatorStats(input, now);
    const sorted = [...rows].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    expect(sorted[0].igUsername).toBe("alpha");
  });

  it("keeps a link to the live post when Instagram gave us one", () => {
    const rows = buildCreatorStats(input, now);
    const alpha = rows.find((r) => r.igUsername === "alpha")!;
    const first = alpha.posts.find((p) => p.masterSeq === 1)!;
    expect(first.platformPostUrl).toBe("https://instagram.com/p/AAA");
  });

  it("lists a creator's posts newest first", () => {
    const rows = buildCreatorStats(input, now);
    const alpha = rows.find((r) => r.igUsername === "alpha")!;
    expect(alpha.posts.map((p) => p.masterSeq)).toEqual([2, 1]);
  });

  it("carries each video's own views and likes, which do exist per post", () => {
    const rows = buildCreatorStats(input, now);
    const alpha = rows.find((r) => r.igUsername === "alpha")!;
    const first = alpha.posts.find((p) => p.masterSeq === 1)!;
    expect(first.views).toBe(248);
    expect(first.likes).toBe(6);
    expect(first.views24h).toBe(200);
  });

  it("sums OUR videos separately from the creator's lifetime account views", () => {
    const rows = buildCreatorStats(input, now);
    const alpha = rows.find((r) => r.igUsername === "alpha")!;
    // The account has 5,000 views across everything it has ever posted. Our two
    // videos account for 358 of them. Conflating the two would credit this
    // pipeline with every view the creator ever earned.
    expect(alpha.views).toBe(5000);
    expect(alpha.ourViews).toBe(358);
  });

  it("leaves our-views null, not zero, for a creator whose videos are unread", () => {
    const rows = buildCreatorStats(input, now);
    const beta = rows.find((r) => r.igUsername === "beta")!;
    expect(beta.ourViews).toBeNull();
  });

  it("totals our views across a selection", () => {
    const rows = buildCreatorStats(input, now);
    expect(summarise(rows).ourViews).toBe(358);
    expect(summarise(rows).ourViews24h).toBe(200);
  });
});
