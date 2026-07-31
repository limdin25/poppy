import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SidebarNav } from "./SidebarNav";

describe("SidebarNav", () => {
  it("renders all influencer menu items", () => {
    render(<SidebarNav variant="influencer" />);
    expect(screen.getByText("Início")).toBeInTheDocument();
    expect(screen.getByText("Calendário")).toBeInTheDocument();
    expect(screen.getByText("Vendas")).toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });

  it("hides Métricas while Instagram is disabled (NEXT_PUBLIC_INSTAGRAM_ENABLED unset)", () => {
    render(<SidebarNav variant="influencer" />);
    expect(screen.queryByText("Métricas")).not.toBeInTheDocument();
  });

  it("renders all admin menu items", () => {
    render(<SidebarNav variant="admin" />);
    expect(screen.getByText("Visão Geral")).toBeInTheDocument();
    expect(screen.getByText("Influenciadores")).toBeInTheDocument();
    expect(screen.getByText("Campanha")).toBeInTheDocument();
    expect(screen.getByText("Notificações")).toBeInTheDocument();
    expect(screen.getByText("Agendador")).toBeInTheDocument();
    expect(screen.getByText("Mensagens")).toBeInTheDocument();
    expect(screen.getByText("Marcas")).toBeInTheDocument();
    expect(screen.getByText("Hotmart")).toBeInTheDocument();
  });

  it("shows the unread badge on Notificações when there are unread notifications", () => {
    render(<SidebarNav variant="admin" notificationCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the badge when everything is read", () => {
    render(<SidebarNav variant="admin" notificationCount={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
