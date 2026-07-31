import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdminNotifications } from "./AdminNotifications";
import { mockNotifications } from "./mock";

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationRead: vi.fn().mockResolvedValue({ success: true }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ success: true }),
}));

describe("AdminNotifications", () => {
  it("renders a notification with title, body and São Paulo timestamp", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(screen.getByText("Nova conta conectada: @ana.silva")).toBeInTheDocument();
    expect(
      screen.getByText("Ana Silva conectou o Instagram e ainda não está na campanha."),
    ).toBeInTheDocument();
    // created_at 2026-06-12T20:00:00.000Z → 17:00 in São Paulo
    expect(screen.getByText("12/06/2026, 17:00")).toBeInTheDocument();
  });

  it("marks unread notifications with a 'Não lida' badge", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    // mock has 2 unread rows (n1, n3)
    expect(screen.getAllByText("Não lida")).toHaveLength(2);
  });

  it("filter 'Não lidas' hides read notifications", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(screen.getByText("Aviso do sistema")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar notificações" }), {
      target: { value: "unread" },
    });

    expect(screen.queryByText("Aviso do sistema")).not.toBeInTheDocument();
    expect(screen.getByText("Nova conta conectada: @ana.silva")).toBeInTheDocument();
    expect(screen.getByText("Relatório semanal disponível")).toBeInTheDocument();
  });

  it("shows 'Marcar todas como lidas' when there are unread notifications", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(
      screen.getByRole("button", { name: "Marcar todas como lidas" }),
    ).toBeInTheDocument();
  });

  it("hides 'Marcar todas como lidas' when everything is read", () => {
    const allRead = mockNotifications.map((n) => ({
      ...n,
      read_at: "2026-06-12T21:00:00.000Z",
    }));
    render(<AdminNotifications notifications={allRead} />);
    expect(
      screen.queryByRole("button", { name: "Marcar todas como lidas" }),
    ).not.toBeInTheDocument();
  });

  it("shows a per-row 'Marcar como lida' button for unread rows", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    expect(screen.getAllByRole("button", { name: "Marcar como lida" })).toHaveLength(2);
  });

  it("links account_connected notifications to /admin/campanha", () => {
    render(<AdminNotifications notifications={mockNotifications} />);
    const links = screen.getAllByRole("link", { name: "Adicionar à campanha" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/admin/campanha");
  });

  it("shows the empty state when there are no notifications", () => {
    render(<AdminNotifications notifications={[]} />);
    expect(screen.getByText("Nenhuma notificação.")).toBeInTheDocument();
  });
});
