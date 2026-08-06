"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, Mail, MessageSquare, Download, Inbox, Check, X } from "lucide-react";
import { formatSaoPaulo } from "@/lib/timezone";
import { approveOrganicLead, rejectOrganicLead } from "@/lib/actions/leads";
import type { SignupLane, SignupLead, SignupLeadStage } from "@/types/database";
import { adminLeadsCopy } from "./copy";

type StageFilter = "All" | SignupLeadStage;
type LaneFilter = "All" | SignupLane;

const STAGE_FILTERS: StageFilter[] = [
  "All",
  "captured",
  "contacted",
  "engaged",
  "started",
  "sent_to_instagram",
  "connected",
  "invited",
];

const LANE_FILTERS: LaneFilter[] = ["All", "partner", "customer", "organic"];

const STAGE_STYLE: Record<SignupLeadStage, string> = {
  captured: "bg-background-secondary text-foreground-secondary",
  contacted: "bg-warning/10 text-warning",
  engaged: "bg-accent/10 text-accent",
  started: "bg-warning/10 text-warning",
  sent_to_instagram: "bg-accent/10 text-accent",
  connected: "bg-success/10 text-success",
  invited: "bg-success/10 text-success",
};

const LANE_STYLE: Record<SignupLane, string> = {
  partner: "bg-accent/10 text-accent",
  customer: "bg-success/10 text-success",
  organic: "bg-background-secondary text-foreground-secondary",
};

/** A self-serve signup waiting on Hugo's yes or no. */
function ApprovalButtons({ lead }: { lead: SignupLead }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (lead.lane !== "organic" || lead.approval_state === "rejected") return null;
  if (lead.approval_state === "approved") {
    return (
      <span className="text-xs font-medium text-success">
        {adminLeadsCopy.approval.approved}
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await approveOrganicLead(lead.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed");
              }
            })
          }
          className="inline-flex items-center gap-1 rounded-lg bg-success px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-success/90 disabled:opacity-50"
        >
          <Check size={13} /> {adminLeadsCopy.approval.approve}
        </button>
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await rejectOrganicLead(lead.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed");
              }
            })
          }
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-secondary transition hover:bg-background-secondary disabled:opacity-50"
        >
          <X size={13} /> {adminLeadsCopy.approval.reject}
        </button>
      </div>
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone?: "accent" | "success" | "warning";
  testId: string;
}) {
  const colour =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "accent"
          ? "text-accent"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-secondary">
        {label}
      </p>
      <p data-testid={testId} className={`mt-1 text-2xl font-bold ${colour}`}>
        {value}
      </p>
    </div>
  );
}

/** Straight to WhatsApp with the number they gave, so a lost lead is one tap to chase. */
function contactLinks(lead: SignupLead) {
  const digits = lead.whatsapp.replace(/\D/g, "");
  return {
    wa: digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(
          `Hi ${lead.first_name}, you started signing up at HeyPubli but did not finish connecting your Instagram. Want a hand?`,
        )}`
      : null,
    mail: `mailto:${lead.email}`,
  };
}

function toCsv(leads: SignupLead[]): string {
  const head = [
    "first_name",
    "last_name",
    "email",
    "mobile",
    "stage",
    "attempts",
    "first_seen_at",
    "sent_to_instagram_at",
    "connected_at",
  ];
  // Anything starting =, +, - or @ is treated as a formula by Excel and Sheets, and a
  // mobile number always starts with +. Prefixing an apostrophe keeps it text.
  const cell = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = leads.map((l) =>
    [
      l.first_name,
      l.last_name,
      l.email,
      l.whatsapp,
      l.status,
      l.attempts,
      l.first_seen_at,
      l.sent_to_instagram_at,
      l.connected_at,
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

export function AdminLeads({ leads }: { leads: SignupLead[] }) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<StageFilter>("All");
  const [lane, setLane] = useState<LaneFilter>("All");

  const stats = useMemo(
    () => ({
      total: leads.length,
      sent: leads.filter((l) => l.sent_to_instagram_at).length,
      connected: leads.filter((l) => l.connected_at).length,
      lost: leads.filter((l) => !l.connected_at).length,
    }),
    [leads],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      const matchesStage = stage === "All" || l.status === stage;
      const matchesLane = lane === "All" || l.lane === lane;
      if (!matchesStage || !matchesLane) return false;
      if (!q) return true;
      return `${l.first_name} ${l.last_name} ${l.email} ${l.whatsapp}`
        .toLowerCase()
        .includes(q);
    });
  }, [leads, search, stage, lane]);

  const download = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signups.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{adminLeadsCopy.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-foreground-secondary">
            {adminLeadsCopy.subtitle}
          </p>
        </div>
        <button
          onClick={download}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} /> {adminLeadsCopy.csvLabel}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          testId="stat-total"
          label={adminLeadsCopy.stats.total}
          value={stats.total}
        />
        <StatCard
          testId="stat-sent"
          label={adminLeadsCopy.stats.sent}
          value={stats.sent}
          tone="accent"
        />
        <StatCard
          testId="stat-connected"
          label={adminLeadsCopy.stats.connected}
          value={stats.connected}
          tone="success"
        />
        <StatCard
          testId="stat-lost"
          label={adminLeadsCopy.stats.lost}
          value={stats.lost}
          tone="warning"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            type="text"
            placeholder="Search by name, email or mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
          />
        </div>
        <select
          aria-label="Filter by lane"
          value={lane}
          onChange={(e) => setLane(e.target.value as LaneFilter)}
          className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        >
          {LANE_FILTERS.map((l) => (
            <option key={l} value={l}>
              {l === "All" ? "All lanes" : adminLeadsCopy.lanes[l]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as StageFilter)}
          className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        >
          {STAGE_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All stages" : adminLeadsCopy.stages[s]}
            </option>
          ))}
        </select>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Inbox size={28} className="mx-auto text-foreground-secondary" />
          <h2 className="mt-3 font-semibold text-foreground">
            {adminLeadsCopy.emptyTitle}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-foreground-secondary">
            {adminLeadsCopy.emptyBody}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary">
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {adminLeadsCopy.columns.person}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {adminLeadsCopy.columns.contact}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {adminLeadsCopy.columns.stage}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {adminLeadsCopy.columns.when}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const links = contactLinks(lead);
                return (
                  <tr key={lead.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {`${lead.first_name} ${lead.last_name}`.trim() || "-"}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          title={adminLeadsCopy.laneHint[lead.lane]}
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${LANE_STYLE[lead.lane]}`}
                        >
                          {adminLeadsCopy.lanes[lead.lane]}
                        </span>
                        <span className="text-xs text-foreground-secondary">
                          {adminLeadsCopy.attempts(lead.attempts)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <a
                          href={links.mail}
                          className="inline-flex items-center gap-1.5 text-foreground hover:text-accent"
                        >
                          <Mail size={13} className="shrink-0" />
                          {lead.email}
                        </a>
                        {links.wa ? (
                          <a
                            href={links.wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-foreground-secondary hover:text-success"
                          >
                            <MessageSquare size={13} className="shrink-0" />
                            {lead.whatsapp}
                          </a>
                        ) : (
                          <span className="text-foreground-secondary">
                            {lead.whatsapp}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLE[lead.status]}`}
                      >
                        {adminLeadsCopy.stages[lead.status]}
                      </span>
                      <p className="mt-1 text-xs text-foreground-secondary">
                        {adminLeadsCopy.stageHint[lead.status]}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-foreground-secondary">
                      {formatSaoPaulo(lead.first_seen_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ApprovalButtons lead={lead} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
