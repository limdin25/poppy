import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminStats } from "./AdminStats";
import type { CreatorStatsRow } from "@/lib/data/creator-stats";

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
    posts: [
      {
        profileId: "p1",
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
        views24h: 200,
        likes24h: 4,
      },
    ],
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
    fireEvent.click(screen.getByTestId("clear-selection"));
    expect(screen.getByTestId("stats-row-beta")).toBeTruthy();
  });

  it("names the most viewed account", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("stats-top").textContent).toContain("@alpha");
  });

  it("says a creator is unmeasured rather than showing a flat zero", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("stats-row-beta").textContent).toContain("not measured yet");
  });

  it("links each posted video to the live Instagram post", () => {
    render(<AdminStats rows={rows} />);
    const posts = screen.getByTestId("stats-posts");
    expect(posts.innerHTML).toContain("https://instagram.com/p/AAA");
  });

  it("sorts by whichever number is asked for", () => {
    render(<AdminStats rows={rows} />);
    fireEvent.click(screen.getByTestId("sort-views"));
    expect(screen.getByTestId("sort-views").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows each video's own views and likes, not just the account's", () => {
    render(<AdminStats rows={rows} />);
    const posts = screen.getByTestId("stats-posts").textContent ?? "";
    expect(posts).toContain("248");
    expect(posts).toContain("6");
  });

  it("shows what a video did in the last 24 hours", () => {
    render(<AdminStats rows={rows} />);
    expect(screen.getByTestId("stats-posts").textContent).toContain("200");
  });

  it("separates views on our videos from the account's lifetime views", () => {
    render(<AdminStats rows={rows} />);
    const totals = screen.getByTestId("stats-totals").textContent ?? "";
    // 5,200 across both accounts' whole history, 248 on the videos we made.
    expect(totals).toContain("5,200");
    expect(totals).toContain("248");
  });

  it("says a video is unread rather than showing it on zero views", () => {
    const unread = [
      row({
        posts: [
          {
            profileId: "p1",
            masterSeq: 9,
            masterTitle: "Demo 9",
            publishedAt: "2026-08-08T09:00:00Z",
            status: "published",
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
          },
        ],
      }),
    ];
    render(<AdminStats rows={unread} />);
    expect(screen.getByTestId("stats-posts").textContent).toContain("not read yet");
  });
});
