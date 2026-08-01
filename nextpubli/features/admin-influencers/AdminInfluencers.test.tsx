import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AdminInfluencers } from "./AdminInfluencers";
import { MOCK_INFLUENCER } from "@/mocks/profiles.mock";

vi.mock("@/lib/actions/admin", () => ({
  createInfluencer: vi.fn(),
}));

vi.mock("@/lib/actions/campaigns", () => ({
  addMembersToCampaign: vi.fn().mockResolvedValue({ success: true }),
}));

import { addMembersToCampaign } from "@/lib/actions/campaigns";

const MOCK_ROWS = [
  {
    profile: MOCK_INFLUENCER, // id "user-1", created_at 2026-05-01T00:00:00Z
    igUsername: "anasilva",
    bioStatus: "ok" as const,
    shareLink: "https://www.scanplates.com/?sck=ana4k2p9",
    totalSales: 12,
    commission: 359.4,
    clicks: 84,
  },
  {
    profile: {
      ...MOCK_INFLUENCER,
      id: "user-2",
      first_name: "Bruno",
      last_name: "Costa",
      email: "bruno@example.com",
      created_at: "2026-06-09T18:30:00Z", // 15:30 em São Paulo
    },
    igUsername: null,
    bioStatus: null,
    shareLink: null,
    totalSales: 0,
    commission: 0,
    clicks: 0,
  },
];

function renderList(overrides?: Partial<Parameters<typeof AdminInfluencers>[0]>) {
  return render(
    <AdminInfluencers
      influencers={MOCK_ROWS}
      campaignId="camp-1"
      campaignMemberIds={["user-1"]}
      {...overrides}
    />,
  );
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`Row for ${name} not found`);
  return row;
}

describe("AdminInfluencers", () => {
  it("renders heading", () => {
    renderList();
    expect(screen.getByText("Creators")).toBeInTheDocument();
  });

  it("shows influencer name", () => {
    renderList();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    renderList({ influencers: [] });
    expect(screen.getByText("No creators found.")).toBeInTheDocument();
  });

  it("shows 'In campaign' badge for campaign members", () => {
    renderList();
    expect(within(rowOf("Ana Silva")).getByText("In campaign")).toBeInTheDocument();
  });

  it("shows 'Not in campaign' badge and an Add button for non-members", async () => {
    const user = userEvent.setup();
    renderList();
    const row = rowOf("Bruno Costa");
    expect(within(row).getByText("Not in campaign")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Add" }));
    expect(addMembersToCampaign).toHaveBeenCalledWith("camp-1", ["user-2"], false);
  });

  it("filters the list by campaign membership", async () => {
    const user = userEvent.setup();
    renderList();
    const filter = screen.getByLabelText("Filter by campaign");

    await user.selectOptions(filter, "In campaign");
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(screen.queryByText("Bruno Costa")).not.toBeInTheDocument();

    await user.selectOptions(filter, "Not in campaign");
    expect(screen.queryByText("Ana Silva")).not.toBeInTheDocument();
    expect(screen.getByText("Bruno Costa")).toBeInTheDocument();

    await user.selectOptions(filter, "All");
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(screen.getByText("Bruno Costa")).toBeInTheDocument();
  });

  it("shows the registration timestamp in São Paulo time", () => {
    renderList();
    // 2026-05-01T00:00:00Z → 30/04/2026, 21:00 em São Paulo
    expect(within(rowOf("Ana Silva")).getByText("30/04/2026, 21:00")).toBeInTheDocument();
    // 2026-06-09T18:30:00Z → 09/06/2026, 15:30 em São Paulo
    expect(
      within(rowOf("Bruno Costa")).getByText("09/06/2026, 15:30"),
    ).toBeInTheDocument();
  });

  it("shows the Instagram handle as a link, or a dash when not connected", () => {
    renderList();
    expect(within(rowOf("Ana Silva")).getByText("@anasilva")).toBeInTheDocument();
    // Bruno has no IG: both the Instagram and the bio-link cells show a dash.
    expect(within(rowOf("Bruno Costa")).getAllByText("-").length).toBeGreaterThan(0);
  });

  it("shows bio-link status: ok badge, or 'Missing' + WhatsApp nudge", () => {
    renderList({
      influencers: [
        MOCK_ROWS[0], // bioStatus ok
        {
          ...MOCK_ROWS[0],
          profile: {
            ...MOCK_INFLUENCER,
            id: "user-3",
            first_name: "Caio",
            last_name: "Lima",
            whatsapp: "+5511999998888",
          },
          igUsername: "caiolima",
          bioStatus: "missing" as const,
          shareLink: "https://www.scanplates.com/?sck=caio1234",
        },
      ],
    });

    expect(within(rowOf("Ana Silva")).getByText("In bio ✓")).toBeInTheDocument();

    const caioRow = rowOf("Caio Lima");
    expect(within(caioRow).getByText("Missing")).toBeInTheDocument();
    const nudge = within(caioRow).getByRole("link", { name: "Nudge" });
    expect(nudge.getAttribute("href")).toContain("wa.me/5511999998888");
    expect(decodeURIComponent(nudge.getAttribute("href") ?? "")).toContain(
      "sck=caio1234",
    );
  });

  it("marks suspended influencers with a badge", () => {
    renderList({
      influencers: [
        {
          ...MOCK_ROWS[0],
          profile: { ...MOCK_INFLUENCER, suspended_at: "2026-06-11T00:00:00Z" },
        },
      ],
    });
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });
});
