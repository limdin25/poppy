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
  campaign: { id: "camp-1", name: "Campanha Principal" },
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
    expect(screen.getByText(/Olá, Ana/)).toBeInTheDocument();
  });

  it("shows Instagram username when connected", () => {
    render(<DashboardHome {...baseProps} />);
    expect(screen.getByText("@hugo8re")).toBeInTheDocument();
  });

  it("shows connect button when not connected", () => {
    render(<DashboardHome {...baseProps} instagram={null} />);
    expect(screen.getByText("Conectar meu Instagram")).toBeInTheDocument();
  });

  it("shows the influencer's share link with a copy button", () => {
    render(<DashboardHome {...baseProps} />);
    expect(
      screen.getByText("https://www.scanplates.com/?sck=ana4k2p9"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
  });

  it("shows the campaign card with name, joined date and next post in São Paulo time", () => {
    render(<DashboardHome {...baseProps} campaignStatus={mockCampaignStatus} />);
    expect(screen.getByText("Campanha Principal")).toBeInTheDocument();
    expect(
      screen.getByText(/Você está na campanha desde 05\/06\/2026, 10:00/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Próxima publicação: Story em 12\/06\/2026, 17:00/),
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
      screen.getByText("Nenhuma publicação agendada no momento."),
    ).toBeInTheDocument();
  });

  it("shows a waiting message when the account is not in a campaign yet", () => {
    render(<DashboardHome {...baseProps} campaignStatus={null} />);
    expect(
      screen.getByText(
        "Sua conta ainda não está na campanha. Você entra automaticamente assim que o administrador adicionar sua conta.",
      ),
    ).toBeInTheDocument();
  });

  it("nudges the influencer when their link is missing from the bio", () => {
    render(<DashboardHome {...baseProps} bioLinkMissing />);
    expect(screen.getByText("Falta seu link na bio!")).toBeInTheDocument();
    expect(screen.getByText(/campo "Site" do seu perfil/)).toBeInTheDocument();
  });

  it("hides the bio nudge when the link is already there", () => {
    render(<DashboardHome {...baseProps} bioLinkMissing={false} />);
    expect(screen.queryByText("Falta seu link na bio!")).not.toBeInTheDocument();
  });
});
