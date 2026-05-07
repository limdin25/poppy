import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export const config = { runtime: 'edge', maxDuration: 30 };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  const authorized = (cronSecret && token === cronSecret) || (serviceKey && token === serviceKey);
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, phone')
    .is('avatar_url', null)
    .not('whatsapp', 'is', null)
    .limit(5);

  if (!contacts || contacts.length === 0) {
    return new Response(JSON.stringify({ ok: true, synced: 0, note: 'no contacts without avatar' }), { status: 200 });
  }

  // Fetch chats to find chat IDs for each contact
  const chatsRes = await fetch(
    `https://${UNIPILE_DSN}/api/v1/chats?limit=200`,
    { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
  );
  if (!chatsRes.ok) {
    return new Response(JSON.stringify({ error: `chats fetch failed: ${chatsRes.status}` }), { status: 502 });
  }
  const chatsJson = await chatsRes.json() as { items?: Array<{ id: string; provider_id: string; type: number }> };
  const chats = chatsJson.items ?? [];

  let synced = 0;
  let failed = 0;
  const details: Array<{ name: string | null; phone: string | null; reason: string }> = [];

  for (const contact of contacts) {
    if (!contact.phone) { failed++; details.push({ name: contact.name, phone: contact.phone, reason: 'no phone' }); continue; }
    const digits = contact.phone.replace(/[^0-9]/g, '');
    const waId = `${digits}@s.whatsapp.net`;

    // Find the 1:1 chat for this contact
    const chat = chats.find(c => c.provider_id === waId && c.type === 0);
    if (!chat) { failed++; details.push({ name: contact.name, phone: contact.phone, reason: 'no chat found' }); continue; }

    // Get chat attendees — check for picture_url field
    const attRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/chat_attendees?chat_id=${chat.id}`,
      { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
    );
    if (!attRes.ok) { failed++; details.push({ name: contact.name, phone: contact.phone, reason: `attendees ${attRes.status}` }); continue; }

    const attJson = await attRes.json() as { items?: Array<{ id: string; is_self: number; picture_url?: string }> };
    const contactAtt = attJson.items?.find(a => a.is_self === 0);
    if (!contactAtt) { failed++; details.push({ name: contact.name, phone: contact.phone, reason: 'no attendee in chat' }); continue; }

    // Strategy 1: Use picture_url if present in attendee response
    if (contactAtt.picture_url) {
      try {
        const imgRes = await fetch(contactAtt.picture_url);
        if (imgRes.ok) {
          const blob = await imgRes.arrayBuffer();
          if (blob.byteLength >= 100) {
            const mime = imgRes.headers.get('content-type') || 'image/jpeg';
            const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
            const fileName = `avatars/${contact.id}.${ext}`;
            const { error } = await supabase.storage.from('media').upload(fileName, blob, { contentType: mime, upsert: true });
            if (!error) {
              const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
              if (urlData?.publicUrl) {
                await supabase.from('contacts').update({ avatar_url: urlData.publicUrl }).eq('id', contact.id);
                synced++;
                details.push({ name: contact.name, phone: contact.phone, reason: 'ok (picture_url)' });
                continue;
              }
            }
          }
        }
      } catch { /* fall through to /picture endpoint */ }
    }

    // Strategy 2: Try the binary /picture endpoint
    const picRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/chat_attendees/${encodeURIComponent(contactAtt.id)}/picture`,
      { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: '*/*' } },
    );
    if (!picRes.ok) {
      failed++;
      const errBody = await picRes.text().catch(() => '');
      details.push({ name: contact.name, phone: contact.phone, reason: `picture ${picRes.status}: ${errBody.slice(0, 80)}` });
      continue;
    }

    const blob = await picRes.arrayBuffer();
    if (blob.byteLength < 100) { failed++; details.push({ name: contact.name, phone: contact.phone, reason: 'image too small' }); continue; }

    // Verify it's not Hugo's own photo
    const mime = picRes.headers.get('content-type') || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const fileName = `avatars/${contact.id}.${ext}`;
    const { error } = await supabase.storage.from('media').upload(fileName, blob, { contentType: mime, upsert: true });
    if (error) { failed++; details.push({ name: contact.name, phone: contact.phone, reason: `upload: ${error.message}` }); continue; }

    const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
    if (urlData?.publicUrl) {
      await supabase.from('contacts').update({ avatar_url: urlData.publicUrl }).eq('id', contact.id);
      synced++;
      details.push({ name: contact.name, phone: contact.phone, reason: 'ok (binary)' });
    } else {
      failed++;
      details.push({ name: contact.name, phone: contact.phone, reason: 'no public url' });
    }
  }

  // --- Email avatar sync (unavatar.io) ---
  const { data: emailContacts } = await supabase
    .from('contacts')
    .select('id, name, email')
    .is('avatar_url', null)
    .not('email', 'is', null)
    .limit(10);

  let emailSynced = 0;
  let emailFailed = 0;

  for (const contact of emailContacts || []) {
    if (!contact.email) { emailFailed++; continue; }
    try {
      const res = await fetch(
        `https://unavatar.io/${encodeURIComponent(contact.email)}?fallback=false`,
        { headers: { accept: 'image/*' } },
      );
      if (!res.ok) { emailFailed++; continue; }
      const blob = await res.arrayBuffer();
      if (blob.byteLength < 100) { emailFailed++; continue; }
      const mime = res.headers.get('content-type') || 'image/png';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const fileName = `avatars/${contact.id}.${ext}`;
      const { error } = await supabase.storage.from('media').upload(fileName, blob, { contentType: mime, upsert: true });
      if (error) { emailFailed++; continue; }
      const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
      if (urlData?.publicUrl) {
        await supabase.from('contacts').update({ avatar_url: urlData.publicUrl }).eq('id', contact.id);
        emailSynced++;
      }
    } catch {
      emailFailed++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    whatsapp: { synced, failed, total: contacts.length, details },
    email: { synced: emailSynced, failed: emailFailed, total: (emailContacts || []).length },
  }), { status: 200 });
}
