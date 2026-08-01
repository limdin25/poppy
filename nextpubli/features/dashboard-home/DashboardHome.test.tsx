import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardHome } from "./DashboardHome";
import type { InstagramData } from "./DashboardHome";
import { MOCK_INFLUENCER } from "@/mocks/profiles.mock";
import type { MyCampaignStatus } from "@/lib/data/campaigns";

const mockInstagram: InstagramData = {
  username: "hugo8re",
  name: "Hugo Rodrigo",
  biography: "Playing Real Life Monopoly",
  profilePictureUrl: undefined,
  followersCount: 1615,
  followsCount: 1627,
  mediaCount: 20,
  accountType: "BUSINESS",
  isConnected: true,
};

const mockCampaignStatus: MyCampaignStatus = {
  campaign: { id: "camp-1", name: "Main Campaign" },
  added_at: "2026-06-05T13:00:00Z", // 10:00 em São Paulo
  next_post: {
    id: "post-1",
    media_type: "story_image",
    scheduled_at: "2026-06-12T20:00:00Z", // 17:00 em São Paulo
  },
};

const baseProps = {
  profile: MOCK_INFLUENCER,
  instagram: mockInstagram,
  shareLink: "https://www.scanplates.com/?sck=ana4k2p9",
  clicks: 12,
  sales: 3,
  earnings: 36,
  campaignStatus: null,
};

describe("DashboardHome", () => {
  it("renders welcome message with name", () => {
    render(<DashboardHome {...baseProps} />);
    expect(screen.getByText(/Hello, Ana/)).toBeInTheDocument();
  });

  it("shows Instagram username when connected", () => {
    render(<DashboardHome {...baseProps} />);
    expect(screen.getByText("@hugo8re")).toBeInTheDocument();
  });

  it("shows connect button when not connected", () => {
    render(<DashboardHome {...baseProps} instagram={null} />);
    expect(screen.getByText("Connect my Instagram")).toBeInTheDocument();
  });

  it("shows the influencer's share link with a copy button", () => {
    render(<DashboardHome {...baseProps} />);
    expect(
      screen.getByText("https://www.scanplates.com/?sck=ana4k2p9"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("shows the campaign card with name, joined date and next post in São Paulo time", () => {
    render(<DashboardHome {...baseProps} campaignStatus={mockCampaignStatus} />);
    expect(screen.getByText("Main Campaign")).toBeInTheDocument();
    expect(
      screen.getByText(/You have been in the campaign since 05\/06\/2026, 10:00/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Next post: Story on 12\/06\/2026, 17:00/),
    ).toBeInTheDocument();
  });

  it("shows a friendly message when in the campaign but nothing is scheduled", () => {
    render(
      <DashboardHome
        {...baseProps}
        campaignStatus={{ ...mockCampaignStatus, next_post: null }}
      />,
    );
    expect(
      screen.getByText("No posts scheduled at the moment."),
    ).toBeInTheDocument();
  });

  it("shows a waiting message when the account is not in a campaign yet", () => {
    render(<DashboardHome {...baseProps} campaignStatus={null} />);
    expect(
      screen.getByText(
        "Your account is not in the campaign yet. You will join automatically as soon as the administrator adds your account.",
      ),
    ).toBeInTheDocument();
  });

  it("nudges the influencer when their link is missing from the bio", () => {
    render(<DashboardHome {...baseProps} bioLinkMissing />);
    expect(
      screen.getByText("Your link is missing from your bio!"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"Website" field on your Instagram profile/),
    ).toBeInTheDocument();
  });

  it("hides the bio nudge when the link is already there", () => {
    render(<DashboardHome {...baseProps} bioLinkMissing={false} />);
    expect(
      screen.queryByText("Your link is missing from your bio!"),
    ).not.toBeInTheDocument();
  });
});
