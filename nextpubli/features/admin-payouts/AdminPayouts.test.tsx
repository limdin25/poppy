import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdminPayouts } from "./AdminPayouts";
import type { Payout } from "@/types/database";

vi.mock("@/lib/actions/admin", () => ({
  markPayoutPaid: vi.fn(),
  cancelPayout: vi.fn(),
}));

const pending: (Payout & { name: string })[] = [
  {
    id: "p1",
    profile_id: "u1",
    commission_amount: 120,
    sales_count: 3,
    status: "requested",
    pix_key: "ana@email.com",
    pix_key_type: "email",
    requested_at: "2026-06-01T00:00:00Z",
    paid_at: null,
    paid_by: null,
    name: "Ana Silva",
  },
];

describe("AdminPayouts", () => {
  it("lists a pending request with a mark-as-paid button", () => {
    render(<AdminPayouts pending={pending} history={[]} />);
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(screen.getByText("ana@email.com", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar como pago/ })).toBeInTheDocument();
  });

  it("shows an empty state when there are no requests", () => {
    render(<AdminPayouts pending={[]} history={[]} />);
    expect(screen.getByText(/Nenhum pagamento pendente/)).toBeInTheDocument();
  });
});
