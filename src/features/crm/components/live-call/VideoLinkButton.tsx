// VideoLinkButton — the video factory's front door on the in-call panel.
//
// Hugo 2026-07-27: "it should say make their video and send when ready. The
// agent knows exactly what's gonna happen." One button, one promise.
//
// It used to be two steps: queue the render, then come back ~10 minutes later
// and press "Text the video". But the agent is ON THE PHONE when they press the
// first button, and by the time the render lands they are three leads down the
// queue. The second button was a button nobody came back for — and because it
// sat there disabled until a video existed, it read as broken. Now the intent
// is armed with the render and api/cron/vsl-auto-send.ts fires it the minute
// the video is ready. "Cancel auto-send" is the undo.
//
// Review-before-send keeps its teeth: the server still refuses to mark a page
// sent with nothing playable on it, and the message is on screen, editable,
// before anything is armed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard, Send, Copy, Check, X, Loader2, Play, RefreshCw, Film, ChevronDown, Ban,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import {
  SEND_CHANNEL_LABEL, channelOptions, defaultChannel,
  type SendChannel, type WorkspaceChannels,
} from '../../lib/sendChannels';
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
  auto_send_channel: SendChannel | null;
  auto_send_body: string | null;
  auto_send_error: string | null;
  channels: WorkspaceChannels;
  to: { phone: string | null; email: string | null };
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

/** Module scope on purpose: the button is mounted in BOTH the contact pane and
 *  the Messages tab, and a per-instance guard would let each copy text the same
 *  lead independently. Keyed by contact id. */
const smsSentByContact = new Set<string>();
const sendInFlight = new Set<string>();

/** Plain-English versions of what the cron writes to auto_send_error. */
const AUTO_SEND_ERROR: Record<string, string> = {
  render_failed: 'The video failed to render, so nothing was sent.',
  expired: 'The send was armed over a day ago and expired — arm it again if it’s still worth sending.',
  no_video: 'There was no video to send.',
  no_contact: 'This lead’s record went missing before the send.',
  no_body: 'The message was empty, so nothing was sent.',
  already_sent: 'It had already been sent by hand.',
};

function autoSendErrorText(raw: string | null): string | null {
  if (!raw) return null;
  if (AUTO_SEND_ERROR[raw]) return AUTO_SEND_ERROR[raw];
  if (raw.startsWith('send_failed:')) return `The send failed — ${raw.slice(12)}. Send it by hand below.`;
  return `The last automatic send didn’t go: ${raw}`;
}

export default function VideoLinkButton({ contact, compact = false }: { contact: Contact; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<SendChannel>('sms');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Guard every async result against the lead having been switched mid-request
  // — otherwise we'd text the wrong plumber and mark the new lead 'sent'.
  const contactIdRef = useRef(contact.id);
  useEffect(() => {
    contactIdRef.current = contact.id;
    // busy is a single-button flag, not lead-specific — always clear on switch
    // so an in-flight request for the old lead can't brick the button (#3).
    setBusy(false);
    setOpen(false); setInfo(null); setSent(false); setCopied(false); setNote('');
    setBody(''); setChannel('sms'); setPickerOpen(false);
  }, [contact.id]);

  const asInfo = (r: { ok: boolean; data: unknown }): PageInfo | null =>
    (r.ok && r.data && 'page_id' in (r.data as object)) ? (r.data as PageInfo) : null;

  /** Take a fresh server payload without stamping on an edit in progress. */
  const absorb = useCallback((page: PageInfo) => {
    setInfo(page);
    setBody((b) => (b.trim() ? b : page.auto_send_body || page.sms_body));
  }, []);

  // While a render is in flight, poll every 15s so "Rendering" flips to
  // "Ready" — and, once auto-send fires, to "Sent" — on its own.
  const rendering = open && (info?.render_status === 'queued' || info?.render_status === 'rendering');
  useEffect(() => {
    if (!rendering) return;
    const id = contact.id;
    const t = setInterval(async () => {
      const page = asInfo(await callVslPage({ contact_id: id }));
      if (id !== contactIdRef.current) return;
      if (page) {
        setInfo(page);
        if (page.state && page.state !== 'created') setSent(true);
      }
    }, 15000);
    return () => clearInterval(t);
  }, [rendering, contact.id]);

  const options = useMemo(
    () => channelOptions(
      info?.channels ?? { sms: true, whatsapp: false, email: true },
      { phone: info?.to.phone ?? contact.phone, email: info?.to.email ?? contact.email },
    ),
    [info, contact.phone, contact.email],
  );
  const chosen = options.find((o) => o.channel === channel) ?? options[0];

  async function prepare() {
    const id = contact.id;
    setBusy(true);
    setNote('');
    try {
      const page = asInfo(await callVslPage({ contact_id: id }));
      if (id !== contactIdRef.current) return; // lead changed — drop the result
      if (!page) { setNote('Could not create the video page — try again.'); return; }
      absorb(page);
      // A page already past 'created' means it's been sent before.
      if (page.state && page.state !== 'created') setSent(true);
      // Default to whatever is armed, else text, else the first channel that works.
      setChannel(page.auto_send_channel ?? defaultChannel(
        channelOptions(page.channels, page.to),
      ));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  /** Queue the render AND arm the send in one call — the whole point. */
  async function makeAndArm() {
    const id = contact.id;
    if (!chosen?.usable) { setNote(chosen?.reason ?? 'Pick a channel that works first.'); return; }
    if (!body.trim()) { setNote('The message is empty — write something first.'); return; }
    setBusy(true);
    setNote('');
    try {
      const r = await callVslPage({
        contact_id: id,
        request_render: true,
        auto_send: { channel, body: body.trim() },
      });
      const page = asInfo(r);
      if (id !== contactIdRef.current) return;
      if (!page) {
        const err = (r.data as { error?: string } | null)?.error;
        setNote(err === 'no_destination'
          ? chosen.reason ?? 'This lead has no address for that channel.'
          : 'Could not queue the render — try again.');
        return;
      }
      setInfo(page);
    } finally {
      setBusy(false);
    }
  }

  async function cancelAuto() {
    const id = contact.id;
    setBusy(true);
    setNote('');
    try {
      const page = asInfo(await callVslPage({ contact_id: id, cancel_auto_send: true }));
      if (id !== contactIdRef.current) return;
      if (page) setInfo(page);
    } finally {
      setBusy(false);
    }
  }

  /** Retry a render that failed, keeping whatever is armed. */
  async function retryRender() {
    const id = contact.id;
    setBusy(true);
    setNote('');
    try {
      const page = asInfo(await callVslPage({ contact_id: id, request_render: true }));
      if (id !== contactIdRef.current) return;
      if (page) setInfo(page);
    } finally {
      setBusy(false);
    }
  }

  /** Send right now — used when the video already exists, so there is nothing
   *  to wait for. Text only: WhatsApp and email have no browser send path here,
   *  and arming is the honest route for them. */
  async function sendNow() {
    if (!info) return;
    const id = contact.id;
    if (channel !== 'sms') {
      setNote(`Arm it instead — ${SEND_CHANNEL_LABEL[channel]} goes out through the sender.`);
      return;
    }
    if (!chosen?.usable) { setNote(chosen?.reason ?? 'This lead has no mobile number.'); return; }
    if (!body.trim()) { setNote('The message is empty — write something first.'); return; }
    // Shared across every mounted copy of this button.
    if (sendInFlight.has(id)) return;
    sendInFlight.add(id);
    setBusy(true);
    setNote('');
    try {
      // Re-check the server RIGHT BEFORE sending — closes the stale-flag window
      // where the funnel was turned off after the panel opened (#2).
      const fresh = await callVslPage({ contact_id: id });
      const freshInfo = asInfo(fresh);
      if (id !== contactIdRef.current) return;
      if (!freshInfo) { setNote('Could not reach the server — try again.'); return; }
      setInfo(freshInfo);
      if (freshInfo.enabled === false) { setNote('The video funnel is switched off — turn it on in Settings to send.'); return; }
      if (!freshInfo.can_send) { setNote('The video isn’t ready yet — make it first.'); return; }

      // Send once. If a previous attempt already texted this lead (and only the
      // mark failed), skip the send and just re-arm tracking (#13).
      if (!smsSentByContact.has(id)) {
        const { error } = await supabase.functions.invoke('wk-sms-send', {
          body: { contact_id: id, body: body.trim() },
        });
        if (error) { setNote('Text failed — copy the link and send it manually.'); return; }
        smsSentByContact.add(id);
      }

      // The SMS is out — ALWAYS mark, even if the agent switched leads meanwhile
      // (the server keys off contact_id, not the UI). Dropping this used to
      // leave a texted lead untracked (#14).
      const marked = await callVslPage({ contact_id: id, mark_sent: true });
      const ok = marked.ok || (marked.data as { state?: string } | null)?.state === 'sent';
      if (ok) smsSentByContact.delete(id); // fully done — a later tap re-sends on purpose
      if (id !== contactIdRef.current) return;
      if (ok) { setSent(true); }
      else if (marked.status === 409) { setNote('Texted, but the funnel is off — tracking will arm when it’s on.'); }
      else { setNote('Texted, but tracking didn’t arm — tap again to finish (won’t re-text).'); }
    } finally {
      sendInFlight.delete(id);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className={compact ? '' : 'pb-1.5 border-b border-[#E5E7EB]/70'}>
        <button
          onClick={prepare}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] disabled:opacity-60 rounded-[8px] py-1.5 transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clapperboard className="w-3.5 h-3.5" />}
          Send as video
        </button>
      </div>
    );
  }

  const funnelOff = info?.enabled === false;
  const rs = info?.render_status ?? null;
  const armed = !!info?.auto_send_channel;
  const armedLabel = info?.auto_send_channel ? SEND_CHANNEL_LABEL[info.auto_send_channel] : '';
  const lastError = autoSendErrorText(info?.auto_send_error ?? null);

  return (
    <div className={compact ? '' : 'pb-1.5 border-b border-[#E5E7EB]/70'}>
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
            The video funnel is switched off in Settings — you can still make the video now; it sends when it’s back on.
          </div>
        )}
        {info?.no_website && (
          <div className="text-[10.5px] text-[#166534] leading-snug">
            No website on file — their video opens with the Google search instead.
          </div>
        )}
        {lastError && (
          <div className="text-[10.5px] text-[#b91c1c] leading-snug">{lastError}</div>
        )}

        <div className="text-[10px] text-[#374151] break-all bg-white border border-[#d5e0ee] rounded-[8px] px-2 py-1.5">
          {info?.url}
        </div>

        {/* how it goes out */}
        <div className="relative">
          <div
            data-testid="video-channel"
            className="flex items-center justify-between gap-2 bg-white border border-[#d5e0ee] rounded-[8px] px-2 py-1.5"
          >
            <span className="text-[10.5px] text-[#374151] leading-snug min-w-0">
              Sending by <span className="font-semibold">{SEND_CHANNEL_LABEL[channel]}</span>
              {chosen?.to ? <> to <span className="break-all">{chosen.to}</span></> : null}
              {!chosen?.usable && (
                <span className="block text-[#b45309]">{chosen?.reason}</span>
              )}
            </span>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              disabled={armed}
              title={armed ? 'Cancel the auto-send first to change channel' : 'Change how this goes out'}
              className="shrink-0 flex items-center gap-0.5 text-[10.5px] font-semibold text-[#3C5A87] disabled:opacity-40 hover:underline"
            >
              Change <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {pickerOpen && (
            <div className="absolute right-0 z-10 mt-1 w-full rounded-[8px] border border-[#d5e0ee] bg-white shadow-lg overflow-hidden">
              {options.map((o) => (
                <button
                  key={o.channel}
                  disabled={!o.usable}
                  onClick={() => { setChannel(o.channel); setPickerOpen(false); setNote(''); }}
                  className="w-full text-left px-2 py-1.5 text-[11px] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#eaf1f8] disabled:hover:bg-transparent"
                >
                  <span className="font-semibold text-[#1A1A1A]">{o.label}</span>
                  {o.usable
                    ? <span className="block text-[10px] text-[#6B7280] break-all">{o.to}</span>
                    : <span className="block text-[10px] text-[#b45309] leading-snug">{o.reason}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* the message that will actually go */}
        <textarea
          data-testid="video-send-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={armed}
          rows={3}
          className="w-full text-[11px] text-[#374151] bg-white border border-[#d5e0ee] rounded-[8px] px-2 py-1.5 leading-snug resize-y disabled:bg-[#f7f9fc] disabled:text-[#6B7280]"
        />

        {/* render lifecycle */}
        {rs === null && (
          <button
            onClick={makeAndArm}
            disabled={busy || !chosen?.usable}
            className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] disabled:opacity-60 rounded-[8px] py-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
            Make their video &amp; send when ready
          </button>
        )}

        {(rs === 'queued' || rs === 'rendering') && (
          <div className="space-y-1.5">
            <div className="flex items-start gap-1.5 text-[11px] font-semibold text-[#3C5A87]">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 mt-px" />
              <span>
                {rs === 'queued' ? 'In the queue' : 'Rendering'} — about 10 minutes.{' '}
                {armed
                  ? `It sends itself by ${armedLabel} the moment it’s ready. You can hang up.`
                  : 'Nothing will be sent automatically.'}
              </span>
            </div>
            {armed && (
              <button
                onClick={cancelAuto}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#b91c1c] border border-[#f3c9c9] bg-white hover:bg-[#fef2f2] rounded-[8px] py-1.5"
              >
                <Ban className="w-3.5 h-3.5" /> Cancel auto-send
              </button>
            )}
          </div>
        )}

        {rs === 'failed' && (
          <div className="space-y-1.5">
            <div className="text-[10.5px] text-[#b91c1c] leading-snug">
              Render failed{info?.no_website ? '' : ' (their website may not load)'} — try again, or tell Hugo.
            </div>
            <button
              onClick={retryRender}
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#3C5A87] border border-[#c9d6e8] bg-white hover:bg-[#eaf1f8] rounded-[8px] py-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {rs === 'ready' && (
          <div className="space-y-1.5">
            {info?.video_url && (
              <a
                href={info.video_url}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#166534] border border-[#bbe5c8] bg-[#f0fdf4] hover:bg-[#dcfce7] rounded-[8px] py-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Watch it first
              </a>
            )}
            {armed ? (
              <>
                <div className="text-[10.5px] text-[#166534] leading-snug">
                  Ready — going out by {armedLabel} within the minute.
                </div>
                <button
                  onClick={cancelAuto}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#b91c1c] border border-[#f3c9c9] bg-white hover:bg-[#fef2f2] rounded-[8px] py-1.5"
                >
                  <Ban className="w-3.5 h-3.5" /> Cancel auto-send
                </button>
              </>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={sendNow}
                  disabled={busy || funnelOff || !info?.can_send || !chosen?.usable}
                  title={!chosen?.usable ? chosen?.reason ?? undefined : undefined}
                  className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] disabled:opacity-60 rounded-[8px] py-1.5"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sent ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                  {sent ? 'Send again' : 'Send it now'}
                </button>
                <button
                  onClick={() => { if (info) { navigator.clipboard?.writeText(info.url); setCopied(true); } }}
                  title="Copy link"
                  className="flex items-center justify-center text-[12px] font-semibold text-[#3C5A87] border border-[#c9d6e8] bg-white hover:bg-[#eaf1f8] rounded-[8px] px-2.5 py-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>
        )}

        {rs !== 'ready' && (
          <button
            onClick={() => { if (info) { navigator.clipboard?.writeText(info.url); setCopied(true); } }}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#3C5A87] border border-[#c9d6e8] bg-white hover:bg-[#eaf1f8] rounded-[8px] py-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy link
          </button>
        )}

        {note && <div className="text-[10.5px] text-[#b45309] leading-snug">{note}</div>}
      </div>
    </div>
  );
}
