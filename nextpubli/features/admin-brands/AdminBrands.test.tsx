import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminBrands } from "./AdminBrands";
import { BRANDS } from "@/mocks/brands.mock";

const MOCK_BRAND_ROWS = [{ brand: BRANDS[0], influencerCount: 8 }];

describe("AdminBrands", () => {
  it("renders heading", () => {
    render(<AdminBrands brands={MOCK_BRAND_ROWS} />);
    expect(screen.getByText("Marcas")).toBeInTheDocument();
  });

  it("shows brand name", () => {
    render(<AdminBrands brands={MOCK_BRAND_ROWS} />);
    expect(screen.getByText("ScanPlates")).toBeInTheDocument();
  });

  it("shows add button", () => {
    render(<AdminBrands brands={MOCK_BRAND_ROWS} />);
    expect(screen.getByText("Nova marca")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(<AdminBrands brands={[]} />);
    expect(screen.getByText("Nenhuma marca cadastrada ainda.")).toBeInTheDocument();
  });
});
