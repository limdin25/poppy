import { describe, it, expect } from "vitest";
import { parsePostAnalytics } from "@/lib/integrations/outstand";
import { deltaFor, buildPostMetricRows, WINDOWS, emptyDeltas } from "@/lib/data/post-metrics";

// The exact payload the live API returned for post Q20aV on 08 Aug 2026.
const LIVE = {
  success: true,
  post: { id: "Q20aV", publishedAt: "2026-08-08T13:19:10.348Z" },
  metrics_by_account: [
    {
      social_account: { id: "74315", username: "indiscipline_com" },
      platform_post_id: "18108392459352242",
      platform_post_url: "https://www.instagram.com/reel/Dbx9A2Bjl69/",
      published_at: "2026-08-08T13:19:10.303Z",
      metrics: {
        platform_specific: { reach: 0, saved: 0, likes: 0, comments: 0, shares: 0, views: 1 },
        reach: 0,
        likes: 0,
        comments: 0,
        saves: 0,
        shares: 0,
        views: 1,
      },
    },
  ],
  aggregated_metrics: { total_views: 1 },
};

describe("parsePostAnalytics", () => {
  it("reads the numbers and the permalink out of the live shape", () => {
    const a = parsePostAnalytics(LIVE);
    expect(a).toEqual({
      platformPostId: "18108392459352242",
      platformPostUrl: "https://www.instagram.com/reel/Dbx9A2Bjl69/",
      views: 1,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reach: 0,
    });
  });

  it("keeps a real zero as 0, never as null", () => {
    // Zero views on a minutes-old reel is a measurement. Turning it into null
    // would render as "not measured" and hide a post that genuinely flopped.
    const a = parsePostAnalytics(LIVE);
    expect(a?.views).toBe(1);
    expect(a?.likes).toBe(0);
    expect(a?.likes).not.toBeNull();
  });

  it("returns null when the post has no account block rather than inventing zeros", () => {
    expect(parsePostAnalytics({ success: true, post: {}, metrics_by_account: [] })).toBeNull();
    expect(parsePostAnalytics(null)).toBeNull();
  });

  it("falls back to platform_specific when the flat fields are absent", () => {
    const odd = {
      metrics_by_account: [
        {
          platform_post_id: "1",
          platform_post_url: "u",
          metrics: { platform_specific: { views: 42, likes: 7, saved: 3, reach: 9 } },
        },
      ],
    };
    const a = parsePostAnalytics(odd);
    expect(a?.views).toBe(42);
    expect(a?.likes).toBe(7);
    // Instagram spells it "saved" inside platform_specific and "saves" outside.
    expect(a?.saves).toBe(3);
  });
});

describe("deltaFor", () => {
  const rows = [
    { captured_at: "2026-08-09T12:00:00Z", views: 500 },
    { captured_at: "2026-08-09T06:00:00Z", views: 300 },
    { captured_at: "2026-08-08T09:00:00Z", views: 100 },
  ];
  const now = new Date("2026-08-09T12:00:00Z");

  it("is the gap between now and the newest reading at least 24h old", () => {
    expect(deltaFor(rows, now, 24, "views")).toBe(400);
  });

  it("is null, never 0, when there is only one reading", () => {
    // 0 reads as "flat", which is a different and untrue claim from "we have
    // not measured this twice yet".
    expect(deltaFor([{ captured_at: "2026-08-09T12:00:00Z", views: 500 }], now, 24, "views")).toBeNull();
  });

  it("is null when every reading is inside the window", () => {
    const fresh = [
      { captured_at: "2026-08-09T12:00:00Z", views: 500 },
      { captured_at: "2026-08-09T11:00:00Z", views: 480 },
    ];
    expect(deltaFor(fresh, now, 24, "views")).toBeNull();
  });

  it("is null when the metric itself was never recorded", () => {
    const nulls = [
      { captured_at: "2026-08-09T12:00:00Z", views: null },
      { captured_at: "2026-08-08T06:00:00Z", views: null },
    ];
    expect(deltaFor(nulls, now, 24, "views")).toBeNull();
  });

  it("credits the whole count to a window the video was born inside", () => {
    // Posted 2 hours ago, so its 500 views were all earned in the last 24h,
    // the last 72h and the last 30 days. Demanding an anchor reading from
    // before it existed would blank every period but the shortest.
    const born = "2026-08-09T10:00:00Z";
    expect(deltaFor(rows, now, 24, "views", born)).toBe(500);
    expect(deltaFor(rows, now, 24 * 30, "views", born)).toBe(500);
  });

  it("still subtracts for a video older than the window", () => {
    const old = "2026-07-01T00:00:00Z";
    expect(deltaFor(rows, now, 24, "views", old)).toBe(400);
  });

  it("never reports a negative view count from a late-arriving reading", () => {
    // Instagram restates numbers downward sometimes. A video cannot lose views,
    // so a negative delta is a data artefact and is reported as null.
    const wobble = [
      { captured_at: "2026-08-09T12:00:00Z", views: 90 },
      { captured_at: "2026-08-08T06:00:00Z", views: 100 },
    ];
    expect(deltaFor(wobble, now, 24, "views")).toBeNull();
  });
});

describe("time windows", () => {
  it("offers the periods Hugo asked for, shortest first", () => {
    expect(WINDOWS.map((w) => w.key)).toEqual(["h24", "h72", "d7", "d30"]);
    expect(WINDOWS.map((w) => w.hours)).toEqual([24, 72, 168, 720]);
  });
});

describe("buildPostMetricRows", () => {
  const snaps = [
    { post_id: "p1", captured_at: "2026-08-09T12:00:00Z", views: 500, likes: 20, reach: 400 },
    { post_id: "p1", captured_at: "2026-08-08T06:00:00Z", views: 100, likes: 5, reach: 90 },
    { post_id: "p1", captured_at: "2026-08-02T06:00:00Z", views: 10, likes: 0, reach: 8 },
    { post_id: "p2", captured_at: "2026-08-09T12:00:00Z", views: 7, likes: 0, reach: 5 },
  ];
  const now = new Date("2026-08-09T12:00:00Z");
  // p1 is an old post with a run of readings; p2 went out an hour ago.
  const posts = [
    { id: "p1", publishedAt: "2026-06-01T00:00:00Z" },
    { id: "p2", publishedAt: "2026-08-09T11:00:00Z" },
  ];

  it("works out every window from one pass over the readings", () => {
    const out = buildPostMetricRows(posts, snaps, now);
    const p1 = out.get("p1")!;
    expect(p1.h24.views).toBe(400);
    expect(p1.h24.likes).toBe(15);
    // A week back reaches the oldest reading, so the gain is the whole run.
    expect(p1.d7.views).toBe(490);
  });

  it("leaves a window null when an older post has no reading that far back", () => {
    const out = buildPostMetricRows(posts, snaps, now);
    // p1 predates the 30-day window and we hold no reading from then, so its
    // 30-day gain is genuinely unknown rather than equal to its total.
    expect(out.get("p1")!.d30.views).toBeNull();
  });

  it("credits a brand new post's whole count to every window it fits inside", () => {
    const out = buildPostMetricRows(posts, snaps, now);
    expect(out.get("p2")!.h24.views).toBe(7);
    expect(out.get("p2")!.d30.views).toBe(7);
  });

  it("gives a post with no readings at all a full set of nulls, not zeros", () => {
    const out = buildPostMetricRows([{ id: "ghost" }], [], now);
    expect(out.get("ghost")).toEqual(emptyDeltas());
    expect(out.get("ghost")!.h24.views).toBeNull();
  });
});
