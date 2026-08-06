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
    expect(screen.getByLabelText("First name")).toBeInTheDocument();
    expect(screen.getByLabelText("Last name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  it("never mentions Instagram", () => {
    render(<EmailSignupForm />);
    expect(screen.queryByText(/instagram/i)).not.toBeInTheDocument();
  });

  it("keeps the submit button disabled until terms are accepted", async () => {
    render(<EmailSignupForm />);
    const button = screen.getByRole("button", { name: /create my account/i });
    expect(button).toBeDisabled();
    // Terms alone are not enough — WhatsApp must have >= 12 digits too.
    await userEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeDisabled();
  });

  it("links to the terms page", () => {
    render(<EmailSignupForm />);
    expect(screen.getByRole("link", { name: /terms of use/i })).toHaveAttribute(
      "href",
      "/terms",
    );
  });
});

describe("SignupCodeForm", () => {
  it("renders the 8-digit code input bound to the signup email", () => {
    render(<SignupCodeForm email="maria@example.com" />);
    expect(screen.getByLabelText("8-digit code")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm and create account/i }),
    ).toBeInTheDocument();
  });
});
