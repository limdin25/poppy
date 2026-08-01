import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AdminCampaign } from "./AdminCampaign";
import { mockCampaign, mockItems, mockMembers, mockCandidates, mockBrands } from "./mock";

vi.mock("@/lib/actions/campaigns", () => ({
  createCampaignItem: vi.fn(),
  updateCampaignItem: vi.fn(),
  deleteCampaignItem: vi.fn(),
  addMembersToCampaign: vi.fn(),
  removeMemberFromCampaign: vi.fn(),
  updateCampaign: vi.fn(),
}));

vi.mock("@/lib/actions/media", () => ({
  createMediaUploadUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }),
}));

function renderAll(overrides?: Partial<Parameters<typeof AdminCampaign>[0]>) {
  return render(
    <AdminCampaign
      campaign={mockCampaign}
      items={mockItems}
      members={mockMembers}
      candidates={mockCandidates}
      brands={mockBrands}
      {...overrides}
    />,
  );
}

describe("AdminCampaign", () => {
  it("shows the campaign name and the timeline with São Paulo timestamps", () => {
    renderAll();
    expect(screen.getByText("Main Campaign")).toBeInTheDocument();
    // 2099-06-11T20:00:00Z is 17:00 in Sao Paulo
    expect(screen.getByText(/11\/06\/2099, 17:00/)).toBeInTheDocument();
    expect(screen.getByText("Thursday story")).toBeInTheDocument();
    expect(screen.getByText("Launch reel")).toBeInTheDocument();
  });

  it("filters the timeline by post type", async () => {
    const user = userEvent.setup();
    renderAll();
    await user.selectOptions(screen.getByLabelText(/^type$/i), "reel");
    expect(screen.queryByText("Thursday story")).not.toBeInTheDocument();
    expect(screen.getByText("Launch reel")).toBeInTheDocument();
  });

  it("lists members with when they were added", () => {
    renderAll();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(screen.getByText("@ana.silva")).toBeInTheDocument();
    // 2026-06-05T13:00:00Z is 10:00 in Sao Paulo
    expect(screen.getByText(/05\/06\/2026, 10:00/)).toBeInTheDocument();
  });

  it("opens the add-accounts modal listing connected accounts not yet in the campaign", async () => {
    const user = userEvent.setup();
    renderAll();
    await user.click(screen.getByRole("button", { name: /add accounts/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Bruno Costa")).toBeInTheDocument();
    expect(within(dialog).getByText(/start now/i)).toBeInTheDocument();
  });

  it("opens the add-item modal with type, upload, media URL and datetime fields", async () => {
    const user = userEvent.setup();
    renderAll();
    await user.click(screen.getByRole("button", { name: /add post/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/post type/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/drag media here or click to upload/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByPlaceholderText(/paste the media url/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/date and time/i)).toBeInTheDocument();
    // Default type is story, the official API allows media only, so no caption.
    expect(within(dialog).queryByLabelText(/caption/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/not allowed by meta/i)).toBeInTheDocument();
  });

  it("reveals caption, collaborators and first comment when the type is feed", async () => {
    const user = userEvent.setup();
    renderAll();
    await user.click(screen.getByRole("button", { name: /add post/i }));
    const dialog = screen.getByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText(/post type/i), "feed");

    expect(within(dialog).getByLabelText(/^caption$/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/collaborators/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/first comment/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/reel cover/i)).not.toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText(/post type/i), "reel");
    expect(within(dialog).getByLabelText(/reel cover/i)).toBeInTheDocument();
  });

  it("shows empty states for timeline and members", () => {
    renderAll({ items: [], members: [], candidates: [] });
    expect(screen.getByText(/no posts in the campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/no accounts in the campaign/i)).toBeInTheDocument();
  });
});
