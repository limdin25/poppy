import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/actions/auth", () => ({
  verifyLoginCode: vi.fn(),
}));

import { CodeLoginForm } from "./CodeLoginForm";

describe("CodeLoginForm", () => {
  it("renders email + 6-digit code fields and a submit button", () => {
    render(<CodeLoginForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText(/código de 8 dígitos/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /entrar com código/i }),
    ).toBeInTheDocument();
  });

  it("prefills the email when provided", () => {
    render(<CodeLoginForm email="ana@email.com" />);
    expect(screen.getByLabelText("Email")).toHaveValue("ana@email.com");
  });
});
