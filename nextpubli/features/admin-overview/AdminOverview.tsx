"use client";

import { Users, FileText, ShoppingCart, AlertTriangle } from "lucide-react";

interface OverviewStats {
  totalInfluencers: number;
  connectedInfluencers: number;
  pendingInfluencers: number;
  postsToday: number;
  postsThisWeek: number;
  totalSales: number;
}

interface Alert {
  id: string;
  type: "warning" | "error";
  message: string;
}

interface AdminOverviewProps {
  stats: OverviewStats;
  alerts: Alert[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent/10 p-2">
          <Icon size={20} className="text-accent" />
        </div>
        <div>
          <p className="text-sm text-foreground-secondary">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-foreground-secondary">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

export function AdminOverview({ stats, alerts }: AdminOverviewProps) {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Visão Geral</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Users}
          label="Total de influenciadores"
          value={stats.totalInfluencers}
          sub={`${stats.connectedInfluencers} conectados · ${stats.pendingInfluencers} pendentes`}
        />
        <StatCard
          icon={FileText}
          label="Posts publicados"
          value={stats.postsToday}
          sub={`${stats.postsThisWeek} esta semana`}
        />
        <StatCard icon={ShoppingCart} label="Vendas Hotmart" value={stats.totalSales} />
      </div>

      {alerts.length > 0 && (
        <div className="rounded-xl border border-warning/30 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle size={20} className="text-warning" />
            Alertas
          </h2>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg px-4 py-2 text-sm ${
                  alert.type === "error"
                    ? "bg-error/10 text-error"
                    : "bg-warning/10 text-warning"
                }`}
              >
                {alert.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
