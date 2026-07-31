import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContactCaptureForm } from "./ContactCaptureForm";

describe("ContactCaptureForm", () => {
  it("renders email, an international WhatsApp field, and a submit button", () => {
    const { container } = render(<ContactCaptureForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    // react-international-phone renders a country selector + a tel input.
    expect(container.querySelector('input[type="tel"]')).toBeTruthy();
    expect(container.querySelector('input[name="whatsapp"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /continuar/i })).toBeInTheDocument();
  });

  it("defaults the country code to Brazil (+55)", () => {
    const { container } = render(<ContactCaptureForm />);
    const tel = container.querySelector('input[type="tel"]') as HTMLInputElement;
    expect(tel.value).toContain("+55");
  });
});
