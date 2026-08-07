import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminOverview } from "./AdminOverview";

const MOCK_STATS = {
  totalInfluencers: 25,
  connectedInfluencers: 18,
  pendingInfluencers: 7,
  postsToday: 3,
  postsThisWeek: 14,
};

const MOCK_ALERTS = [
  {
    id: "1",
    type: "warning" as const,
    message: "3 creators without Instagram connected",
  },
  { id: "2", type: "error" as const, message: "Token expired: @maria_fit" },
];

describe("AdminOverview", () => {
  it("renders overview heading", () => {
    render(<AdminOverview stats={MOCK_STATS} alerts={[]} />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("shows influencer count", () => {
    render(<AdminOverview stats={MOCK_STATS} alerts={[]} />);
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("shows alerts when present", () => {
    render(<AdminOverview stats={MOCK_STATS} alerts={MOCK_ALERTS} />);
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(
      screen.getByText("3 creators without Instagram connected"),
    ).toBeInTheDocument();
  });
});
