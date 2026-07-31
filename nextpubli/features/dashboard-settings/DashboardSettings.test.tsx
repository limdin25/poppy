import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardSettings } from "./DashboardSettings";
import { MOCK_INFLUENCER } from "@/mocks/profiles.mock";
import { SECTORS } from "@/mocks/sectors.mock";

describe("DashboardSettings", () => {
  it("renders settings heading", () => {
    render(
      <DashboardSettings
        profile={MOCK_INFLUENCER}
        sectors={SECTORS}
        selectedSectors={[]}
        instagramConnected={true}
        instagramUsername="@anasilva"
      />,
    );
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });

  it("shows personal data section", () => {
    render(
      <DashboardSettings
        profile={MOCK_INFLUENCER}
        sectors={SECTORS}
        selectedSectors={[]}
        instagramConnected={true}
        instagramUsername="@anasilva"
      />,
    );
    expect(screen.getByText("Dados pessoais")).toBeInTheDocument();
  });
});
