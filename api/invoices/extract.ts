import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { callLLM } from '../lib/llm.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const MODEL = 'claude-sonnet-4-6';

export interface InvoiceDraft {
  customer_name: string | null;
  customer_phone: string | null;
  line_items: { description: string; amount: number }[];
  vat_enabled: boolean;
  notes: string | null;
  due_days: number | null;
}

interface Body {
  text?: string;
  audio_base64?: string;
  audio_mime?: string;
  mode?: 'create' | 'edit';
  current?: InvoiceDraft;
  instruction?: string;
}

// ── OpenAI key (env → platform_settings fallback, same pattern as lib/llm.ts) ──
async function getOpenAIKey(): Promise<string> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'openai_api_key')
    .single();
  return data?.value || '';
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function filenameForMime(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'note.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'note.mp3';
  if (mime.includes('wav')) return 'note.wav';
  if (mime.includes('ogg') || mime.includes('opus')) return 'note.ogg';
  return 'note.webm';
}

async function transcribe(audioBase64: string, mime: string, apiKey: string): Promise<string | null> {
  const bytes = base64ToBytes(audioBase64);
  const form = new FormData();
  // TS 5.7 types Uint8Array over ArrayBufferLike, which no longer satisfies
  // Blob's part type (and BlobPart itself is absent from the node lib Vercel
  // checks against); the bytes are a plain ArrayBuffer-backed array at runtime.
  form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: mime }), filenameForMime(mime));
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    console.error(`[invoices/extract] Whisper error: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json() as { text?: string };
  return (data.text || '').trim() || null;
}

// ── draft normalisation (never trust LLM output shape) ────────────────────────
function normaliseDraft(raw: Record<string, unknown>): InvoiceDraft {
  const items = Array.isArray(raw.line_items) ? raw.line_items : [];
  const line_items = items
    .map((it: Record<string, unknown>) => ({
      description: typeof it?.description === 'string' ? it.description.trim() : '',
      amount: typeof it?.amount === 'number' && Number.isFinite(it.amount)
        ? +(it.amount as number).toFixed(2)
        : Number.parseFloat(String(it?.amount)) || 0,
    }))
    .filter((it) => it.description);

  const dueDays = typeof raw.due_days === 'number' && Number.isFinite(raw.due_days)
    ? Math.round(raw.due_days as number)
    : null;

  return {
    customer_name: typeof raw.customer_name === 'string' && raw.customer_name.trim() ? raw.customer_name.trim() : null,
    customer_phone: typeof raw.customer_phone === 'string' && raw.customer_phone.trim() ? raw.customer_phone.trim() : null,
    line_items,
    vat_enabled: raw.vat_enabled === true,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null,
    due_days: dueDays,
  };
}

const DRAFT_SHAPE = `{
  "customer_name": string or null,
  "customer_phone": string or null,
  "line_items": [{ "description": string, "amount": number }],
  "vat_enabled": boolean,
  "notes": string or null,
  "due_days": number or null
}`;

function buildSystemPrompt(businessName: string, services: { name: string; description: string | null; price_from: number | null; price_to: number | null }[]): string {
  const serviceLines = services.length
    ? services.map((s) => {
        const price = s.price_from
          ? (s.price_to && s.price_to !== s.price_from ? ` (£${s.price_from}–£${s.price_to})` : ` (from £${s.price_from})`)
          : '';
        return `- ${s.name}${price}${s.description ? ` — ${s.description}` : ''}`;
      }).join('\n')
    : '(no services listed)';

  return `You turn a UK tradesperson's spoken or typed job description into an invoice draft for ${businessName}.

Services this business offers (for context when naming line items):
${serviceLines}

Rules:
- Reply with STRICT JSON ONLY — no markdown, no commentary. Shape:
${DRAFT_SHAPE}
- All amounts are ex-VAT numbers in GBP (no currency symbols). If the speaker gives a price "including VAT", back-calculate the ex-VAT amount at 20% VAT.
- Labour and parts/materials go on SEPARATE rows with plain-English descriptions, e.g. "Labour — replace kitchen tap (2 hrs)" and "Parts — Bristan tap unit".
- NEVER invent prices that were not stated or clearly implied. If work is mentioned with no price, still include the row with your best description and amount 0.
- vat_enabled: true only if VAT is mentioned or clearly implied (e.g. "plus VAT"); otherwise false.
- due_days: the payment terms in days if stated (e.g. "payment within 14 days" → 14); otherwise null.
- customer_name / customer_phone: exactly as stated, otherwise null.
- notes: any extra remarks meant for the invoice (job address, warranty, thanks); otherwise null.
- Speech may be rambling or vague — extract the best-effort invoice, keep descriptions short and professional, fix obvious transcription slips.`;
}

function buildEditSystemPrompt(businessName: string): string {
  return `You edit an invoice draft for ${businessName}, a UK trade business, following the user's instruction.

Rules:
- Reply with STRICT JSON ONLY — no markdown, no commentary. Return the COMPLETE updated draft in this shape:
${DRAFT_SHAPE}
- Apply ONLY what the instruction asks. Keep every other field and line item exactly as it is.
- All amounts are ex-VAT numbers in GBP. NEVER invent prices not stated or clearly implied by the instruction.
- Keep line item descriptions plain-English and professional (labour and parts on separate rows).`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const mode = body.mode === 'edit' ? 'edit' : 'create';

  // ── resolve the input text (transcribe audio if sent) ──────────────────────
  let transcript = (mode === 'edit' ? body.instruction : body.text)?.trim() || '';

  if (!transcript && body.audio_base64) {
    const openaiKey = await getOpenAIKey();
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'transcription_unavailable' }), { status: 400 });
    }
    const text = await transcribe(body.audio_base64, body.audio_mime || 'audio/webm', openaiKey);
    if (!text) {
      return new Response(JSON.stringify({ error: 'transcription_failed' }), { status: 502 });
    }
    transcript = text;
  }

  if (!transcript) {
    return new Response(JSON.stringify({ error: mode === 'edit' ? 'instruction or audio_base64 is required' : 'text or audio_base64 is required' }), { status: 400 });
  }
  if (mode === 'edit' && !body.current) {
    return new Response(JSON.stringify({ error: 'current draft is required in edit mode' }), { status: 400 });
  }

  // ── business context for better line items ─────────────────────────────────
  const { data: business } = await supabase
    .from('businesses')
    .select('name')
    .eq('id', businessId)
    .single();
  const businessName = business?.name || 'the business';

  let systemPrompt: string;
  let userMessage: string;

  if (mode === 'edit') {
    systemPrompt = buildEditSystemPrompt(businessName);
    userMessage = `Current invoice draft:\n${JSON.stringify(body.current)}\n\nInstruction:\n${transcript}`;
  } else {
    const { data: services } = await supabase
      .from('services')
      .select('name, description, price_from, price_to')
      .eq('business_id', businessId)
      .order('sort_order');
    systemPrompt = buildSystemPrompt(businessName, services || []);
    userMessage = `Job description:\n${transcript}`;
  }

  const reply = await callLLM(MODEL, systemPrompt, [{ role: 'user', content: userMessage }], 1024);
  const jsonMatch = reply.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`[invoices/extract] no JSON in LLM reply: ${reply.slice(0, 200)}`);
    return new Response(JSON.stringify({ error: 'extraction_failed' }), { status: 502 });
  }

  let draft: InvoiceDraft;
  try {
    draft = normaliseDraft(JSON.parse(jsonMatch[0]));
  } catch {
    console.error(`[invoices/extract] unparseable JSON from LLM: ${jsonMatch[0].slice(0, 200)}`);
    return new Response(JSON.stringify({ error: 'extraction_failed' }), { status: 502 });
  }

  return new Response(JSON.stringify({ transcript, draft }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
