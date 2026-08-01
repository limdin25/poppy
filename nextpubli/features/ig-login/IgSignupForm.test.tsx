import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { IgSignupForm } from "./IgSignupForm";

describe("IgSignupForm", () => {
  it("collects name, surname, email and WhatsApp, and posts to the Instagram start route", () => {
    const { container } = render(<IgSignupForm />);
    expect(screen.getByLabelText("First name")).toBeInTheDocument();
    expect(screen.getByLabelText("Last name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(container.querySelector('input[type="tel"]')).toBeTruthy();

    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toMatch(/post/i);
    expect(form.getAttribute("action")).toBe("/api/auth/instagram/start");
  });

  it("keeps the submit disabled until the terms are accepted", () => {
    render(<IgSignupForm />);
    expect(
      screen.getByRole("button", { name: /sign up with instagram/i }),
    ).toBeDisabled();
  });

  it("opens the Terms in a popup", () => {
    render(<IgSignupForm />);
    fireEvent.click(screen.getByRole("button", { name: /terms of use/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/stories/i);
  });
});
