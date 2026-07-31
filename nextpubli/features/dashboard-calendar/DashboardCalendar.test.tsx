import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardCalendar } from "./DashboardCalendar";

describe("DashboardCalendar", () => {
  it("renders calendar heading", () => {
    render(<DashboardCalendar posts={[]} />);
    expect(screen.getByText("Calendário")).toBeInTheDocument();
  });

  it("renders legend items", () => {
    render(<DashboardCalendar posts={[]} />);
    expect(screen.getByText("Publicado")).toBeInTheDocument();
    expect(screen.getByText("Agendado")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });
});
