"use client";

import { useState, useTransition } from "react";
import { AtSign, Trash2, Check, Wallet } from "lucide-react";
import { saveSettings } from "@/lib/actions/settings";
import type { Profile, Sector, PixKeyType } from "@/types/database";

const COUNTRIES = [
  {
    code: "BR",
    name: "Brasil",
    dial: "+55",
    postalLabel: "CEP",
    postalPlaceholder: "00000-000",
  },
  {
    code: "PT",
    name: "Portugal",
    dial: "+351",
    postalLabel: "Código Postal",
    postalPlaceholder: "0000-000",
  },
  {
    code: "US",
    name: "Estados Unidos",
    dial: "+1",
    postalLabel: "ZIP Code",
    postalPlaceholder: "00000",
  },
  {
    code: "GB",
    name: "Reino Unido",
    dial: "+44",
    postalLabel: "Postcode",
    postalPlaceholder: "AA0 0AA",
  },
  {
    code: "AO",
    name: "Angola",
    dial: "+244",
    postalLabel: "Código Postal",
    postalPlaceholder: "000000",
  },
  {
    code: "MZ",
    name: "Moçambique",
    dial: "+258",
    postalLabel: "Código Postal",
    postalPlaceholder: "0000",
  },
  {
    code: "FR",
    name: "França",
    dial: "+33",
    postalLabel: "Code Postal",
    postalPlaceholder: "00000",
  },
  {
    code: "ES",
    name: "Espanha",
    dial: "+34",
    postalLabel: "Código Postal",
    postalPlaceholder: "00000",
  },
  {
    code: "DE",
    name: "Alemanha",
    dial: "+49",
    postalLabel: "PLZ",
    postalPlaceholder: "00000",
  },
  {
    code: "IT",
    name: "Itália",
    dial: "+39",
    postalLabel: "CAP",
    postalPlaceholder: "00000",
  },
];

const DIAL_CODES = [
  { dial: "+55", flag: "🇧🇷" },
  { dial: "+351", flag: "🇵🇹" },
  { dial: "+1", flag: "🇺🇸" },
  { dial: "+44", flag: "🇬🇧" },
  { dial: "+244", flag: "🇦🇴" },
  { dial: "+258", flag: "🇲🇿" },
  { dial: "+33", flag: "🇫🇷" },
  { dial: "+34", flag: "🇪🇸" },
  { dial: "+49", flag: "🇩🇪" },
  { dial: "+39", flag: "🇮🇹" },
];

interface DashboardSettingsProps {
  profile: Profile;
  sectors: Sector[];
  selectedSectors: string[];
  instagramConnected: boolean;
  instagramUsername: string | null;
  connectUrl?: string;
  /** When false the Instagram-connection section is hidden (see lib/flags.ts). */
  instagramEnabled?: boolean;
}

export function DashboardSettings({
  profile,
  instagramConnected,
  instagramUsername,
  connectUrl = "/api/instagram/connect",
  instagramEnabled = true,
}: DashboardSettingsProps) {
  const [country, setCountry] = useState(profile.address_country || "BR");
  const [dialCode, setDialCode] = useState("+55");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>(profile.pix_key_type || "cpf");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countryInfo = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("dial_code", dialCode);

    startTransition(async () => {
      const result = await saveSettings(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  };

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-2.5 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
        >
          {saved && <Check size={16} />}
          {isPending ? "Salvando..." : saved ? "Salvo" : "Salvar alterações"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      )}

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
          Dados pessoais
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Nome</label>
            <input
              name="first_name"
              type="text"
              defaultValue={profile.first_name}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Sobrenome</label>
            <input
              name="last_name"
              type="text"
              defaultValue={profile.last_name}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              defaultValue={profile.email}
              disabled
              className="rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm text-foreground-secondary"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-sm font-medium">WhatsApp</label>
            <div className="flex gap-1.5 min-w-0">
              <select
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
                className="w-20 shrink-0 rounded-lg border border-border bg-background px-1.5 py-2 text-xs focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {DIAL_CODES.map((d) => (
                  <option key={d.dial} value={d.dial}>
                    {d.flag} {d.dial}
                  </option>
                ))}
              </select>
              <input
                name="whatsapp"
                type="tel"
                defaultValue={profile.whatsapp ?? ""}
                placeholder="11 99999-9999"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
          Endereço
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-sm font-medium">País</label>
            <select
              name="address_country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-sm font-medium">Rua</label>
            <input
              name="address_street"
              type="text"
              defaultValue={profile.address_street ?? ""}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Cidade</label>
            <input
              name="address_city"
              type="text"
              defaultValue={profile.address_city ?? ""}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">{countryInfo.postalLabel}</label>
            <input
              name="address_postal_code"
              type="text"
              defaultValue={profile.address_postal_code ?? ""}
              placeholder={countryInfo.postalPlaceholder}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={16} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
            Pagamento PIX
          </h2>
        </div>
        <p className="mb-3 text-xs text-foreground-secondary">
          Informe sua chave PIX para receber comissões. O pagamento é liberado 21 dias
          após a venda confirmada (período de garantia contra reembolsos).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Tipo de chave</label>
            <select
              name="pix_key_type"
              value={pixKeyType}
              onChange={(e) => setPixKeyType(e.target.value as PixKeyType)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">Email</option>
              <option value="phone">Telefone</option>
              <option value="random">Chave aleatória</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Chave PIX</label>
            <input
              name="pix_key"
              type="text"
              defaultValue={profile.pix_key ?? ""}
              placeholder={
                pixKeyType === "cpf"
                  ? "000.000.000-00"
                  : pixKeyType === "cnpj"
                    ? "00.000.000/0000-00"
                    : pixKeyType === "email"
                      ? "seu@email.com"
                      : pixKeyType === "phone"
                        ? "+55 11 99999-9999"
                        : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              }
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-accent/5 px-3 py-2">
          <svg
            className="h-4 w-4 shrink-0 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-xs text-foreground-secondary">
            Prazo de pagamento: 21 dias após a venda confirmada
          </span>
        </div>
      </section>

      {instagramEnabled && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
            Conexão Instagram
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
              <AtSign size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {instagramConnected ? instagramUsername : "Não conectado"}
              </p>
              <p className="text-xs text-foreground-secondary">
                {instagramConnected ? "Conta conectada" : "Conecte para começar"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {instagramConnected && (
                <button
                  type="button"
                  className="rounded-lg border border-error/30 px-3 py-2 text-sm font-medium text-error hover:bg-error/10 transition-colors"
                >
                  Desconectar
                </button>
              )}
              <a
                href={connectUrl}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-background-secondary"
              >
                {instagramConnected ? "Reconectar" : "Conectar"}
              </a>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-error/20 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error/10">
            <Trash2 size={16} className="text-error" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-error">Excluir conta</h2>
            <p className="text-xs text-foreground-secondary">Permanente e irreversível</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-error px-3 py-1.5 text-sm font-medium text-error hover:bg-error/10"
          >
            Excluir
          </button>
        </div>
      </section>
    </form>
  );
}
