import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminImpersonate } from "./AdminImpersonate";
import { MOCK_INFLUENCER } from "@/mocks/profiles.mock";

describe("AdminImpersonate", () => {
  it("renders impersonation banner", () => {
    render(
      <AdminImpersonate adminName="Hugo Admin" impersonatedProfile={MOCK_INFLUENCER}>
        <div>Dashboard content</div>
      </AdminImpersonate>,
    );
    expect(screen.getByText("Voltar ao Admin")).toBeInTheDocument();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <AdminImpersonate adminName="Hugo Admin" impersonatedProfile={MOCK_INFLUENCER}>
        <div>Dashboard content</div>
      </AdminImpersonate>,
    );
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });
});
