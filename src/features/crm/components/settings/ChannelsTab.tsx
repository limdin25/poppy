// ChannelsTab — Settings → Channels. Lists every paired channel
// (SMS via Twilio, WhatsApp via Unipile, Email via Resend) grouped
// by provider, with on/off toggle per row.
//
// PR 64 (multi-channel PR 5), Hugo 2026-04-27.
// PR 69 migrated WhatsApp from the legacy provider → Unipile.
// PR 91 (Hugo 2026-04-27): comment hygiene — legacy-provider references
// removed from active code (DB CHECK constraint kept for legacy rows).

import { useMemo, useState } from 'react';
import {
  Phone,
  MessageSquare,
  Mail,
  ExternalLink,
  CheckCircle2,
  XCircle,
  QrCode,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import {
  useChannels,
  type ChannelRow,
  type ChannelProvider,
  type UnipileProvider,
} from '../../hooks/useChannels';
import { useSmsV2 } from '../../store/SmsV2Store';

interface SectionDef {
  provider: ChannelProvider;
  channelKind: 'sms' | 'whatsapp' | 'email';
  label: string;
  Icon: typeof Phone;
  hint: string;
  externalLink?: { href: string; label: string };
  /** PR 69: when set, render a "Connect via QR" button that calls
   *  unipile-create-link with the given Unipile provider. */
  unipileConnect?: { provider: UnipileProvider; label: string; icon: typeof Phone };
}

const SECTIONS: SectionDef[] = [
  {
    provider: 'twilio',
    channelKind: 'sms',
    label: 'SMS — Twilio',
    Icon: Phone,
    hint: 'Numbers managed in the Numbers tab; this list is read-only here.',
  },
  {
    provider: 'unipile',
    channelKind: 'whatsapp',
    label: 'WhatsApp — Unipile',
    Icon: MessageSquare,
    hint: 'Click "Connect via QR" — Unipile opens a hosted page where you scan the WhatsApp QR with your phone. After scanning, the number appears below and is ready to send/receive.',
    unipileConnect: { provider: 'WHATSAPP', label: 'Connect via QR', icon: QrCode },
  },
  {
    provider: 'resend',
    channelKind: 'email',
    label: 'Email — Resend',
    Icon: Mail,
    hint: 'Outbound from your mail.heyelsie.com addresses works today. Inbound is being re-wired — expect a separate update.',
  },
];

export default function ChannelsTab() {
  const {
    rows,
    credentials,
    loading,
    error,
    toggleActive,
    connectUnipile,
    setLabel,
  } = useChannels();
  const { pushToast } = useSmsV2();
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [connectingUnipile, setConnectingUnipile] = useState<UnipileProvider | null>(null);
  const [unipileFallbackUrl, setUnipileFallbackUrl] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<ChannelProvider, ChannelRow[]>();
    for (const r of rows) {
      const arr = m.get(r.provider) ?? [];
      arr.push(r);
      m.set(r.provider, arr);
    }
    return m;
  }, [rows]);

  const credByProvider = useMemo(() => {
    const m = new Map<ChannelProvider, (typeof credentials)[number]>();
    for (const c of credentials) m.set(c.provider, c);
    return m;
  }, [credentials]);

  const handleToggle = async (id: string, next: boolean) => {
    setBusyRowId(id);
    try {
      await toggleActive(id, next);
      pushToast(next ? 'Channel enabled' : 'Channel disabled', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Toggle failed', 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  const handleUnipileConnect = async (provider: UnipileProvider) => {
    setConnectingUnipile(provider);
    setUnipileFallbackUrl(null);
    try {
      const r = await connectUnipile(provider);
      if (r.error) {
        pushToast(`Connect failed: ${r.error}`, 'error');
        return;
      }
      if (r.url) {
        setUnipileFallbackUrl(r.url);
        pushToast(`Opened Unipile — scan the ${provider} QR/login on the new tab`, 'success');
      }
    } finally {
      setConnectingUnipile(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
        <div className="text-[12px] text-[#6B7280] py-4">Loading channels…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1A1A1A] mb-1">Channels</h2>
        <p className="text-[12px] text-[#6B7280]">
          Every channel agents can send + receive on. Toggle a channel off and the dialer +
          message senders will skip it. Numbers can also be assigned to specific campaigns
          inside the Campaigns tab.
        </p>
        {error && (
          <div className="mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded-[10px] px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {SECTIONS.map((section) => {
        const sectionRows = grouped.get(section.provider) ?? [];
        const cred = credByProvider.get(section.provider);
        const sectionConnected = cred?.is_connected ?? sectionRows.some((r) => r.is_active);
        return (
          <div key={section.provider} className="rounded-2xl border border-[#E5E7EB] bg-white">
            <header className="flex items-start justify-between gap-3 px-5 py-3 border-b border-[#E5E7EB]">
              <div className="flex items-start gap-3">
                <section.Icon className="w-5 h-5 text-[#1E9A80] mt-0.5" strokeWidth={1.8} />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-[#1A1A1A]">
                      {section.label}
                    </h3>
                    <ProviderBadge connected={sectionConnected} />
                  </div>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{section.hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-none">
                {section.unipileConnect && (
                  <button
                    onClick={() => void handleUnipileConnect(section.unipileConnect!.provider)}
                    disabled={connectingUnipile === section.unipileConnect.provider}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-[#1E9A80] text-white hover:bg-[#1E9A80]/90 px-3 py-1.5 rounded-[10px] disabled:opacity-60"
                    data-testid={`connect-${section.unipileConnect.provider.toLowerCase()}`}
                  >
                    <section.unipileConnect.icon className="w-3 h-3" />
                    {connectingUnipile === section.unipileConnect.provider
                      ? 'Opening…'
                      : section.unipileConnect.label}
                  </button>
                )}
                {section.externalLink && (
                  <a
                    href={section.externalLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] text-[#1A1A1A] hover:bg-[#F3F3EE] px-3 py-1.5 rounded-[10px]"
                    title="Opens in a new tab"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {section.externalLink.label}
                  </a>
                )}
              </div>
            </header>

            {section.provider === 'unipile' && unipileFallbackUrl && (
              <div className="px-5 py-3 border-b border-[#E5E7EB] bg-[#ECFDF5]/40">
                <div className="text-[11px] text-[#1E9A80] font-semibold mb-1">
                  If the Unipile tab didn't open
                </div>
                <a
                  href={unipileFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] underline text-[#1E9A80] break-all"
                >
                  {unipileFallbackUrl}
                </a>
              </div>
            )}

            <div className="px-5 py-3">
              {sectionRows.length === 0 ? (
                <EmptyState section={section} />
              ) : (
                <ul className="space-y-1.5">
                  {sectionRows.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-[10px] border border-[#E5E7EB] bg-white"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <CircleDot active={row.is_active} />
                        <span className="text-[13px] font-mono text-[#1A1A1A] truncate flex-shrink-0">
                          {row.e164}
                        </span>
                        {row.external_id && (
                          <span className="text-[10px] text-[#9CA3AF] font-mono truncate flex-shrink-0 hidden md:inline">
                            · {row.external_id.slice(0, 8)}…
                          </span>
                        )}
                        {/* PR 115 (Hugo 2026-04-28): admin-editable label
                            per row. Free-text. Saves on blur. Empty → null. */}
                        <input
                          type="text"
                          defaultValue={row.label ?? ''}
                          onBlur={(e) => {
                            const next = e.target.value;
                            if ((row.label ?? '') === next.trim()) return;
                            void setLabel(row.id, next).catch((err) =>
                              pushToast(
                                `Save failed: ${err instanceof Error ? err.message : 'unknown'}`,
                                'error'
                              )
                            );
                          }}
                          placeholder="Add a label (e.g. Free, Trial, Elijah)"
                          className="flex-1 min-w-0 px-2 py-1 text-[12px] bg-transparent border border-transparent hover:border-[#E5E7EB] focus:border-[#1E9A80] focus:bg-white rounded-[6px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30"
                        />
                      </div>
                      <button
                        onClick={() => void handleToggle(row.id, !row.is_active)}
                        disabled={busyRowId === row.id}
                        className={cn(
                          'inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded-full transition-colors flex-shrink-0',
                          row.is_active
                            ? 'bg-[#1E9A80] text-white hover:bg-[#1E9A80]/90'
                            : 'bg-[#F3F3EE] text-[#6B7280] hover:bg-[#E5E7EB]',
                          busyRowId === row.id && 'opacity-60'
                        )}
                      >
                        {busyRowId === row.id ? '…' : row.is_active ? 'On' : 'Off'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProviderBadge({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#1E9A80] bg-[#ECFDF5] px-1.5 py-0.5 rounded">
        <CheckCircle2 className="w-3 h-3" />
        Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#B91C1C] bg-[#FEF2F2] px-1.5 py-0.5 rounded">
      <XCircle className="w-3 h-3" />
      Disconnected
    </span>
  );
}

function CircleDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full flex-none',
        active ? 'bg-[#1E9A80]' : 'bg-[#9CA3AF]'
      )}
      aria-label={active ? 'active' : 'inactive'}
    />
  );
}

function EmptyState({ section }: { section: SectionDef }) {
  const msg =
    section.provider === 'unipile'
      ? 'No WhatsApp / LinkedIn / Email channels yet. Click "Connect via QR" to pair one — Unipile will open a hosted page where you scan the QR.'
      : section.provider === 'resend'
        ? 'No email address yet. Resend domain heyelsie.com is verified — a wk_numbers row appears once the first inbound or send lands.'
        : 'No SMS numbers yet. Add one in the Numbers tab.';
  return <div className="text-[12px] text-[#9CA3AF] py-3">{msg}</div>;
}
