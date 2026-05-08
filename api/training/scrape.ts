import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

async function getModelForBusiness(businessId: string): Promise<string> {
  const { data } = await supabase
    .from('businesses')
    .select('ai_model')
    .eq('id', businessId)
    .single();
  if (data?.ai_model?.startsWith('claude')) return data.ai_model;
  const { data: setting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'ai_model')
    .single();
  return setting?.value || 'claude-sonnet-4-6';
}

export const config = { runtime: 'edge' };

function extractTextFromHtml(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 15000);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const body = await req.json() as { url?: string; text?: string; agent_id?: string };

    if (!body.url && !body.text?.trim()) {
      return new Response(JSON.stringify({ error: 'url or text is required' }), { status: 400 });
    }

    // Handle pasted text synchronously (no web scrape needed)
    if (body.text?.trim() && !body.url) {
      const rawText = body.text.trim().slice(0, 15000);
      const aiModel = await getModelForBusiness(businessId);

      const { data: source, error: insertErr } = await supabase
        .from('knowledge_sources')
        .insert({
          business_id: businessId,
          agent_id: body.agent_id || null,
          name: 'Pasted text',
          type: 'document',
          url: null,
          status: 'processing',
        })
        .select('id')
        .single();

      if (insertErr || !source) {
        return new Response(JSON.stringify({ error: 'Failed to create source' }), { status: 500 });
      }

      await summariseInBackground(source.id, rawText, businessId, aiModel);
      return new Response(JSON.stringify({ id: source.id, status: 'synced' }), { status: 200 });
    }

    const url = body.url!;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400 });
    }

    const { data: source, error: insertErr } = await supabase
      .from('knowledge_sources')
      .insert({
        business_id: businessId,
        agent_id: body.agent_id || null,
        name: parsed.hostname,
        type: 'website',
        url,
        status: 'processing',
      })
      .select('id')
      .single();

    if (insertErr || !source) {
      return new Response(JSON.stringify({ error: 'Failed to create source' }), { status: 500 });
    }

    scrapeInBackground(source.id, url, businessId);

    return new Response(JSON.stringify({ id: source.id, status: 'processing' }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

async function summariseInBackground(sourceId: string, rawText: string, businessId: string, aiModel: string) {
  try {
    // Short text doesn't need summarisation — store directly
    if (rawText.length < 500) {
      await supabase
        .from('knowledge_sources')
        .update({
          status: 'synced',
          content: rawText,
          summary: rawText,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId);
      return;
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiModel,
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Summarise the following business information into a concise knowledge base that an AI phone receptionist can use to answer customer questions. Include: services offered, pricing if mentioned, opening hours, location, contact details, and any key policies.\n\nContent:\n${rawText}`,
        }],
      }),
    });

    if (!aiRes.ok) {
      // Store the raw text anyway so it's not lost
      await supabase
        .from('knowledge_sources')
        .update({ status: 'synced', content: rawText.slice(0, 5000), summary: rawText.slice(0, 2000) })
        .eq('id', sourceId);
      return;
    }

    const aiData = await aiRes.json() as { content: Array<{ text: string }> };
    const summary = aiData.content?.[0]?.text ?? rawText.slice(0, 2000);

    await supabase
      .from('knowledge_sources')
      .update({
        status: 'synced',
        content: rawText.slice(0, 5000),
        summary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);
  } catch {
    // Even on error, store the raw text so it's usable
    await supabase
      .from('knowledge_sources')
      .update({ status: 'synced', content: rawText.slice(0, 5000), summary: rawText.slice(0, 2000) })
      .eq('id', sourceId);
  }
}

async function scrapeInBackground(sourceId: string, url: string, businessId: string) {
  try {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'ElsieBot/1.0 (+https://heyelsie.com)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!pageRes.ok) {
      await supabase
        .from('knowledge_sources')
        .update({ status: 'failed', content: `HTTP ${pageRes.status}` })
        .eq('id', sourceId);
      return;
    }

    const html = await pageRes.text();
    const rawText = extractTextFromHtml(html);

    if (rawText.length < 50) {
      await supabase
        .from('knowledge_sources')
        .update({ status: 'failed', content: 'Page had too little text content' })
        .eq('id', sourceId);
      return;
    }

    const aiModel = await getModelForBusiness(businessId);
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiModel,
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Summarise the following business website content into a concise knowledge base that an AI phone receptionist can use to answer customer questions. Include: services offered, pricing if mentioned, opening hours, location, contact details, and any key policies.\n\nWebsite content:\n${rawText}`,
        }],
      }),
    });

    if (!aiRes.ok) {
      await supabase
        .from('knowledge_sources')
        .update({ status: 'failed', content: 'AI summarisation failed' })
        .eq('id', sourceId);
      return;
    }

    const aiData = await aiRes.json() as { content: Array<{ text: string }> };
    const summary = aiData.content?.[0]?.text ?? '';

    await supabase
      .from('knowledge_sources')
      .update({
        status: 'synced',
        content: rawText.slice(0, 5000),
        summary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);

  } catch {
    await supabase
      .from('knowledge_sources')
      .update({ status: 'failed', content: 'Scrape failed' })
      .eq('id', sourceId);
  }
}
