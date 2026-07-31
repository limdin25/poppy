"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Search,
  ExternalLink,
  Mail,
  MessageSquare,
  Plus,
  MousePointerClick,
  X,
} from "lucide-react";
import { createInfluencer } from "@/lib/actions/admin";
import { addMembersToCampaign } from "@/lib/actions/campaigns";
import { formatSaoPaulo } from "@/lib/timezone";
import type { Profile } from "@/types/database";

interface InfluencerRow {
  profile: Profile;
  igUsername: string | null;
  bioStatus: "ok" | "missing" | "unknown" | null;
  shareLink: string | null;
  totalSales: number;
  commission: number;
  clicks: number;
}

// Pill + one-click WhatsApp nudge for influencers missing their bio link.
function BioLinkCell({ row }: { row: InfluencerRow }) {
  if (!row.igUsername || row.bioStatus === null) {
    return <span className="text-foreground-secondary">-</span>;
  }
  if (row.bioStatus === "ok") {
    return (
      <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
        Na bio ✓
      </span>
    );
  }
  if (row.bioStatus === "unknown") {
    return <span className="text-xs text-foreground-secondary">?</span>;
  }

  const nudge =
    row.profile.whatsapp && row.shareLink
      ? `https://wa.me/${row.profile.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
          `Oi ${row.profile.first_name}! Falta colocar seu link na bio do Instagram para suas vendas contarem. É só copiar e colar no campo "Site" do seu perfil:\n\n${row.shareLink}`,
        )}`
      : null;

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex rounded-full bg-error/10 px-2.5 py-0.5 text-xs font-medium text-error">
        Falta
      </span>
      {nudge && (
        <a
          href={nudge}
          target="_blank"
          rel="noopener noreferrer"
          title="Cobrar pelo WhatsApp"
          className="rounded-lg border border-success/40 px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success hover:text-white"
        >
          Cobrar
        </a>
      )}
    </div>
  );
}

interface AdminInfluencersProps {
  influencers: InfluencerRow[];
  campaignId: string | null;
  campaignMemberIds: string[];
}

type CampaignFilter = "Todas" | "Na campanha" | "Fora da campanha";

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
        Na campanha
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
        Fora da campanha
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
          {isPending ? "Adicionando..." : "Adicionar"}
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
          <h2 className="text-lg font-bold">Adicionar influenciador</h2>
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
              placeholder="Nome"
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <input
              name="last_name"
              placeholder="Sobrenome"
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <input
            name="email"
            type="email"
            required
            placeholder="email@exemplo.com"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <input
            name="whatsapp"
            placeholder="WhatsApp (opcional)"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? "Criando..." : "Criar influenciador"}
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
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("Todas");

  const memberIdSet = new Set(campaignMemberIds);

  const filtered = influencers.filter((i) => {
    const matchesSearch =
      i.profile.first_name.toLowerCase().includes(search.toLowerCase()) ||
      i.profile.last_name.toLowerCase().includes(search.toLowerCase()) ||
      i.profile.email.toLowerCase().includes(search.toLowerCase()) ||
      (i.igUsername ?? "").toLowerCase().includes(search.toLowerCase().replace(/^@/, ""));
    const isMember = memberIdSet.has(i.profile.id);
    const matchesCampaign =
      campaignFilter === "Todas" ||
      (campaignFilter === "Na campanha" ? isMember : !isMember);
    return matchesSearch && matchesCampaign;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Influenciadores</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground-secondary">
            {influencers.length} total
          </span>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            <Plus size={16} /> Adicionar
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
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
          />
        </div>
        <select
          aria-label="Filtrar por campanha"
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value as CampaignFilter)}
          className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        >
          <option value="Todas">Todas</option>
          <option value="Na campanha">Na campanha</option>
          <option value="Fora da campanha">Fora da campanha</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background-secondary">
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Nome
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Email
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Instagram
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Link na bio
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Campanha
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Vendas
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Comissão
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Cliques
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Cadastro
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.profile.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">
                  {`${row.profile.first_name} ${row.profile.last_name}`.trim() ||
                    (row.igUsername ? `@${row.igUsername}` : "—")}
                  {row.profile.suspended_at && (
                    <span className="ml-2 inline-flex rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
                      Suspensa
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
                  <BioLinkCell row={row} />
                </td>
                <td className="px-4 py-3">
                  <CampaignCell
                    profileId={row.profile.id}
                    campaignId={campaignId}
                    isMember={memberIdSet.has(row.profile.id)}
                  />
                </td>
                <td className="px-4 py-3">{row.totalSales}</td>
                <td className="px-4 py-3">
                  R$ {row.commission.toFixed(2).replace(".", ",")}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-foreground-secondary">
                    <MousePointerClick size={14} />
                    {row.clicks}
                  </span>
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
                      href={`/admin/influenciadores/${row.profile.id}`}
                      className="rounded p-1 hover:bg-background-secondary inline-flex"
                      title="Ver perfil"
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
                  colSpan={10}
                  className="px-4 py-8 text-center text-foreground-secondary"
                >
                  Nenhum influenciador encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
