import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminVideos } from "./AdminVideos";
import type { PipelineOverview } from "@/lib/data/video-pipeline-admin";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/actions/video-pipeline", () => ({
  approveMaster: vi.fn(),
  createMasterFromUpload: vi.fn(),
  createVideoUploadUrl: vi.fn(),
  updateMasterCaption: vi.fn(),
}));

const overview: PipelineOverview = {
  masters: [
    {
      id: "m-1",
      seq: 1,
      source_id: "v1",
      title: "Opener",
      caption: "",
      source_url: null,
      preview_url: "https://example.com/v1.mp4",
      status: "pending_approval",
      approved_at: null,
      approval_snapshot: null,
      recipe_version: 8,
      created_at: "2026-08-07T00:00:00Z",
      rendersReady: 0,
      rendersTotal: 0,
      postsScheduled: 0,
      postsPublished: 0,
      postsFailed: 0,
      accounts: [
        {
          igUsername: "kaorimodel04",
          colorFamily: "obsidian-citrus",
          colorHex: "#111a1d",
          colorAccentHex: "#adef5b",
          timeZone: "Asia/Kolkata",
          scheduledAt: null,
          state: "waiting" as const,
          caption: "Wait for the end.\n\n#AIReels #Shopify",
        },
      ],
    },
  ],
  creators: [
    {
      profileId: "p-1",
      igUsername: "kaorimodel04",
      firstName: "Bhupender",
      colorFamily: "cyber-mint",
      colorHex: "#0b3533",
      colorAccentHex: "#60f4af",
      timeZone: "Asia/Kolkata",
      staggerMin: 0,
      nextSeq: 1,
      nextTimes: ["2026-08-08T05:30:00.000Z"],
      enrolled: true,
      connectedAt: "2026-08-01T09:15:00.000Z",
    },
  ],
  workerLastSeen: new Date().toISOString(),
  workerAlive: true,
};

describe("AdminVideos", () => {
  it("shows the master with its approve gate, the account with its color, and the worker pulse", () => {
    render(<AdminVideos overview={overview} />);
    expect(screen.getByTestId("master-1")).toBeTruthy();
    expect(screen.getByTestId("approve-1").textContent).toContain("Approve for all accounts");
    expect(screen.getByTestId("creator-kaorimodel04").textContent).toContain("cyber-mint");
    expect(screen.getByTestId("worker-pulse").textContent).toContain("alive");
  });

  it("an approved master shows no approve button", () => {
    const approved = {
      ...overview,
      masters: [
        {
          ...overview.masters[0],
          status: "approved" as const,
          approved_at: "2026-08-07T22:00:00Z",
          approval_snapshot: {
            at: "2026-08-07T22:00:00Z",
            accounts: [
              { profileId: "p-1", igUsername: "kaorimodel04", colorFamily: "obsidian-citrus" },
            ],
          },
        },
      ],
    };
    render(<AdminVideos overview={approved} />);
    expect(screen.queryByTestId("approve-1")).toBeNull();
    expect(screen.getByTestId("approved-tag-1").textContent).toContain("for 1 accounts");
  });

  it("shows who the approval covers, before and after", () => {
    render(<AdminVideos overview={overview} />);
    expect(screen.getByTestId("master-accounts-1").textContent).toContain(
      "Approving sends this to 1 accounts",
    );
    expect(screen.getByTestId("master-accounts-1").textContent).toContain("after you approve");
  });

  it("shows each account's exact caption and hashtags before approval", () => {
    render(<AdminVideos overview={overview} />);
    const caption = screen.getByTestId("account-caption-1-kaorimodel04");
    expect(caption.textContent).toContain("Wait for the end.");
    expect(caption.textContent).toContain("#AIReels");
  });

  // Hugo, 08 Aug 2026: "put maybe an option on our websites when I upload the
  // video for rendering, I can choose the gender as well." It decides which
  // pool the per-account voice comes from, and a wrong answer puts a woman's
  // voice on a man in a video that goes out publicly.
  // Hugo, 08 Aug 2026: "on all those accounts we should take a hyperlink that
  // take us to the accounts... you should have the date of connection when the
  // account was connected."
  it("links every account to its Instagram and shows when it connected", () => {
    render(<AdminVideos overview={overview} />);
    const link = screen.getByTestId("creator-link-kaorimodel04") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://instagram.com/kaorimodel04");
    expect(link.getAttribute("target")).toBe("_blank");
    // Opening a new tab without this leaks window.opener to instagram.com.
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByTestId("creator-connected-kaorimodel04").textContent).toContain("1 Aug 2026");
    // The same account listed under a master links out too.
    expect(
      screen.getByTestId("account-link-1-kaorimodel04").getAttribute("href"),
    ).toBe("https://instagram.com/kaorimodel04");
  });

  it("asks who is speaking, with neither answer preselected", () => {
    render(<AdminVideos overview={overview} />);
    const woman = screen.getByTestId("upload-gender-female");
    const man = screen.getByTestId("upload-gender-male");
    expect(woman.getAttribute("aria-pressed")).toBe("false");
    expect(man.getAttribute("aria-pressed")).toBe("false");
  });

  it("will not let you upload until you have answered", () => {
    render(<AdminVideos overview={overview} />);
    expect((screen.getByTestId("upload-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("upload-gender-male"));
    expect(screen.getByTestId("upload-gender-male").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("upload-gender-female").getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByTestId("upload-button") as HTMLButtonElement).disabled).toBe(false);
  });
});
