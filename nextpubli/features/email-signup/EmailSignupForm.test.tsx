import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { EmailSignupForm } from "./EmailSignupForm";
import { SignupCodeForm } from "./SignupCodeForm";

vi.mock("@/lib/actions/auth", () => ({
  sendSignupCode: vi.fn(),
  verifySignupCode: vi.fn(),
}));

describe("EmailSignupForm", () => {
  it("renders name, surname, email and WhatsApp fields", () => {
    render(<EmailSignupForm />);
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByLabelText("Sobrenome")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  it("never mentions Instagram", () => {
    render(<EmailSignupForm />);
    expect(screen.queryByText(/instagram/i)).not.toBeInTheDocument();
  });

  it("keeps the submit button disabled until terms are accepted", async () => {
    render(<EmailSignupForm />);
    const button = screen.getByRole("button", { name: /criar minha conta/i });
    expect(button).toBeDisabled();
    // Terms alone are not enough — WhatsApp must have >= 12 digits too.
    await userEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeDisabled();
  });

  it("links to the terms page", () => {
    render(<EmailSignupForm />);
    expect(screen.getByRole("link", { name: /termos de uso/i })).toHaveAttribute(
      "href",
      "/termos",
    );
  });
});

describe("SignupCodeForm", () => {
  it("renders the 8-digit code input bound to the signup email", () => {
    render(<SignupCodeForm email="maria@example.com" />);
    expect(screen.getByLabelText("Código de 8 dígitos")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirmar e criar conta/i }),
    ).toBeInTheDocument();
  });
});
