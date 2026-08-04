// Fetching media a lead sent us, in one place, because the guards matter more
// than the fetch.
//
// `wk_sms_messages.media_urls` holds a URL that arrived on a webhook. Anything
// that fetches it is fetching an attacker-suppliable address with our Twilio
// credentials attached, so the host is pinned here rather than at each call
// site. Two callers: api/crm/media.ts (serving it to the inbox) and
// api/crm/ai-reply.ts (showing it to the model).

/** Twilio and nothing else. A webhook cannot talk us into fetching elsewhere. */
export const TWILIO_MEDIA_HOST = 'api.twilio.com';

export interface TwilioMedia {
  /** Raw bytes, base64. */
  base64: string;
  /** e.g. image/jpeg. Empty when Twilio did not say. */
  mediaType: string;
  bytes: number;
}

/** Edge-safe base64. btoa needs a binary string, and String.fromCharCode(...all)
 *  blows the call stack on a megabyte of image, so it goes in chunks. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Fetch one Twilio media URL with the account credentials.
 *
 * Returns null rather than throwing: every caller wants to carry on without the
 * picture rather than fail the whole job over it.
 */
export async function fetchTwilioMedia(
  rawUrl: string,
  opts: { maxBytes?: number } = {},
): Promise<TwilioMedia | null> {
  const maxBytes = opts.maxBytes ?? 3_500_000;

  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== TWILIO_MEDIA_HOST) return null;

  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  if (!sid || !token) return null;

  try {
    // Twilio 307s to a signed S3 URL. Following that automatically would carry
    // our Authorization header to a third-party host, so the hop is by hand and
    // the header is dropped on the second request.
    const first = await fetch(parsed.toString(), {
      redirect: 'manual',
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
    });
    let upstream = first;
    const location = first.headers.get('location');
    if (first.status >= 300 && first.status < 400 && location) {
      upstream = await fetch(location);
    }
    if (!upstream.ok) return null;

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;

    return {
      base64: toBase64(buf),
      mediaType: (upstream.headers.get('content-type') || '').split(';')[0].trim(),
      bytes: buf.byteLength,
    };
  } catch {
    return null;
  }
}

/** Anthropic accepts these four. Anything else is not worth sending. */
export function isSupportedImageType(mediaType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType);
}
