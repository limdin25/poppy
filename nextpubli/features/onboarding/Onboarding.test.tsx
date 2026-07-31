import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StepIndicator } from "./StepIndicator";
import { SectorGrid } from "./SectorGrid";

describe("StepIndicator", () => {
  it("renders all 6 steps", () => {
    render(<StepIndicator currentStep={1} totalSteps={6} />);
    const steps = screen.getAllByTestId(/step-/);
    expect(steps).toHaveLength(6);
  });

  it("highlights current step", () => {
    render(<StepIndicator currentStep={3} totalSteps={6} />);
    const step3 = screen.getByTestId("step-3");
    expect(step3).toHaveAttribute("data-active", "true");
  });
});

describe("SectorGrid", () => {
  const sectors = [
    {
      id: "1",
      name: "Saúde & Bem-estar",
      slug: "saude-bem-estar",
      is_active: true,
      sort_order: 1,
    },
    {
      id: "2",
      name: "Esporte & Fitness",
      slug: "esporte-fitness",
      is_active: true,
      sort_order: 2,
    },
  ];

  it("renders all sectors", () => {
    render(<SectorGrid sectors={sectors} selected={[]} onToggle={() => {}} />);
    expect(screen.getByText("Saúde & Bem-estar")).toBeInTheDocument();
    expect(screen.getByText("Esporte & Fitness")).toBeInTheDocument();
  });

  it("shows selected state", () => {
    render(<SectorGrid sectors={sectors} selected={["1"]} onToggle={() => {}} />);
    const btn = screen.getByText("Saúde & Bem-estar").closest("button");
    expect(btn).toHaveAttribute("data-selected", "true");
  });
});
