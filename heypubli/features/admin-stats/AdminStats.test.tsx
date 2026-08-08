import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AdminStats } from "./AdminStats";
import type { CreatorStatsRow, StatsPost } from "@/lib/data/creator-stats";
import { emptyDeltas } from "@/lib/data/post-metrics";

function post(over: Partial<StatsPost> & { d24?: number }): StatsPost {
  const { d24, ...rest } = over;
  const deltas = emptyDeltas();
  if (d24 != null) deltas.h24 = { views: d24, likes: 4, reach: null };
  return {
    profileId: "p1",
    masterVideoId: "m1",
    masterSeq: 1,
    masterTitle: "Demo 1",
    publishedAt: "2026-08-08T09:00:00Z",
    status: "published",
    platformPostUrl: "https://instagram.com/p/AAA",
    views: 248,
    likes: 6,
    comments: 1,
    shares: 0,
    saves: 2,
    reach: 160,
    metricsCapturedAt: "2026-08-08T19:00:00Z",
    deltas,
    ...rest,
  };
}

function row(over: Partial<CreatorStatsRow>): CreatorStatsRow {
  return {
    profileId: "p1",
    igUsername: "alpha",
    firstName: "Ann",
    isConnected: true,
    connectedAt: "2026-08-01T00:00:00Z",
    measuredAt: "2026-08-08T19:00:00Z",
    followers: 150,
    following: 100,
    views: 5000,
    likes: 40,
    comments: 3,
    shares: 1,
    saves: 6,
    reach: 4000,
    followersGained24h: 30,
    followersGained7d: 50,
    postsPublished: 2,
    ourViews: 248,
    ourLikes: 6,
    ourViews24h: 200,
    posts: [post({ d24: 200 })],
    ...over,
  };
}

const rows: CreatorStatsRow[] = [
  row({}),
  row({
    profileId: "p2",
    igUsername: "beta",
    firstName: "Ben",
    followers: 40,
    views: 200,
    followersGained24h: null,
    followersGained7d: null,
    postsPublished: 0,
    ourViews: null,
    ourLikes: null,
    ourViews24h: null,
    posts: [],
  }),
];

describe("AdminStats", () => {
  it("shows every creator with their followers and views", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("stats-row-alpha")).toBeTruthy();
    expect(screen.getByTestId("stats-row-beta")).toBeTruthy();
    expect(screen.getByTestId("stats-totals").textContent).toContain("190");
  });

  it("totals only the creators picked, which is what the filter is for", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.click(screen.getByTestId("select-alpha"));
    const totals = screen.getByTestId("stats-totals").textContent ?? "";
    expect(totals).toContain("150");
    expect(totals).not.toContain("190");
  });

  it("picking nobody means everybody, not an empty page", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.click(screen.getByTestId("select-alpha"));
    fireEvent.click(screen.getByTestId("clear-filters"));
    expect(screen.getByTestId("stats-row-beta")).toBeTruthy();
  });

  it("names the most viewed account and the most viewed video", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("stats-top").textContent).toContain("@alpha");
    expect(screen.getByTestId("stats-top-video").textContent).toContain("Demo 1");
  });

  it("says a creator is unmeasured rather than showing a flat zero", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("stats-row-beta").textContent).toContain("not measured yet");
  });

  it("shows each video's own views, likes and link", () => {
    render(<AdminStats rows={rows} />);
    const posts = screen.getByTestId("stats-posts");
    expect(posts.innerHTML).toContain("https://instagram.com/p/AAA");
    expect(posts.textContent).toContain("248");
  });

  // --- the period selector ---

  it("offers every period Hugo asked for", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("period-h24")).toBeTruthy();
    expect(screen.getByTestId("period-h72")).toBeTruthy();
    expect(screen.getByTestId("period-d7")).toBeTruthy();
    expect(screen.getByTestId("period-d30")).toBeTruthy();
  });

  it("changes the movement figure when the period changes", () => {
    render(<AdminStats rows={rows} />);
    // 24h has a reading, 7d does not, so the total must stop claiming 200.
    expect(screen.getByTestId("posts-totals").textContent).toContain("200");
    fireEvent.click(screen.getByTestId("period-d7"));
    expect(screen.getByTestId("posts-totals").textContent).not.toContain("200");
  });

  it("filters videos to a hand-picked date range", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.change(screen.getByTestId("date-from"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByTestId("date-to"), { target: { value: "2026-08-02" } });
    expect(screen.getByTestId("stats-posts").textContent).toContain("No videos");
  });

  it("keeps a video posted on the last day of the chosen range", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.change(screen.getByTestId("date-from"), { target: { value: "2026-08-08" } });
    fireEvent.change(screen.getByTestId("date-to"), { target: { value: "2026-08-08" } });
    expect(screen.getByTestId("stats-posts").textContent).toContain("248");
  });

  // --- totals on the videos table ---

  it("totals views and likes across the videos on screen", () => {
    render(<AdminStats rows={rows} />);
    const totals = screen.getByTestId("posts-totals").textContent ?? "";
    expect(totals).toContain("248");
    expect(totals).toContain("1 video");
  });

  // --- filter by video ---

  it("filters everything down to one master video", () => {
    const two = [
      row({ posts: [post({ d24: 200 }), post({ masterVideoId: "m2", masterSeq: 2, masterTitle: "Demo 2", views: 110 })] }),
    ];
    render(<AdminStats rows={two} />);
    expect(screen.getByTestId("stats-posts").textContent).toContain("110");
    fireEvent.click(screen.getByTestId("select-master-m1"));
    expect(screen.getByTestId("stats-posts").textContent).not.toContain("110");
    expect(screen.getByTestId("stats-posts").textContent).toContain("248");
  });

  it("ranks the masters so the best performing video is obvious", () => {
    const two = [
      row({ posts: [post({ d24: 200 }), post({ masterVideoId: "m2", masterSeq: 2, masterTitle: "Demo 2", views: 110 })] }),
    ];
    render(<AdminStats rows={two} />);
    const table = screen.getByTestId("master-table");
    const first = within(table).getAllByTestId(/^master-row-/)[0];
    expect(first.getAttribute("data-testid")).toBe("master-row-m1");
  });

  // --- expandable creators, Hugo's follow-up ---

  it("hides a creator's videos until the row is expanded", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.queryByTestId("creator-posts-p1")).toBeNull();
    fireEvent.click(screen.getByTestId("expand-p1"));
    expect(screen.getByTestId("creator-posts-p1")).toBeTruthy();
  });

  it("shows the newest videos first and keeps older ones behind a toggle", () => {
    const many = [
      row({
        posts: [
          post({ publishedAt: "2026-08-08T18:00:00Z", views: 1, masterSeq: 4, masterTitle: "Newest" }),
          post({ publishedAt: "2026-08-08T17:00:00Z", views: 2, masterSeq: 3, masterTitle: "Second" }),
          post({ publishedAt: "2026-08-08T16:00:00Z", views: 3, masterSeq: 2, masterTitle: "Older" }),
        ],
      }),
    ];
    render(<AdminStats rows={many} />);
    fireEvent.click(screen.getByTestId("expand-p1"));
    const panel = screen.getByTestId("creator-posts-p1");
    expect(panel.textContent).toContain("Newest");
    expect(panel.textContent).toContain("Second");
    expect(panel.textContent).not.toContain("Older");
    fireEvent.click(screen.getByTestId("show-all-p1"));
    expect(screen.getByTestId("creator-posts-p1").textContent).toContain("Older");
  });

  it("does not offer a show-all when there is nothing more to show", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.click(screen.getByTestId("expand-p1"));
    expect(screen.queryByTestId("show-all-p1")).toBeNull();
  });

  it("sorts by whichever number is asked for", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.click(screen.getByTestId("sort-views"));
    expect(screen.getByTestId("sort-views").getAttribute("aria-pressed")).toBe("true");
  });

  it("says a video is unread rather than showing it on zero views", () => {
    const unread = [row({ posts: [post({ views: null, likes: null, reach: null, metricsCapturedAt: null })] })];
    render(<AdminStats rows={unread} />);
    expect(screen.getByTestId("stats-posts").textContent).toContain("not read yet");
  });
});
