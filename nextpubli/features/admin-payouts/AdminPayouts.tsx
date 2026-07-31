"use client";

import { useTransition } from "react";
import { Wallet, Check, X, Clock } from "lucide-react";
import { markPayoutPaid, cancelPayout } from "@/lib/actions/admin";
import type { Payout } from "@/types/database";

type Pending = Payout & { name: string };

function brl(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent/10 p-2">
          <Icon size={20} className="text-accent" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-foreground-secondary sm:text-sm">{label}</p>
          <p className="text-xl font-bold sm:text-2xl">{value}</p>
        </div>
      </div>
    </div>
  );
}

function PendingRow({ p }: { p: Pending }) {
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<unknown>) => startTransition(() => void fn());

  return (
    <tr className="border-b border-border">
      <td className="py-3 pr-4 font-medium">{p.name}</td>
      <td className="py-3 pr-4 text-foreground-secondary">
        {p.pix_key_type ? `${p.pix_key_type.toUpperCase()}: ` : ""}
        {p.pix_key ?? "—"}
      </td>
      <td className="py-3 pr-4 font-semibold">{brl(p.commission_amount)}</td>
      <td className="py-3 pr-4 text-foreground-secondary">{p.sales_count}</td>
      <td className="py-3 pr-4 text-foreground-secondary">{fmtDate(p.requested_at)}</td>
      <td className="py-3 text-right">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markPayoutPaid(p.id))}
            className="inline-flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50"
          >
            <Check size={14} /> Marcar como pago
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => cancelPayout(p.id))}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:bg-background-secondary disabled:opacity-50"
          >
            <X size={14} /> Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}

export function AdminPayouts({
  pending,
  history,
}: {
  pending: Pending[];
  history: Payout[];
}) {
  const totalPending = pending.reduce((s, p) => s + p.commission_amount, 0);
  const paidThisMonth = history
    .filter((p) => {
      if (!p.paid_at) return false;
      const d = new Date(p.paid_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, p) => s + p.commission_amount, 0);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Pagamentos</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Solicitações de saque dos influenciadores (PIX)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard icon={Wallet} label="Total pendente" value={brl(totalPending)} />
        <StatCard icon={Clock} label="Solicitações" value={pending.length} />
        <StatCard icon={Check} label="Pago no mês" value={brl(paidThisMonth)} />
      </div>

      <section className="rounded-xl border border-border p-4 sm:p-5">
        <h2 className="mb-4 text-base font-semibold">Pendentes</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-foreground-secondary">
            Nenhum pagamento pendente no momento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-secondary">
                  <th className="pb-2 pr-4 font-medium">Influenciador</th>
                  <th className="pb-2 pr-4 font-medium">Chave PIX</th>
                  <th className="pb-2 pr-4 font-medium">Valor</th>
                  <th className="pb-2 pr-4 font-medium">Vendas</th>
                  <th className="pb-2 pr-4 font-medium">Solicitado</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <PendingRow key={p.id} p={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border p-4 sm:p-5">
        <h2 className="mb-4 text-base font-semibold">Histórico</h2>
        {history.length === 0 ? (
          <p className="text-sm text-foreground-secondary">Nenhum pagamento ainda.</p>
        ) : (
          <div className="space-y-2">
            {history.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
              >
                <span className="text-foreground-secondary">
                  {p.paid_at ? fmtDate(p.paid_at) : fmtDate(p.requested_at)}
                </span>
                <span className="flex items-center gap-2 font-medium">
                  {brl(p.commission_amount)}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.status === "paid"
                        ? "bg-success/10 text-success"
                        : "bg-foreground-secondary/10 text-foreground-secondary"
                    }`}
                  >
                    {p.status === "paid" ? "Pago" : "Cancelado"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
