import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

/**
 * CRM booking tool — called by the AI warm-up voice agent mid-call
 * (`book_appointment`). Captures the lead into the CRM: upserts the contact,
 * moves it to the Booked stage, creates a follow-up task for the VA, logs the
 * activity, and (best-effort) texts a confirmation. Auth = x-tool-secret.
 */
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sendSMS(from: string, to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !from || !to) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  }).catch(() => {});
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if ((req.headers.get('x-tool-secret') || req.headers.get('x_tool_secret')) !== process.env.TOOL_SECRET) {
    return json(401, { error: 'Unauthorized' });
  }

  let raw: Record<string, unknown>;
  try { raw = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const args = (raw.args ?? raw) as { name?: string; phone?: string; when?: string; notes?: string };
  const call = (raw as { call?: { from_number?: string; to_number?: string } }).call;

  const name = (args.name || '').trim();
  const when = (args.when || '').trim();
  const notes = (args.notes || '').trim();
  let phone = (args.phone || '').trim();
  if (!phone && call?.from_number) phone = call.from_number.trim();
  if (!phone) return json(400, { error: 'phone required' });

  // Booked stage in the default pipeline.
  const { data: pipeline } = await supabase.from('wk_pipelines').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  let bookedColId: string | null = null;
  if (pipeline?.id) {
    const { data: col } = await supabase
      .from('wk_pipeline_columns')
      .select('id').eq('pipeline_id', pipeline.id).ilike('name', 'booked').maybeSingle();
    bookedColId = col?.id ?? null;
  }

  // "Stop AI once the lead books" — honour the warm-up setting so a booked
  // lead never keeps getting AI texts.
  const { data: aiSettings } = await supabase
    .from('wk_ai_reply_settings').select('auto_off_on_booking').eq('id', 'default').maybeSingle();
  const aiOff = aiSettings?.auto_off_on_booking ? { ai_enabled: false } : {};

  // Upsert contact by phone (wk_contacts has UNIQUE(phone)).
  const { data: existing } = await supabase.from('wk_contacts').select('id, name').eq('phone', phone).maybeSingle();
  let contactId: string;
  if (existing) {
    contactId = existing.id;
    await supabase.from('wk_contacts').update({
      name: name || existing.name,
      is_hot: true,
      ...(bookedColId ? { pipeline_column_id: bookedColId } : {}),
      ...aiOff,
      last_contact_at: new Date().toISOString(),
    }).eq('id', contactId);
  } else {
    const { data: created, error: cErr } = await supabase.from('wk_contacts').insert({
      name: name || 'New lead', phone, is_hot: true,
      ...(bookedColId ? { pipeline_column_id: bookedColId } : {}),
      ...aiOff,
      custom_fields: { source: 'ai_voice_booking' },
    }).select('id').single();
    if (cErr || !created) return json(500, { error: cErr?.message ?? 'contact create failed' });
    contactId = created.id;
  }

  // Follow-up task for the VA + activity log.
  await supabase.from('wk_tasks').insert({
    contact_id: contactId,
    title: `Booked call${when ? ` — ${when}` : ''}`,
    body: notes || null,
    status: 'open',
  });
  await supabase.from('wk_activities').insert({
    contact_id: contactId,
    kind: 'note',
    title: 'AI booked a call',
    body: [when && `When: ${when}`, notes].filter(Boolean).join(' · ') || 'Lead booked via AI voice.',
  });

  // Best-effort two-text sequence from the number they called (to_number):
  // 1) a nicely formatted EXAMPLE booking — the exact kind of confirmation
  //    their own customers would get (the product, demonstrated), then
  // 2) the real confirmation of their onboarding.
  const from = (call?.to_number || '').trim();
  if (from) {
    const firstName = name ? name.split(' ')[0] : '';
    const exampleText = [
      'Here’s the kind of text your customers get the second I book a job for you:',
      '',
      '✅ Appointment confirmed',
      '👤 Sarah M.',
      '🔧 Leaking tap — kitchen',
      '📅 Tomorrow, 2:00 PM',
      '📍 42 Oak Street',
      '',
      'Instant, professional, zero missed calls.',
    ].join('\n');
    const confirmText = `${firstName ? `Thanks ${firstName}! ` : ''}Just to confirm — your onboarding with Rod is ${when || 'booked'}. If anything changes, reply here anytime. — Elsie`;

    await sendSMS(from, phone, exampleText);
    // Small gap so the two texts arrive in order.
    await new Promise((r) => setTimeout(r, 2000));
    await sendSMS(from, phone, confirmText);

    // Log both on the contact's timeline so the VA sees the full thread.
    await supabase.from('wk_sms_messages').insert([
      { contact_id: contactId, direction: 'outbound', channel: 'sms', body: exampleText, from_e164: from, to_e164: phone, status: 'sent', ai_generated: true },
      { contact_id: contactId, direction: 'outbound', channel: 'sms', body: confirmText, from_e164: from, to_e164: phone, status: 'sent', ai_generated: true },
    ]);
  }

  return json(200, { success: true, message: `Booked${when ? ` for ${when}` : ''}. Confirmation sent.` });
}
