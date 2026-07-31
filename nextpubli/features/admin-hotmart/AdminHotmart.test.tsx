import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminHotmart } from "./AdminHotmart";

describe("AdminHotmart", () => {
  it("renders heading", () => {
    render(
      <AdminHotmart sales={[]} byInfluencer={[]} totalRevenue={0} totalCommission={0} />,
    );
    expect(screen.getByText("Hotmart")).toBeInTheDocument();
  });

  it("shows revenue stats", () => {
    render(
      <AdminHotmart
        sales={[]}
        byInfluencer={[]}
        totalRevenue={1500}
        totalCommission={450}
      />,
    );
    expect(screen.getByText("R$ 1500,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 450,00")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(
      <AdminHotmart sales={[]} byInfluencer={[]} totalRevenue={0} totalCommission={0} />,
    );
    expect(screen.getByText("Nenhuma venda registrada.")).toBeInTheDocument();
  });
});
