import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/actions/auth", () => ({
  signIn: vi.fn(),
}));

import { PasswordLoginForm } from "./PasswordLoginForm";

describe("PasswordLoginForm", () => {
  it("renders email + password fields and a submit button", () => {
    render(<PasswordLoginForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });
});
