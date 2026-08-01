import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardCalendar } from "./DashboardCalendar";

describe("DashboardCalendar", () => {
  it("renders calendar heading", () => {
    render(<DashboardCalendar posts={[]} />);
    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });

  it("renders legend items", () => {
    render(<DashboardCalendar posts={[]} />);
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
