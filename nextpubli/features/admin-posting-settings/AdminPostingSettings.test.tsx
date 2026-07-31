import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminPostingSettings } from "./AdminPostingSettings";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  } as Response);
});

describe("AdminPostingSettings", () => {
  it("renders provider radio buttons", () => {
    render(<AdminPostingSettings settings={null} />);

    expect(screen.getByLabelText(/NextPubli/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Outstand/)).toBeInTheDocument();
  });

  it("defaults to heypubli provider", () => {
    render(<AdminPostingSettings settings={null} />);

    const radio = screen.getByLabelText(/NextPubli/) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it("shows existing settings when provided", () => {
    render(
      <AdminPostingSettings
        settings={{
          active_provider: "outstand",
          outstand_social_network_id: "net_abc",
          hasApiKey: true,
          default_timezone: "America/Sao_Paulo",
        }}
      />,
    );

    const outstandRadio = screen.getByLabelText(/Outstand/) as HTMLInputElement;
    expect(outstandRadio.checked).toBe(true);
  });

  it("shows Outstand fields when outstand is selected", () => {
    render(
      <AdminPostingSettings
        settings={{
          active_provider: "outstand",
          outstand_social_network_id: "net_abc",
          hasApiKey: true,
          default_timezone: "America/Sao_Paulo",
        }}
      />,
    );

    expect(screen.getByLabelText(/API Key/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Social Network ID/)).toBeInTheDocument();
  });

  it("hides Outstand fields when heypubli is selected", () => {
    render(<AdminPostingSettings settings={null} />);

    expect(screen.queryByLabelText(/API Key/)).not.toBeInTheDocument();
  });

  it("calls save endpoint on submit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    render(<AdminPostingSettings settings={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Salvar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/admin/posting-settings",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows success feedback after save", async () => {
    render(<AdminPostingSettings settings={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Salvar/i }));

    await waitFor(() => {
      expect(screen.getByText(/Salvo!/)).toBeInTheDocument();
    });
  });
});
