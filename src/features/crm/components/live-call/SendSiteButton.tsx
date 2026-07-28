// SendSiteButton — build this lead a website and text them the link.
//
// The human-triggered path. The automated one runs from wk-sms-incoming when a
// lead replies "yeah show me"; this is for the far more common case where they
// say it on the phone instead, and as the retry when the automatic path did not
// fire.
//
// Both paths call the same generator, so a lead can never end up with two
// different sites: wk_site_pages has a unique index on contact_id and the route
// returns the existing page rather than minting a second one.

import { useEffect, useRef, useState } from 'react';
import { Globe, Copy, Check, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import type { Contact } from '../../types';

// Mounted TWICE on the dialer (the compact slot in the Messages tab and the
// stack in column one), so without this a double click across the two mounts
// would fire two generate calls for the same lead. Same guard VideoLinkButton
// needs, for the same reason.
const inFlight = new Set<string>();

interface Result {
  url: string;
  sent: boolean;
  existing?: boolean;
  reason?: string;
}

export default function SendSiteButton({ contact, compact }: { contact: Contact; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when the agent moves to another lead, or the previous lead's link
  // would sit there looking like it belongs to this one.
  useEffect(() => {
    setResult(null);
    setError(null);
    setCopied(false);
  }, [contact.id]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const send = async () => {
    if (busy || inFlight.has(contact.id)) return;
    inFlight.add(contact.id);
    setBusy(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch('/api/site-demo/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ contact_id: contact.id, source: 'dialer' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Could not build the site (${res.status})`);
      setResult({ url: body.url, sent: Boolean(body.sent), existing: body.existing, reason: body.reason });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.delete(contact.id);
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result?.url) return;
    await navigator.clipboard.writeText(result.url).catch(() => {});
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  if (!result) {
    return (
      <div>
        <button
          data-testid="send-site-button"
          onClick={send}
          disabled={busy}
          className={`w-full flex items-center justify-center gap-2 rounded-lg bg-[#2F6F4E] text-white font-semibold disabled:opacity-60 ${
            compact ? 'px-3 py-2 text-xs' : 'px-3 py-2.5 text-sm'
          }`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
          {busy ? 'Building the site' : 'Build & send their website'}
        </button>
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5" data-testid="send-site-result">
      <p className="text-[11px] font-semibold text-[#1A1A1A]">
        {result.sent
          ? 'Site built, the link is on its way'
          : result.existing
            ? 'They already have a site'
            : 'Site built, not sent'}
      </p>
      {/* Being explicit beats a green tick that quietly means nothing: the
          funnel ships switched off, and an agent who thinks a text went out
          when it did not will not follow up. */}
      {!result.sent && result.reason === 'disabled' && (
        <p className="mt-1 text-[11px] text-[#B45309]">
          The website funnel is switched off, so nothing was texted. Copy the link and send it
          yourself, or ask an admin to turn it on.
        </p>
      )}
      <a
        href={`${result.url}?p=1`}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 flex items-center gap-1 text-[11px] text-[#3C5A87] underline break-all"
      >
        {result.url}
        <ExternalLink size={11} className="shrink-0" />
      </a>
      <button
        onClick={copy}
        className="mt-2 flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-2 py-1 text-[11px] font-medium text-[#1A1A1A]"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
