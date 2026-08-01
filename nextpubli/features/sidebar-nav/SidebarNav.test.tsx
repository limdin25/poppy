import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SidebarNav } from "./SidebarNav";

describe("SidebarNav", () => {
  it("renders all influencer menu items", () => {
    render(<SidebarNav variant="influencer" />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("hides Metrics while Instagram is disabled (NEXT_PUBLIC_INSTAGRAM_ENABLED unset)", () => {
    render(<SidebarNav variant="influencer" />);
    expect(screen.queryByText("Metrics")).not.toBeInTheDocument();
  });

  it("renders all admin menu items", () => {
    render(<SidebarNav variant="admin" />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Influencers")).toBeInTheDocument();
    expect(screen.getByText("Campaign")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Brands")).toBeInTheDocument();
    expect(screen.getByText("Hotmart")).toBeInTheDocument();
  });

  it("shows the unread badge on Notifications when there are unread notifications", () => {
    render(<SidebarNav variant="admin" notificationCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the badge when everything is read", () => {
    render(<SidebarNav variant="admin" notificationCount={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
