import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { IgLoginButton } from "./IgLoginButton";

describe("IgLoginButton", () => {
  it("links to the Instagram login start route", () => {
    render(<IgLoginButton />);
    const link = screen.getByRole("link", { name: /entrar com instagram/i });
    expect(link).toHaveAttribute("href", "/api/auth/instagram/start");
  });

  it("renders a custom label", () => {
    render(<IgLoginButton label="Criar conta com Instagram" />);
    expect(
      screen.getByRole("link", { name: /criar conta com instagram/i }),
    ).toBeInTheDocument();
  });
});
