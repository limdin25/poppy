import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { IgSignupForm } from "./IgSignupForm";

const DEFAULTS = {
  first_name: "Maria",
  last_name: "Silva",
  email: "maria@gmail.com",
  whatsapp: "+5511999998888",
};

function fillName() {
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: "Maria" },
  });
  fireEvent.change(screen.getByLabelText("Last name"), {
    target: { value: "Silva" },
  });
}

/** Walk the three form screens with valid answers and land on the connect screen. */
function completeForm() {
  fillName();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "maria@gmail.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  const tel = document.querySelector('input[type="tel"]') as HTMLInputElement;
  fireEvent.change(tel, { target: { value: "+55 11 99999 8888" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("IgSignupForm", () => {
  it("posts to the Instagram start route", () => {
    const { container } = render(<IgSignupForm />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toMatch(/post/i);
    expect(form.getAttribute("action")).toBe("/api/auth/instagram/start");
  });

  it("opens on the name question only, one question per screen", () => {
    render(<IgSignupForm />);
    expect(screen.getByRole("heading", { name: /what is your name/i })).toBeVisible();
    expect(screen.getByLabelText("First name")).toBeVisible();
    expect(screen.getByLabelText("Last name")).toBeVisible();
    expect(screen.getByLabelText("Email")).not.toBeVisible();
  });

  it("refuses to advance past an unanswered question", () => {
    render(<IgSignupForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/first and last name/i);
    expect(screen.getByRole("heading", { name: /what is your name/i })).toBeVisible();
  });

  it("rejects an email that is not an email", () => {
    render(<IgSignupForm />);
    fillName();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "maria" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
  });

  it("refuses a mobile number that is too short to be real", () => {
    render(<IgSignupForm />);
    fillName();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "maria@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/full mobile number/i);
  });

  it("walks name to email to mobile, and calls the phone field Mobile, never WhatsApp", () => {
    render(<IgSignupForm />);
    fillName();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: /what is your email/i })).toBeVisible();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "maria@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: /what is your mobile number/i }),
    ).toBeVisible();
    expect(screen.getByText("Mobile number")).toBeVisible();
    expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="tel"]')).toBeTruthy();
  });

  it("Enter advances a step instead of submitting a half-empty form", () => {
    render(<IgSignupForm />);
    fillName();
    fireEvent.keyDown(screen.getByLabelText("Last name"), { key: "Enter" });
    expect(screen.getByRole("heading", { name: /what is your email/i })).toBeVisible();
  });

  it("goes back without losing what was typed", () => {
    render(<IgSignupForm />);
    fillName();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText("First name")).toHaveValue("Maria");
  });

  it("shows the three step journey on the connect screen", () => {
    render(<IgSignupForm />);
    completeForm();
    expect(
      screen.getByRole("heading", { name: /now connect your instagram/i }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: /connect your account/i })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /we post viral content that sells/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /you earn cash and affiliate commission/i }),
    ).toBeVisible();
  });

  // The regression that would silently break signup: if a step unmounted when it left
  // the screen, its value would never reach the POST body and the Instagram callback
  // could not build the account.
  it("still carries every answer in the form when the connect screen is showing", () => {
    const { container } = render(<IgSignupForm />);
    completeForm();
    const form = container.querySelector("form")!;
    const value = (name: string) =>
      form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
    expect(value("first_name")).toBe("Maria");
    expect(value("last_name")).toBe("Silva");
    expect(value("email")).toBe("maria@gmail.com");
    expect(value("whatsapp")?.replace(/\D/g, "")).toBe("5511999998888");
  });

  // Listens on `document`, which is OUTSIDE React's root container, so it runs after
  // React's onSubmit and can see whether that handler cancelled the navigation. A
  // listener on the form itself runs first and always reports "submitted".
  function watchSubmit() {
    const seen = { fired: false, prevented: false };
    const onSubmit = (e: Event) => {
      seen.fired = true;
      seen.prevented = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener("submit", onSubmit);
    return { seen, stop: () => document.removeEventListener("submit", onSubmit) };
  }

  // A greyed-out button answers a phone tap with nothing at all, so the button always
  // takes the tap and the form refuses the submit instead.
  it("refuses to submit without the terms, and says which box is missing", () => {
    render(<IgSignupForm />);
    completeForm();
    const connect = screen.getByRole("button", { name: /connect instagram/i });
    expect(connect).toBeEnabled();

    const { seen, stop } = watchSubmit();
    fireEvent.click(connect);
    stop();

    expect(seen.prevented).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(/tick the box/i);
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("lets the submit through once the terms are accepted", () => {
    render(<IgSignupForm />);
    completeForm();
    fireEvent.click(screen.getByRole("checkbox"));

    const { seen, stop } = watchSubmit();
    fireEvent.click(screen.getByRole("button", { name: /connect instagram/i }));
    stop();

    expect(seen.fired).toBe(true);
    expect(seen.prevented).toBe(false);
    expect(screen.queryByText(/tick the box/i)).not.toBeInTheDocument();
  });

  it("opens the Terms in a popup", () => {
    render(<IgSignupForm />);
    completeForm();
    fireEvent.click(screen.getByRole("button", { name: /terms of use/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/stories/i);
  });

  // Someone who bounced out of Instagram has already answered everything, so making
  // them retype three screens is how you lose them for good.
  it("drops a returning signup straight back on the connect screen", () => {
    render(<IgSignupForm defaults={DEFAULTS} />);
    expect(
      screen.getByRole("heading", { name: /now connect your instagram/i }),
    ).toBeVisible();
    expect(screen.getByText(/Maria Silva/)).toBeVisible();
  });

  it("lets a returning signup edit a typo", () => {
    render(<IgSignupForm defaults={DEFAULTS} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByLabelText("First name")).toHaveValue("Maria");
    expect(screen.getByRole("heading", { name: /what is your name/i })).toBeVisible();
  });
});
