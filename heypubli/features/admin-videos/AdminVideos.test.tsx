import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
      recipe_version: 8,
      created_at: "2026-08-07T00:00:00Z",
      rendersReady: 0,
      rendersTotal: 0,
      postsScheduled: 0,
      postsPublished: 0,
    },
  ],
  creators: [
    {
      profileId: "p-1",
      igUsername: "kaorimodel04",
      firstName: "Bhupender",
      colorFamily: "cyber-mint",
      colorHex: "#0f1f1a",
      timeZone: "Asia/Kolkata",
      staggerMin: 0,
      nextSeq: 1,
      nextTimes: ["2026-08-08T05:30:00.000Z"],
      enrolled: true,
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
      masters: [{ ...overview.masters[0], status: "approved" as const, approved_at: "2026-08-07T22:00:00Z" }],
    };
    render(<AdminVideos overview={approved} />);
    expect(screen.queryByTestId("approve-1")).toBeNull();
  });
});
