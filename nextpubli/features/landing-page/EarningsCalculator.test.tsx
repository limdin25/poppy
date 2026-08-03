import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EarningsCalculator } from "./EarningsCalculator";

describe("EarningsCalculator", () => {
  it("shows the fixed product facts", () => {
    render(<EarningsCalculator />);
    expect(screen.getByText("$108")).toBeInTheDocument();
    expect(screen.getAllByText(/43\.20 a sale/).length).toBeGreaterThan(0);
    expect(screen.getByText("2x a day")).toBeInTheDocument();
  });

  it("derives the outputs from the default sliders", () => {
    render(<EarningsCalculator />);
    // Defaults: 500 views x 60 videos x 0.1% = 30 sales; 30 x $43.20 = $1,296/mo.
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("$1,296")).toBeInTheDocument();
    expect(screen.getByText("$15,552")).toBeInTheDocument();
  });

  it("recomputes when a slider moves", () => {
    render(<EarningsCalculator />);
    const views = screen.getByLabelText(/Average views per video/);
    fireEvent.change(views, { target: { value: "1000" } });
    // 1,000 views x 60 x 0.1% = 60 sales; 60 x $43.20 = $2,592/mo.
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("$2,592")).toBeInTheDocument();
  });
});
