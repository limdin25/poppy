// VideoLinkButton — the video factory's front door on the in-call panel.
//
// Hugo 2026-07-26: two-step flow. "Make video" queues the lead's custom
// render on the VPS (~10 min) → the agent WATCHES it ("Ready") → only then
// "Text the video" sends. The server refuses mark_sent until the page has a
// playable video, so review-before-send has teeth. No-website leads render
// the Google-search opening and carry the free-website offer in the SMS.

import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Send, Copy, Check, X, Loader2, Play, RefreshCw, Film } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import type { Contact } from '../../types';

interface PageInfo {
  page_id: string;
  url: string;
  sms_body: string;
  state: string;
  enabled: boolean;
  render_status: 'queued' | 'rendering' | 'ready' | 'failed' | null;
  video_url: string | null;
  poster_url: string | null;
  no_website: boolean;
  can_send: boolean;
}

// Returns { ok, status, data } so callers can tell "blocked" (409 funnel_off /
// no_video) from "network died" — a false success used to flip the card to
// 'sent' (adversarial review 2026-07-26).
async function callVslPage(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: PageInfo | { error?: string } | null }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, status: 0, data: null };
  const res = await fetch('/api/crm/vsl-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export default function VideoLinkButton({ contact }: { contact: Contact }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');

  // Guard every async result against the lead having been switched mid-request
  // — otherwise we'd text the wrong plumber and mark the new lead 'sent'.
  const contactIdRef = useRef(contact.id);
  // Per-lead "SMS already went out, only the mark failed" flag so a retry
  // re-marks WITHOUT re-texting the lead (adversarial review #13).
  const smsSentRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    contactIdRef.current = contact.id;
    // busy is a single-button flag, not lead-specific — always clear on switch
    // so an in-flight request for the old lead can't brick the button (#3).
    setBusy(false);
    setOpen(false); setInfo(null); setSent(false); setCopied(false); setNote('');
  }, [contact.id]);

  const asInfo = (r: { ok: boolean; data: unknown }): PageInfo | null =>
    (r.ok && r.data && 'page_id' in (r.data as object)) ? (r.data as PageInfo) : null;

  // While a render is in flight, poll every 15s so "Rendering" flips to
  // "Ready" on its own (the VPS worker writes the row; no realtime needed here).
  const rendering = open && (info?.render_status === 'queued' || info?.render_status === 'rendering');
  useEffect(() => {
    if (!rendering) return;
    const id = contact.id;
    const t = setInterval(async () => {
      const page = asInfo(await callVslPage({ contact_id: id }));
      if (id !== contactIdRef.current) return;
      if (page) setInfo(page);
    }, 15000);
    return () => clearInterval(t);
  }, [rendering, contact.id]);

  async function prepare() {
    const id = contact.id;
    setBusy(true);
    setNote('');
    try {
      const page = asInfo(await callVslPage({ contact_id: id }));
      if (id !== contactIdRef.current) return; // lead changed — drop the result
      if (!page) { setNote('Could not create the video page — try again.'); return; }
      setInfo(page);
      // A page already past 'created' means it's been sent before.
      if (page.state && page.state !== 'created') setSent(true);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function makeVideo() {
    const id = contact.id;
    setBusy(true);
    setNote('');
    try {
      const page = asInfo(await callVslPage({ contact_id: id, request_render: true }));
      if (id !== contactIdRef.current) return;
      if (!page) { setNote('Could not queue the render — try again.'); return; }
      setInfo(page);
    } finally {
      setBusy(false);
    }
  }

  async function textIt() {
    if (!info) return;
    const id = contact.id;
    if (!contact.phone) { setNote('This lead has no mobile number — copy the link instead.'); return; }
    setBusy(true);
    setNote('');
    try {
      // Re-check the server RIGHT BEFORE sending — closes the stale-flag window
      // where the funnel was turned off after the panel opened (#2). Also gives
      // us the freshest sms_body.
      const fresh = await callVslPage({ contact_id: id });
      const freshInfo = asInfo(fresh);
      if (id !== contactIdRef.current) return;
      if (!freshInfo) { setNote('Could not reach the server — try again.'); return; }
      setInfo(freshInfo);
      if (freshInfo.enabled === false) { setNote('The video funnel is switched off — turn it on in Settings to send.'); return; }
      if (!freshInfo.can_send) { setNote('The video isn’t ready yet — make it first.'); return; }

      // Send once. If a previous attempt already texted this lead (and only the
      // mark failed), skip the send and just re-arm tracking (#13).
      if (!smsSentRef.current.has(id)) {
        const { error } = await supabase.functions.invoke('wk-sms-send', {
          body: { contact_id: id, body: freshInfo.sms_body },
        });
        if (error) { setNote('Text failed — copy the link and send it manually.'); return; }
        smsSentRef.current.add(id);
      }

      // The SMS is out — ALWAYS mark, even if the agent switched leads meanwhile
      // (the server keys off contact_id, not the UI). Dropping this used to
      // leave a texted lead untracked (#14).
      const marked = await callVslPage({ contact_id: id, mark_sent: true });
      const ok = marked.ok || (marked.data as { state?: string } | null)?.state === 'sent';
      if (ok) smsSentRef.current.delete(id); // fully done — a later tap re-sends on purpose
      if (id !== contactIdRef.current) return;
      if (ok) { setSent(true); }
      else if (marked.status === 409) { setNote('Texted, but the funnel is off — tracking will arm when it’s on.'); }
      else { setNote('Texted, but tracking didn’t arm — tap again to finish (won’t re-text).'); }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="pb-1.5 border-b border-[#E5E7EB]/70">
        <button
          onClick={prepare}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] disabled:opacity-60 rounded-[8px] py-1.5 transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clapperboard className="w-3.5 h-3.5" />}
          Video
        </button>
      </div>
    );
  }

  const funnelOff = info?.enabled === false;
  const rs = info?.render_status ?? null;

  return (
    <div className="pb-1.5 border-b border-[#E5E7EB]/70">
      <div className="rounded-[10px] border border-[#c9d6e8] bg-[#f2f6fb] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#3C5A87]">
            Their video page
          </span>
          <button
            onClick={() => setOpen(false)}
            className="p-0.5 rounded hover:bg-black/[0.06] text-[#6B7280]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {funnelOff && (
          <div className="text-[10.5px] text-[#b45309] leading-snug">
            The video funnel is switched off in Settings — you can still make the video now; sending unlocks when it’s on.
          </div>
        )}
        {info?.no_website && (
          <div className="text-[10.5px] text-[#166534] leading-snug">
            No website on file — their video opens with the Google search instead.
          </div>
        )}

        <div className="text-[10px] text-[#374151] break-all bg-white border border-[#d5e0ee] rounded-[8px] px-2 py-1.5">
          {info?.url}
        </div>
        <div className="text-[11px] text-[#374151] bg-white border border-[#d5e0ee] rounded-[8px] px-2 py-1.5 leading-snug">
          {info?.sms_body}
        </div>

        {/* render lifecycle */}
        {rs === null && (
          <button
            onClick={makeVideo}
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] disabled:opacity-60 rounded-[8px] py-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
            Make their video
          </button>
        )}
        {(rs === 'queued' || rs === 'rendering') && (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#3C5A87]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {rs === 'queued' ? 'In the queue…' : 'Rendering — about 10 minutes.'} This updates on its own.
          </div>
        )}
        {rs === 'failed' && (
          <div className="space-y-1.5">
            <div className="text-[10.5px] text-[#b91c1c] leading-snug">
              Render failed{info?.no_website ? '' : ' (their website may not load)'} — try again, or tell Hugo.
            </div>
            <button
              onClick={makeVideo}
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#3C5A87] border border-[#c9d6e8] bg-white hover:bg-[#eaf1f8] rounded-[8px] py-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}
        {rs === 'ready' && info?.video_url && (
          <a
            href={info.video_url}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#166534] border border-[#bbe5c8] bg-[#f0fdf4] hover:bg-[#dcfce7] rounded-[8px] py-1.5"
          >
            <Play className="w-3.5 h-3.5" /> Watch it first
          </a>
        )}

        <div className="flex gap-1.5">
          <button
            onClick={textIt}
            disabled={busy || funnelOff || !info?.can_send}
            title={!info?.can_send ? 'Make the video first — you send it after you’ve watched it' : undefined}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] disabled:opacity-60 rounded-[8px] py-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sent ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
            {sent ? 'Text again' : 'Text the video'}
          </button>
          <button
            onClick={() => { if (info) { navigator.clipboard?.writeText(info.url); setCopied(true); } }}
            title="Copy link"
            className="flex items-center justify-center text-[12px] font-semibold text-[#3C5A87] border border-[#c9d6e8] bg-white hover:bg-[#eaf1f8] rounded-[8px] px-2.5 py-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {note && <div className="text-[10.5px] text-[#b45309] leading-snug">{note}</div>}
      </div>
    </div>
  );
}
