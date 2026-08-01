import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminMessages } from "./AdminMessages";

describe("AdminMessages", () => {
  it("renders heading", () => {
    render(<AdminMessages conversations={[]} channels={[]} />);
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });

  it("shows connect button when no WhatsApp channel", () => {
    render(<AdminMessages conversations={[]} channels={[]} />);
    expect(screen.getByText("Connect")).toBeInTheDocument();
  });

  it("shows empty state when no conversations", () => {
    render(<AdminMessages conversations={[]} channels={[]} />);
    expect(screen.getByText("No conversations")).toBeInTheDocument();
  });
});
