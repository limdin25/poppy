// Hugo, 08 Aug 2026: "we should see all the creators there, filter by
// creators, all the videos that are posted, the amount of views, views per
// creator... most viewed video... all type of filters", and "how many
// followers, people following etc, how many followers gained, everything we
// should be tracking."

import { describe, expect, it } from "vitest";
import {
  buildCreatorStats,
  summarise,
  flattenPosts,
  summarisePosts,
  summariseByMaster,
  inRange,
  type MetricsSnapshot,
  type StatsInput,
  type StatsPost,
} from "./creator-stats";
import { emptyDeltas } from "./post-metrics";

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
function post(
  over: Partial<StatsPost> & { profileId: string } & { d24?: number },
): StatsPost {
  const { d24, ...rest } = over;
  const deltas = emptyDeltas();
  if (d24 != null) deltas.h24 = { views: d24, likes: null, reach: null };
  return {
    masterVideoId: null,
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
    deltas,
    ...rest,
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
    post({ profileId: "p1", masterVideoId: "m1", masterSeq: 1, masterTitle: "Demo 1", publishedAt: "2026-08-08T09:00:00Z", status: "published", platformPostUrl: "https://instagram.com/p/AAA", views: 248, likes: 6, comments: 2, shares: 1, saves: 3, reach: 160, metricsCapturedAt: "2026-08-08T19:00:00Z", d24: 200 }),
    post({ profileId: "p1", masterVideoId: "m2", masterSeq: 2, masterTitle: "Demo 2", publishedAt: "2026-08-08T17:00:00Z", status: "published", views: 110, likes: 0, reach: 100, metricsCapturedAt: "2026-08-08T19:00:00Z" }),
    post({ profileId: "p2", masterVideoId: "m1", masterSeq: 1, masterTitle: "Demo 1", publishedAt: null, status: "pending" }),
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
    expect(first.deltas.h24.views).toBe(200);
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

describe("flattenPosts", () => {
  it("carries the creator onto each video, which every cross-creator view needs", () => {
    const flat = flattenPosts(buildCreatorStats(input, now));
    expect(flat).toHaveLength(2); // published only
    expect(flat[0].igUsername).toBe("alpha");
    expect(flat[0].creatorName).toBe("Ann");
  });

  it("orders newest first, so the list reads like a feed", () => {
    const flat = flattenPosts(buildCreatorStats(input, now));
    expect(flat.map((p) => p.masterSeq)).toEqual([2, 1]);
  });
});

describe("inRange", () => {
  const p = (at: string | null) => ({ publishedAt: at });

  it("keeps everything when no dates are set", () => {
    expect(inRange(p("2026-08-08T09:00:00Z"), "", "")).toBe(true);
    expect(inRange(p(null), "", "")).toBe(true);
  });

  it("includes the whole of the end day, not just its first instant", () => {
    // Picking 8 Aug to 8 Aug must include a video posted at 17:00 that day.
    // A naive Date.parse of the end date lands at 00:00 and excludes it all.
    expect(inRange(p("2026-08-08T17:00:00Z"), "2026-08-08", "2026-08-08")).toBe(true);
  });

  it("excludes what falls outside", () => {
    expect(inRange(p("2026-08-07T23:00:00Z"), "2026-08-08", "2026-08-08")).toBe(false);
    expect(inRange(p("2026-08-09T01:00:00Z"), "2026-08-08", "2026-08-08")).toBe(false);
  });

  it("drops an unpublished video from any dated range rather than guessing", () => {
    expect(inRange(p(null), "2026-08-08", "")).toBe(false);
  });
});

describe("summarisePosts", () => {
  const flat = () => flattenPosts(buildCreatorStats(input, now));

  it("totals the numbers on whichever videos are on screen", () => {
    const t = summarisePosts(flat(), "h24");
    expect(t.videos).toBe(2);
    expect(t.views).toBe(358);
    expect(t.likes).toBe(6);
    expect(t.reach).toBe(260);
    expect(t.creators).toBe(1);
  });

  it("totals the movement for the chosen period, not a fixed one", () => {
    expect(summarisePosts(flat(), "h24").gainedViews).toBe(200);
    // Nothing has a 7-day reading in this fixture, so it says so.
    expect(summarisePosts(flat(), "d7").gainedViews).toBeNull();
  });

  it("works out engagement as a share of the views it actually reached", () => {
    // 6 likes + 2 comments + 1 share + 3 saves = 12 interactions on 358 views.
    expect(summarisePosts(flat(), "h24").engagementRate).toBeCloseTo(12 / 358, 5);
  });

  it("gives averages per video, which is the comparable number as volume grows", () => {
    expect(summarisePosts(flat(), "h24").avgViews).toBe(179);
  });

  it("returns an honest empty rather than zeros for no videos", () => {
    const t = summarisePosts([], "h24");
    expect(t.videos).toBe(0);
    expect(t.views).toBeNull();
    expect(t.engagementRate).toBeNull();
    expect(t.avgViews).toBeNull();
  });
});

describe("summariseByMaster", () => {
  it("groups the same master across every creator that posted it", () => {
    const rows = summariseByMaster(flattenPosts(buildCreatorStats(input, now)), "h24");
    const m1 = rows.find((r) => r.masterVideoId === "m1")!;
    expect(m1.seq).toBe(1);
    expect(m1.title).toBe("Demo 1");
    // Only the published one counts; p2's copy is still pending.
    expect(m1.posts).toBe(1);
    expect(m1.views).toBe(248);
  });

  it("ranks the best performing master first, which is the point of it", () => {
    const rows = summariseByMaster(flattenPosts(buildCreatorStats(input, now)), "h24");
    expect(rows[0].views).toBe(248);
    expect(rows[0].seq).toBe(1);
  });

  it("reports average views per posting, so a master on 20 accounts is comparable to one on 2", () => {
    const rows = summariseByMaster(flattenPosts(buildCreatorStats(input, now)), "h24");
    expect(rows.find((r) => r.seq === 1)!.avgViews).toBe(248);
    expect(rows.find((r) => r.seq === 2)!.avgViews).toBe(110);
  });
});
