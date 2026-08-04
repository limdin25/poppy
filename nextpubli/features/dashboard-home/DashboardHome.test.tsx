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

  // Hugo, 2026-08-04: "the referral URL, it doesn't matter for now, we can hide
  // it from here." It was the Hotmart share link (a ScanPlates URL with ?sck=),
  // pointing at a product we no longer sell. The link that matters now is the
  // creator's own Skool affiliate link, which lives in Getting started.
  it("no longer shows the Hotmart share link or its tier ladder", () => {
    render(<DashboardHome {...baseProps} />);
    expect(screen.queryByText(/sck=/)).not.toBeInTheDocument();
    expect(screen.queryByText("Your share link")).not.toBeInTheDocument();
    expect(screen.queryByText("Your products")).not.toBeInTheDocument();
    // The fabricated brand ladder went with it.
    expect(screen.queryByAltText("Nike")).not.toBeInTheDocument();
  });

  it("renders whatever the page puts in the right column", () => {
    render(<DashboardHome {...baseProps} rightColumn={<p>Getting started</p>} />);
    expect(screen.getByText("Getting started")).toBeInTheDocument();
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

  // The bio nudge went with the share link: it existed to chase the Hotmart
  // tag into their Instagram website field. Bio work is step 3 of Getting
  // started now, and it asks for the Skool affiliate link instead.
  it("no longer nudges about the old referral tag in the bio", () => {
    render(<DashboardHome {...baseProps} />);
    expect(
      screen.queryByText("Your link is missing from your bio!"),
    ).not.toBeInTheDocument();
  });
});
