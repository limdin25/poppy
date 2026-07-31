"use client";

import { DollarSign, TrendingUp, ShoppingCart } from "lucide-react";
import type { HotmartSale } from "@/types/database";

interface InfluencerSales {
  profileId: string;
  name: string;
  totalSales: number;
  totalCommission: number;
}

interface AdminHotmartProps {
  sales: HotmartSale[];
  byInfluencer: InfluencerSales[];
  totalRevenue: number;
  totalCommission: number;
}

export function AdminHotmart({
  sales,
  byInfluencer,
  totalRevenue,
  totalCommission,
}: AdminHotmartProps) {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Hotmart</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <ShoppingCart size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-foreground-secondary">Total de vendas</p>
              <p className="text-2xl font-bold">{sales.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <DollarSign size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-foreground-secondary">Receita total</p>
              <p className="text-2xl font-bold">
                R$ {totalRevenue.toFixed(2).replace(".", ",")}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <TrendingUp size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-foreground-secondary">Comissão total</p>
              <p className="text-2xl font-bold">
                R$ {totalCommission.toFixed(2).replace(".", ",")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold">Vendas por influenciador</h2>
        {byInfluencer.length === 0 ? (
          <p className="text-foreground-secondary">Nenhuma venda registrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium text-foreground-secondary">
                    Influenciador
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-foreground-secondary">
                    Vendas
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-foreground-secondary">
                    Comissão
                  </th>
                </tr>
              </thead>
              <tbody>
                {byInfluencer.map((row) => (
                  <tr
                    key={row.profileId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    <td className="px-4 py-2">{row.totalSales}</td>
                    <td className="px-4 py-2">
                      R$ {row.totalCommission.toFixed(2).replace(".", ",")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold">Últimas vendas</h2>
        {sales.length === 0 ? (
          <p className="text-foreground-secondary">Nenhuma venda ainda.</p>
        ) : (
          <div className="space-y-2">
            {sales.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center justify-between rounded-lg bg-background-secondary px-4 py-3 text-sm"
              >
                <div>
                  <span className="font-medium">
                    R$ {sale.sale_amount.toFixed(2).replace(".", ",")}
                  </span>
                  <span className="ml-2 text-foreground-secondary">
                    {new Date(sale.sold_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    sale.status === "confirmed"
                      ? "bg-success/10 text-success"
                      : sale.status === "refunded"
                        ? "bg-warning/10 text-warning"
                        : "bg-error/10 text-error"
                  }`}
                >
                  {sale.status === "confirmed"
                    ? "Confirmada"
                    : sale.status === "refunded"
                      ? "Reembolsada"
                      : "Cancelada"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
