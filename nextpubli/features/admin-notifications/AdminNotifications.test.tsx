import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdminNotifications } from "./AdminNotifications";
import { mockNotifications } from "./mock";

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationRead: vi.fn().mockResolvedValue({ success: true }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ success: true }),
}));

describe("AdminNotifications", () => {
  it("renders a notification with title, body and Sao Paulo timestamp", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(screen.getByText("New account connected: @ana.silva")).toBeInTheDocument();
    expect(
      screen.getByText("Ana Silva connected Instagram and is not in the campaign yet."),
    ).toBeInTheDocument();
    // created_at 2026-06-12T20:00:00.000Z is 17:00 in Sao Paulo
    expect(screen.getByText("12/06/2026, 17:00")).toBeInTheDocument();
  });

  it("marks unread notifications with an 'Unread' badge", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    // mock has 2 unread rows (n1, n3)
    expect(screen.getAllByText("Unread")).toHaveLength(2);
  });

  it("filter 'Unread only' hides read notifications", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(screen.getByText("System notice")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter notifications" }), {
      target: { value: "unread" },
    });

    expect(screen.queryByText("System notice")).not.toBeInTheDocument();
    expect(screen.getByText("New account connected: @ana.silva")).toBeInTheDocument();
    expect(screen.getByText("Weekly report available")).toBeInTheDocument();
  });

  it("shows 'Mark all as read' when there are unread notifications", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(
      screen.getByRole("button", { name: "Mark all as read" }),
    ).toBeInTheDocument();
  });

  it("hides 'Mark all as read' when everything is read", () => {
    const allRead = mockNotifications.map((n) => ({
      ...n,
      read_at: "2026-06-12T21:00:00.000Z",
    }));
    render(<AdminNotifications notifications={allRead} />);
    expect(
      screen.queryByRole("button", { name: "Mark all as read" }),
    ).not.toBeInTheDocument();
  });

  it("shows a per-row 'Mark as read' button for unread rows", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(screen.getAllByRole("button", { name: "Mark as read" })).toHaveLength(2);
  });

  it("links account_connected notifications to /admin/campaign", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    const links = screen.getAllByRole("link", { name: "Add to campaign" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/admin/campaign");
  });

  it("shows the empty state when there are no notifications", () => {
    render(<AdminNotifications notifications={[]} />);
    expect(screen.getByText("No notifications.")).toBeInTheDocument();
  });
});
