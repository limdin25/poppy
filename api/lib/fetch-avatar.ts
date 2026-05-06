import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

interface AttendeeResponse {
  items?: Array<{
    id: string;
    is_self: number;
    picture_url?: string;
  }>;
}

/**
 * Fetches a WhatsApp contact's profile picture URL from Unipile chat attendees.
 * Uses the `picture_url` field returned by the attendees API (direct WhatsApp CDN link).
 * Falls back to the binary /picture endpoint if no URL in the response.
 */
export async function fetchAndStoreAvatar(
  contactId: string,
  opts: { attendeeId?: string; chatId?: string },
): Promise<string | null> {
  try {
    let pictureUrl: string | null = null;
    let unipileAttendeeId = opts.attendeeId;

    // Look up chat attendees — the response may include picture_url directly
    if (opts.chatId) {
      const attRes = await fetch(
        `https://${UNIPILE_DSN}/api/v1/chat_attendees?chat_id=${opts.chatId}`,
        { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
      );
      if (attRes.ok) {
        const attJson = await attRes.json() as AttendeeResponse;
        const other = attJson.items?.find(a => a.is_self === 0);
        if (other) {
          unipileAttendeeId = other.id;
          if (other.picture_url) pictureUrl = other.picture_url;
        }
      }
    }

    // If we have an attendeeId but no chatId lookup was done, fetch the attendee directly
    if (!pictureUrl && unipileAttendeeId && !opts.chatId) {
      const attRes = await fetch(
        `https://${UNIPILE_DSN}/api/v1/chat_attendees/${encodeURIComponent(unipileAttendeeId)}`,
        { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
      );
      if (attRes.ok) {
        const att = await attRes.json() as { picture_url?: string };
        if (att.picture_url) pictureUrl = att.picture_url;
      }
    }

    // If we got a direct picture_url from Unipile, download and store it
    if (pictureUrl) {
      const imgRes = await fetch(pictureUrl);
      if (!imgRes.ok) return null;
      const blob = await imgRes.arrayBuffer();
      if (blob.byteLength < 100) return null;

      const mime = imgRes.headers.get('content-type') || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const fileName = `avatars/${contactId}.${ext}`;

      const { error } = await supabase.storage
        .from('media')
        .upload(fileName, blob, { contentType: mime, upsert: true });

      if (error) {
        console.error('[avatar] upload failed:', error.message);
        return null;
      }

      const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
      const avatarUrl = urlData?.publicUrl || null;
      if (avatarUrl) {
        await supabase.from('contacts').update({ avatar_url: avatarUrl }).eq('id', contactId);
      }
      return avatarUrl;
    }

    // Fallback: try the binary /picture endpoint
    if (!unipileAttendeeId) return null;

    const res = await fetch(
      `https://${UNIPILE_DSN}/api/v1/chat_attendees/${encodeURIComponent(unipileAttendeeId)}/picture`,
      { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: '*/*' } },
    );
    if (!res.ok) return null;

    const blob = await res.arrayBuffer();
    if (blob.byteLength < 100) return null;

    const mime = res.headers.get('content-type') || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const fileName = `avatars/${contactId}.${ext}`;

    const { error } = await supabase.storage
      .from('media')
      .upload(fileName, blob, { contentType: mime, upsert: true });

    if (error) {
      console.error('[avatar] upload failed:', error.message);
      return null;
    }

    const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
    const avatarUrl = urlData?.publicUrl || null;
    if (avatarUrl) {
      await supabase.from('contacts').update({ avatar_url: avatarUrl }).eq('id', contactId);
    }
    return avatarUrl;
  } catch (err: any) {
    console.error('[avatar] error:', err.message);
    return null;
  }
}
