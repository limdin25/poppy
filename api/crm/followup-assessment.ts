// Write the follow-up note FOR the agent, from what the CRM already knows
// about this contact, so booking a follow-up is never a blank box.
//
// Hugo, 2026-08-14: "when book a follow up we need write a note and ai brain
// do assessment as well and write note."
//
// Reads three things, whichever exist for this contact, and writes from them:
//   1. the deal    — if this contact is a property branch, its brief and
//                    Hugo's own pinned note (api/lib/next-step-brief.ts)
//   2. the messages — the last few sent/received, whichever channel
//   3. the column  — the pipeline stage the contact sits in right now
//
// Nothing is invented. A contact with none of the above still gets a short,
// honest "nothing on file yet" note rather than a fabricated one.

import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-sonnet-5';

interface Body {
  contact_id?: string;
}

const SYSTEM = [
  'You write ONE short note for a salesperson who is about to book a follow-up call or message with a lead.',
  '',
  'WHAT IT IS FOR. The agent sees this note the moment the follow-up comes due, days or weeks from now, and will have forgotten the detail. Tell them where this stands and what to do.',
  '',
  'HARD RULES.',
  '1. NEVER invent a fact, a figure, or a thing that was said. Use only what you are given below.',
  '2. If there is almost nothing to go on, say so plainly in one line rather than padding it out.',
  '3. Two to four short sentences. No headings, no bullet points, no greeting, no sign-off.',
  '4. Plain British English, direct, no salesmanship.',
  '5. NEVER use a long dash. No em dash, no en dash, anywhere. Use a comma or a full stop. No curly quotes, no ellipsis character.',
  '',
  'Return the note text and nothing else.',
].join('\n');

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const caller = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const contactId = (body.contact_id ?? '').trim();
  if (!contactId) return Response.json({ error: 'contact_id required' }, { status: 400 });

  const [{ data: contact }, { data: messages }, { data: property }] = await Promise.all([
    supabase.from('wk_contacts')
      .select('id, name, pipeline_column_id')
      .eq('id', contactId)
      .maybeSingle(),
    supabase.from('wk_sms_messages')
      .select('direction, channel, body, subject, created_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('brrr_properties')
      .select('address, brief, pinned_note')
      .eq('wk_contact_id', contactId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let columnName: string | null = null;
  if (contact?.pipeline_column_id) {
    const { data: col } = await supabase
      .from('wk_pipeline_columns')
      .select('name')
      .eq('id', contact.pipeline_column_id)
      .maybeSingle();
    columnName = col?.name ?? null;
  }

  const recent = (messages ?? [])
    .slice()
    .reverse()
    .map((m) => {
      const who = m.direction === 'inbound' ? 'THEM' : 'US';
      const chan = String(m.channel ?? '').toUpperCase();
      const text = String(m.body ?? '').trim().slice(0, 300);
      return `${who} (${chan}): ${text}`;
    })
    .join('\n');

  const brief = property?.brief as { do_now?: string[]; blockers?: string[]; why?: string } | null;

  const facts = [
    contact?.name ? `Contact: ${contact.name}` : null,
    columnName ? `Current pipeline stage: ${columnName}` : null,
    property?.address ? `Property: ${property.address}` : null,
    property?.pinned_note ? `Hugo's own note on this: ${property.pinned_note}` : null,
    brief?.why ? `The brain's read on this deal: ${brief.why}` : null,
    brief?.blockers?.length ? `What is holding it up:\n${brief.blockers.map((b) => `- ${b}`).join('\n')}` : null,
    brief?.do_now?.length ? `What we already decided to do:\n${brief.do_now.map((d) => `- ${d}`).join('\n')}` : null,
    recent ? `RECENT MESSAGES (newest last):\n${recent}` : null,
  ].filter(Boolean).join('\n\n');

  if (!facts.trim()) {
    return Response.json({ note: 'Nothing on file yet for this contact. Check in and find out where things stand.' });
  }

  const out = await callLLM(MODEL, SYSTEM, [{ role: 'user', content: facts }], 300);
  if (!out) {
    return Response.json({ error: 'The model did not answer. Try again.' }, { status: 502 });
  }

  const clean = out.trim()
    .replace(/[–—]/g, ',')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...');

  return Response.json({ note: clean });
}
