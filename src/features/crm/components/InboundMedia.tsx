import { useEffect, useState } from 'react';
import { Paperclip, ImageOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

// A picture the LEAD sent us, drawn in the thread.
//
// Hugo 2026-08-03: a HeyPubli lead was asked for their Instagram handle and
// answered with a screenshot. The bubble came out empty, because nothing read
// wk_sms_messages.media_urls and the Twilio URL 401s without our credentials.
//
// Hence the fetch dance rather than a plain <img src>: /api/crm/media wants an
// Authorization header, and an <img> tag cannot send one. We fetch the bytes
// with the session token and hand the tag a blob URL instead. Putting the token
// in the query string would have been one line shorter and would have written a
// lead's private messages into every access log between here and Vercel.

interface Props {
  messageId: string;
  /** How many media items rode along on this message. */
  count: number;
  /** Inbound bubbles are light, outbound are dark. Only affects the fallbacks. */
  tone: 'light' | 'dark';
}

export default function InboundMedia({ messageId, count, tone }: Props) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {Array.from({ length: count }, (_, i) => (
        <MediaItem key={i} messageId={messageId} index={i} tone={tone} />
      ))}
    </div>
  );
}

type State =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'file'; url: string; type: string }
  | { kind: 'error' };

function MediaItem({ messageId, index, tone }: { messageId: string; index: number; tone: 'light' | 'dark' }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // The blob URL is revoked on unmount. Without that, scrolling a long thread
    // leaks one object URL per image for as long as the tab is open.
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) { if (!cancelled) setState({ kind: 'error' }); return; }
        const res = await fetch(`/api/crm/media?message=${encodeURIComponent(messageId)}&i=${index}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { if (!cancelled) setState({ kind: 'error' }); return; }
        const type = res.headers.get('content-type') || '';
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState(
          type.startsWith('image/')
            ? { kind: 'image', url: objectUrl }
            : { kind: 'file', url: objectUrl, type },
        );
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId, index]);

  const muted = tone === 'dark' ? 'text-white/70' : 'text-[#6B7280]';

  if (state.kind === 'loading') {
    return (
      <div className={`flex items-center gap-1.5 text-[11px] ${muted}`}>
        <Paperclip className="w-3 h-3" /> Loading attachment
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className={`flex items-center gap-1.5 text-[11px] ${muted}`}>
        <ImageOff className="w-3 h-3" /> Attachment could not be loaded
      </div>
    );
  }
  if (state.kind === 'file') {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-1.5 text-[11px] underline ${muted}`}
      >
        <Paperclip className="w-3 h-3" /> Open attachment
      </a>
    );
  }
  return (
    <a href={state.url} target="_blank" rel="noopener noreferrer" title="Open full size">
      <img
        src={state.url}
        alt="Attachment sent by the lead"
        className="rounded-xl max-w-full max-h-[320px] object-contain bg-black/[0.03]"
      />
    </a>
  );
}
