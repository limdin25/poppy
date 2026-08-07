"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, ExternalLink, Mail, MessageSquare, Plus, X } from "lucide-react";
import { createInfluencer } from "@/lib/actions/admin";
import { addMembersToCampaign } from "@/lib/actions/campaigns";
import { formatSaoPaulo } from "@/lib/timezone";
import type { Profile } from "@/types/database";

interface InfluencerRow {
  profile: Profile;
  igUsername: string | null;
}

interface AdminInfluencersProps {
  influencers: InfluencerRow[];
  campaignId: string | null;
  campaignMemberIds: string[];
}

type CampaignFilter = "All" | "In campaign" | "Not in campaign";

function CampaignCell({
  profileId,
  campaignId,
  isMember,
}: {
  profileId: string;
  campaignId: string | null;
  isMember: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isMember) {
    return (
      <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
        In campaign
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
        Not in campaign
      </span>
      {campaignId && (
        <button
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await addMembersToCampaign(campaignId, [profileId], false);
              if (r && "error" in r) setError(r.error);
            });
          }}
          disabled={isPending}
          className="rounded-lg border border-accent px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add"}
        </button>
      )}
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}

function AddInfluencerModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const r = await createInfluencer(formData);
      if (r && "error" in r) setError(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Add creator</h2>
          <button
            onClick={onClose}
            className="text-foreground-secondary hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              name="first_name"
              required
              placeholder="First name"
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <input
              name="last_name"
              placeholder="Last name"
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <input
            name="email"
            type="email"
            required
            placeholder="email@example.com"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <input
            name="whatsapp"
            placeholder="WhatsApp (optional)"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? "Creating..." : "Create creator"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function AdminInfluencers({
  influencers,
  campaignId,
  campaignMemberIds,
}: AdminInfluencersProps) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("All");

  const memberIdSet = new Set(campaignMemberIds);

  const filtered = influencers.filter((i) => {
    const matchesSearch =
      i.profile.first_name.toLowerCase().includes(search.toLowerCase()) ||
      i.profile.last_name.toLowerCase().includes(search.toLowerCase()) ||
      i.profile.email.toLowerCase().includes(search.toLowerCase()) ||
      (i.igUsername ?? "").toLowerCase().includes(search.toLowerCase().replace(/^@/, ""));
    const isMember = memberIdSet.has(i.profile.id);
    const matchesCampaign =
      campaignFilter === "All" ||
      (campaignFilter === "In campaign" ? isMember : !isMember);
    return matchesSearch && matchesCampaign;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Creators</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground-secondary">
            {influencers.length} total
          </span>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            <Plus size={16} /> Add
          </button>
        </div>
      </div>
      {showAdd && <AddInfluencerModal onClose={() => setShowAdd(false)} />}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
          />
        </div>
        <select
          aria-label="Filter by campaign"
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value as CampaignFilter)}
          className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        >
          <option value="All">All</option>
          <option value="In campaign">In campaign</option>
          <option value="Not in campaign">Not in campaign</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background-secondary">
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Name
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Email
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Instagram
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Campaign
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Signed up
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.profile.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">
                  {`${row.profile.first_name} ${row.profile.last_name}`.trim() ||
                    (row.igUsername ? `@${row.igUsername}` : "-")}
                  {row.profile.suspended_at && (
                    <span className="ml-2 inline-flex rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
                      Suspended
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground-secondary">
                  {row.profile.email}
                </td>
                <td className="px-4 py-3">
                  {row.igUsername ? (
                    <a
                      href={`https://instagram.com/${row.igUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      @{row.igUsername}
                    </a>
                  ) : (
                    <span className="text-foreground-secondary">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <CampaignCell
                    profileId={row.profile.id}
                    campaignId={campaignId}
                    isMember={memberIdSet.has(row.profile.id)}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground-secondary">
                  {formatSaoPaulo(row.profile.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {row.profile.whatsapp ? (
                      <a
                        href={`https://wa.me/${row.profile.whatsapp.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 hover:bg-background-secondary inline-flex text-success"
                        title="WhatsApp"
                      >
                        <MessageSquare size={16} />
                      </a>
                    ) : (
                      <span className="rounded p-1 text-foreground-secondary/30">
                        <MessageSquare size={16} />
                      </span>
                    )}
                    <a
                      href={`mailto:${row.profile.email}`}
                      className="rounded p-1 hover:bg-background-secondary inline-flex"
                      title="Email"
                    >
                      <Mail size={16} />
                    </a>
                    <Link
                      href={`/admin/influencers/${row.profile.id}`}
                      className="rounded p-1 hover:bg-background-secondary inline-flex"
                      title="View profile"
                    >
                      <ExternalLink size={16} />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-foreground-secondary"
                >
                  No creators found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
