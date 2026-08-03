import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminLeads } from "./AdminLeads";
import type { SignupLead } from "@/types/database";

function lead(over: Partial<SignupLead> = {}): SignupLead {
  return {
    id: "l1",
    first_name: "Maria",
    last_name: "Silva",
    email: "maria@gmail.com",
    whatsapp: "+5511999998888",
    email_normalized: "maria@gmail.com",
    status: "started",
    profile_id: null,
    attempts: 1,
    first_seen_at: "2026-08-03T10:00:00Z",
    last_seen_at: "2026-08-03T10:00:00Z",
    sent_to_instagram_at: null,
    connected_at: null,
    created_at: "2026-08-03T10:00:00Z",
    ...over,
  };
}

describe("AdminLeads", () => {
  it("explains itself when nobody has signed up yet", () => {
    render(<AdminLeads leads={[]} />);
    expect(screen.getByText(/no signups yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the person, their contact details and how far they got", () => {
    render(<AdminLeads leads={[lead()]} />);
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("maria@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("+5511999998888")).toBeInTheDocument();
    expect(screen.getByText(/never pressed connect instagram/i)).toBeInTheDocument();
  });

  // The whole reason the table exists: someone who answered the questions and never
  // finished Instagram must be visible and countable.
  it("counts anyone without a connected stamp as not connected yet", () => {
    render(
      <AdminLeads
        leads={[
          lead({ id: "a" }),
          lead({
            id: "b",
            email: "jo@gmail.com",
            status: "sent_to_instagram",
            sent_to_instagram_at: "2026-08-03T11:00:00Z",
          }),
          lead({
            id: "c",
            email: "sam@gmail.com",
            status: "connected",
            sent_to_instagram_at: "2026-08-03T11:00:00Z",
            connected_at: "2026-08-03T11:01:00Z",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("stat-total")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-sent")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-connected")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-lost")).toHaveTextContent("2");
  });

  it("filters to just the people who never got past the questions", () => {
    render(
      <AdminLeads
        leads={[
          lead({ id: "a", first_name: "Maria" }),
          lead({
            id: "c",
            first_name: "Sam",
            email: "sam@gmail.com",
            status: "connected",
            connected_at: "2026-08-03T11:01:00Z",
          }),
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Filter by stage"), {
      target: { value: "started" },
    });
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.queryByText("Sam Silva")).not.toBeInTheDocument();
  });

  it("searches by email as well as name", () => {
    render(
      <AdminLeads
        leads={[
          lead({ id: "a", first_name: "Maria" }),
          lead({ id: "b", first_name: "Jo", email: "jo@outlook.com" }),
        ]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: "outlook" },
    });
    expect(screen.getByText("Jo Silva")).toBeInTheDocument();
    expect(screen.queryByText("Maria Silva")).not.toBeInTheDocument();
  });

  it("offers a one-tap WhatsApp chase on the number they gave", () => {
    render(<AdminLeads leads={[lead()]} />);
    const wa = screen.getByRole("link", { name: /\+5511999998888/ });
    expect(wa).toHaveAttribute("href", expect.stringContaining("wa.me/5511999998888"));
  });
});
