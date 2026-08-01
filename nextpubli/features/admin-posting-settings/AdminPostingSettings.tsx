"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { SCHEDULING_TIMEZONES, DEFAULT_TIMEZONE } from "@/lib/timezone";

// The Outstand API key is a server-side secret, it is NEVER sent to the browser.
// We only receive whether one is configured (hasApiKey) so the UI can hint it.
interface AdminPostingSettingsProps {
  settings: {
    active_provider: string;
    outstand_social_network_id: string | null;
    hasApiKey: boolean;
    default_timezone: string;
  } | null;
}

export function AdminPostingSettings({ settings }: AdminPostingSettingsProps) {
  const [provider, setProvider] = useState(settings?.active_provider ?? "heypubli");
  const [apiKey, setApiKey] = useState("");
  const [networkId, setNetworkId] = useState(settings?.outstand_social_network_id ?? "");
  const [timezone, setTimezone] = useState(
    settings?.default_timezone ?? DEFAULT_TIMEZONE,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch("/api/admin/posting-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active_provider: provider,
          outstand_social_network_id: provider === "outstand" ? networkId : null,
          default_timezone: timezone,
          // Only send the key when the admin actually typed a new one; an empty
          // field keeps the existing key (it's never round-tripped to the client).
          ...(provider === "outstand" && apiKey.trim()
            ? { outstand_api_key: apiKey.trim() }
            : {}),
        }),
      });

      if (!res.ok) throw new Error("Could not save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent/10 p-2">
          <Settings size={20} className="text-accent" />
        </div>
        <h1 className="text-2xl font-bold">Publishing Settings</h1>
      </div>

      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold">Publishing Provider</h2>
        <p className="mb-4 text-sm text-foreground-secondary">
          Choose which system will be used to publish posts to Instagram.
        </p>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-background-secondary">
            <input
              type="radio"
              name="provider"
              value="heypubli"
              checked={provider === "heypubli"}
              onChange={() => setProvider("heypubli")}
              className="text-accent"
            />
            <div>
              <span className="font-medium">NextPubli (direct Meta)</span>
              <p className="text-xs text-foreground-secondary">
                Publishes directly via the Meta Graph API
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-background-secondary">
            <input
              type="radio"
              name="provider"
              value="outstand"
              checked={provider === "outstand"}
              onChange={() => setProvider("outstand")}
              className="text-accent"
            />
            <div>
              <span className="font-medium">Outstand.so</span>
              <p className="text-xs text-foreground-secondary">
                Publishes via the Outstand API (intermediary)
              </p>
            </div>
          </label>
        </div>
      </section>

      {provider === "outstand" && (
        <section className="rounded-xl border border-border p-6">
          <h2 className="mb-4 text-lg font-semibold">Outstand Configuration</h2>

          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="outstand-api-key"
                className="text-sm font-medium text-foreground-secondary"
              >
                API Key
              </label>
              <input
                id="outstand-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings?.hasApiKey
                    ? "•••••••• (configured, leave blank to keep it)"
                    : "sk_live_..."
                }
                className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="outstand-network-id"
                className="text-sm font-medium text-foreground-secondary"
              >
                Social Network ID
              </label>
              <input
                id="outstand-network-id"
                type="text"
                value={networkId}
                onChange={(e) => setNetworkId(e.target.value)}
                placeholder="net_..."
                className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
              />
              <p className="text-xs text-foreground-secondary">
                ID returned when you register your Meta credentials with Outstand
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold">Default timezone</h2>
        <p className="mb-4 text-sm text-foreground-secondary">
          The scheduler and the campaign use this timezone by default. You can change it
          when scheduling each post.
        </p>
        <select
          aria-label="Default timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
        >
          {SCHEDULING_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </section>

      {error && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
      </button>
    </div>
  );
}
