import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardMetrics } from "./DashboardMetrics";

describe("DashboardMetrics", () => {
  it("renders heading", () => {
    render(<DashboardMetrics profileMetrics={[]} />);
    expect(screen.getByText("Profile Metrics")).toBeInTheDocument();
  });

  it("shows connect prompt when no metrics", () => {
    render(<DashboardMetrics profileMetrics={[]} />);
    expect(screen.getByText(/Connect your Instagram/)).toBeInTheDocument();
  });
});
