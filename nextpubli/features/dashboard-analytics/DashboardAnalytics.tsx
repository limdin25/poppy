"use client";

import { useTransition, useState } from "react";
import { ShoppingCart, DollarSign, MousePointerClick, Clock, Wallet } from "lucide-react";
import { savePixKey } from "@/lib/actions/settings";
import { requestPayout } from "@/lib/actions/payouts";

interface MonthlySale {
  month: string;
  sales: number;
  commission: number;
}

interface PendingRelease {
  availableOn: string;
  amount: number;
  count: number;
}

interface DashboardAnalyticsProps {
  totalSales: number;
  totalCommission: number;
  monthlySales: MonthlySale[];
  lastPublishedAt: string | null;
  affiliateClicks: number;
  availableBalance: number;
  pendingReleases: PendingRelease[];
  pixKeyType: string | null;
  pixKey: string | null;
}

function brl(amount: number): string {
  return `R$ ${amount.toFixed(2).replace(".", ",")}`;
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function PendingReleasesCard({ pending }: { pending: PendingRelease[] }) {
  if (pending.length === 0) return null;
  const total = pending.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-secondary">
          Pending release (guarantee period)
        </p>
        <p className="text-lg font-bold text-warning">{brl(total)}</p>
      </div>
      <div className="mt-3 space-y-1.5">
        {pending.map((p) => (
          <div key={p.availableOn} className="flex items-center justify-between text-sm">
            <span className="text-foreground-secondary">
              Releases on{" "}
              <strong className="text-foreground">{fmtDay(p.availableOn)}</strong> -{" "}
              {p.count} sale{p.count > 1 ? "s" : ""}
            </span>
            <span className="font-medium">{brl(p.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvailableBalanceCard({ amount, hasPix }: { amount: number; hasPix: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const canRequest = amount > 0 && hasPix && !isPending;

  const request = () => {
    setResult(null);
    startTransition(async () => {
      const r = await requestPayout();
      if ("success" in r) {
        setResult({ ok: true, msg: `Payment of ${brl(r.amount)} requested! 🎉` });
      } else {
        setResult({ ok: false, msg: r.error });
      }
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm text-foreground-secondary">
            Balance available for withdrawal
          </p>
          <p className="text-2xl font-bold text-success">{brl(amount)}</p>
          {!hasPix ? (
            <p className="mt-1 text-xs text-foreground-secondary">
              Add your PIX key below so you can withdraw.
            </p>
          ) : amount <= 0 ? (
            <p className="mt-1 text-xs text-foreground-secondary">
              Your commissions become available 21 days after the sale is confirmed.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={request}
          disabled={!canRequest}
          className="shrink-0 rounded-lg bg-success px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50"
        >
          {isPending ? "Requesting..." : "Request payment"}
        </button>
      </div>
      {result && (
        <div
          className={`border-t px-5 py-3 text-sm ${
            result.ok
              ? "border-success/10 bg-success/5 text-success"
              : "border-error/10 bg-error/5 text-error"
          }`}
        >
          {result.msg}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShoppingCart;
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
          <p className="text-xs sm:text-sm text-foreground-secondary truncate">{label}</p>
          <p className="text-xl sm:text-2xl font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}

const PIX_PLACEHOLDERS: Record<string, string> = {
  cpf: "000.000.000-00",
  email: "you@email.com",
  phone: "+55 11 99999-9999",
  random: "xxxxxxxx-xxxx-xxxx-xxxx",
};

function PixCard({
  pixKeyType,
  pixKey,
}: {
  pixKeyType: string | null;
  pixKey: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [selectedType, setSelectedType] = useState(pixKeyType ?? "");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setSaved(false);
    startTransition(async () => {
      const result = await savePixKey(formData);
      if (result.success) setSaved(true);
    });
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-3 bg-accent/5 px-5 py-4 border-b border-accent/10">
        <div className="rounded-lg bg-accent/10 p-2">
          <Wallet size={20} className="text-accent" />
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            PIX Payment
          </h2>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <p className="text-sm text-foreground-secondary">
          Enter your PIX key to receive commissions. Payment is released 21 days after
          the sale is confirmed (guarantee period against refunds).
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold">Key type</label>
              <select
                name="pix_key_type"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Select</option>
                <option value="cpf">CPF</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="random">Random key</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold">PIX key</label>
              <input
                name="pix_key"
                defaultValue={pixKey ?? ""}
                placeholder={PIX_PLACEHOLDERS[selectedType] ?? "Your PIX key"}
                className="rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-foreground-secondary">
              <Clock size={14} className="text-warning" />
              <span>
                Payment timeline: <strong className="text-foreground">21 days</strong>{" "}
                after the sale is confirmed
              </span>
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Saving..." : saved ? "Saved!" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DashboardAnalytics({
  totalSales,
  totalCommission,
  monthlySales,
  lastPublishedAt,
  affiliateClicks,
  availableBalance,
  pendingReleases,
  pixKeyType,
  pixKey,
}: DashboardAnalyticsProps) {
  const formattedCommission = brl(totalCommission);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Sales</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Track your sales and commissions
        </p>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ShoppingCart} label="Total sales" value={totalSales} />
        <StatCard
          icon={DollarSign}
          label="Total commission"
          value={formattedCommission}
        />
        <StatCard
          icon={MousePointerClick}
          label="Link clicks"
          value={affiliateClicks}
        />
        <StatCard icon={Clock} label="Last post" value={lastPublishedAt ?? "None"} />
      </div>

      <div className="rounded-xl border border-border p-4 sm:p-5">
        <h2 className="mb-4 text-base font-semibold">Sales by month</h2>
        {monthlySales.length === 0 ? (
          <p className="text-foreground-secondary text-sm">
            No sales recorded yet. Your data will appear here once you start selling.
          </p>
        ) : (
          <div className="space-y-2">
            {monthlySales.map((m) => (
              <div key={m.month} className="flex items-center justify-between text-sm">
                <span>{m.month}</span>
                <span className="font-medium">
                  {m.sales} sales - R$ {m.commission.toFixed(2).replace(".", ",")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AvailableBalanceCard amount={availableBalance} hasPix={!!pixKey} />

      <PendingReleasesCard pending={pendingReleases} />

      <PixCard pixKeyType={pixKeyType} pixKey={pixKey} />
    </div>
  );
}
