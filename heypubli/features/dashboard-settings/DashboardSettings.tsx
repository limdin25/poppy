"use client";

import { useState, useTransition } from "react";
import { AtSign, Trash2, Check } from "lucide-react";
import { saveSettings } from "@/lib/actions/settings";
import { disconnectMyInstagram } from "@/lib/actions/instagram-disconnect";
import type { Profile, Sector } from "@/types/database";

const COUNTRIES = [
  {
    code: "BR",
    name: "Brazil",
    dial: "+55",
    postalLabel: "CEP",
    postalPlaceholder: "00000-000",
  },
  {
    code: "PT",
    name: "Portugal",
    dial: "+351",
    postalLabel: "Postal Code",
    postalPlaceholder: "0000-000",
  },
  {
    code: "US",
    name: "United States",
    dial: "+1",
    postalLabel: "ZIP Code",
    postalPlaceholder: "00000",
  },
  {
    code: "GB",
    name: "United Kingdom",
    dial: "+44",
    postalLabel: "Postcode",
    postalPlaceholder: "AA0 0AA",
  },
  {
    code: "AO",
    name: "Angola",
    dial: "+244",
    postalLabel: "Postal Code",
    postalPlaceholder: "000000",
  },
  {
    code: "MZ",
    name: "Mozambique",
    dial: "+258",
    postalLabel: "Postal Code",
    postalPlaceholder: "0000",
  },
  {
    code: "FR",
    name: "France",
    dial: "+33",
    postalLabel: "Postal Code",
    postalPlaceholder: "00000",
  },
  {
    code: "ES",
    name: "Spain",
    dial: "+34",
    postalLabel: "Postal Code",
    postalPlaceholder: "00000",
  },
  {
    code: "DE",
    name: "Germany",
    dial: "+49",
    postalLabel: "Postal Code",
    postalPlaceholder: "00000",
  },
  {
    code: "IT",
    name: "Italy",
    dial: "+39",
    postalLabel: "Postal Code",
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
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, startDisconnect] = useTransition();
  const [disconnectError, setDisconnectError] = useState(false);

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
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-2.5 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
        >
          {saved && <Check size={16} />}
          {isPending ? "Saving..." : saved ? "Saved" : "Save changes"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      )}

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
          Personal details
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">First name</label>
            <input
              name="first_name"
              type="text"
              defaultValue={profile.first_name}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Last name</label>
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
          Address
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-sm font-medium">Country</label>
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
            <label className="text-sm font-medium">Street</label>
            <input
              name="address_street"
              type="text"
              defaultValue={profile.address_street ?? ""}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">City</label>
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

      {instagramEnabled && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
            Instagram Connection
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
              <AtSign size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {instagramConnected ? instagramUsername : "Not connected"}
              </p>
              <p className="text-xs text-foreground-secondary">
                {instagramConnected ? "Account connected" : "Connect to get started"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {instagramConnected && (
                <button
                  type="button"
                  data-testid="disconnect-instagram"
                  disabled={disconnecting}
                  onClick={() => {
                    // Asked plainly, because this stops the posting they signed
                    // up for. Until 07 Aug this button had no handler at all
                    // while the onboarding promised it worked.
                    if (
                      !window.confirm(
                        "Disconnect Instagram? We will stop posting to your account straight away.",
                      )
                    )
                      return;
                    startDisconnect(async () => {
                      const res = await disconnectMyInstagram();
                      if (!res.ok) setDisconnectError(true);
                    });
                  }}
                  className="rounded-lg border border-error/30 px-3 py-2 text-sm font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                >
                  {disconnecting ? "Disconnecting" : "Disconnect"}
                </button>
              )}
              <a
                href={connectUrl}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-background-secondary"
              >
                {instagramConnected ? "Reconnect" : "Connect"}
              </a>
            </div>
          </div>
          {disconnectError && (
            <p className="mt-3 text-xs text-error" data-testid="disconnect-error">
              That did not go through. Try again, and tell us if it keeps failing.
            </p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-error/20 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error/10">
            <Trash2 size={16} className="text-error" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-error">Delete account</h2>
            <p className="text-xs text-foreground-secondary">
              Permanent and irreversible
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-error px-3 py-1.5 text-sm font-medium text-error hover:bg-error/10"
          >
            Delete
          </button>
        </div>
      </section>
    </form>
  );
}
