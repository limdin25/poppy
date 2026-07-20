// Widget editor settings (GET/PUT) + "Send Installation Instructions" email.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { sendEmail } from '../../src/integrations/resend/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export const WIDGET_DEFAULTS: Record<string, Record<string, string | boolean>> = {
  popup: { 'star-color': '#FFC107', 'background-color': '#FFFFFF', 'text-color': '#000000', position: 'right' },
  carousel: { 'star-color': '#FFC107', 'background-color': '#FFFFFF', 'text-color': '#333333', 'button-color': '#1567f1', 'button-text-color': '#ffffff', 'show-names': true },
  grid: { 'star-color': '#FFC107', 'background-color': '#FFFFFF', 'text-color': '#333333', 'page-background-color': '#F9FAFB', 'button-color': '#333333' },
};

export function buildSnippets(appUrl: string, businessId: string, type: string, settings: Record<string, unknown>): { script: string; container: string | null } {
  const qs = new URLSearchParams({ 'business-id': businessId, tag: `elsie-reviews-${type}` });
  for (const [k, v] of Object.entries(settings)) qs.set(k, String(v));
  const script = `<script src="${appUrl}/api/widget/${type}?${qs.toString()}" defer></script>`;
  const container = type === 'popup' ? null : `<div id="elsie-reviews-${type}"></div>`;
  return { script, container };
}

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('review_widget_settings')
      .select('widget_type, settings')
      .eq('business_id', auth.businessId);
    const byType: Record<string, Record<string, unknown>> = {};
    for (const t of ['popup', 'carousel', 'grid']) {
      byType[t] = { ...WIDGET_DEFAULTS[t], ...((data ?? []).find((r) => r.widget_type === t)?.settings as Record<string, unknown> | undefined ?? {}) };
    }
    return new Response(JSON.stringify({
      widgets: byType,
      snippets: Object.fromEntries(['popup', 'carousel', 'grid'].map((t) => [t, buildSnippets(appUrl, auth.businessId, t, byType[t])])),
    }), { status: 200 });
  }

  if (req.method === 'PUT') {
    const { widget_type, settings } = (await req.json()) as { widget_type?: string; settings?: Record<string, unknown> };
    if (!widget_type || !['popup', 'carousel', 'grid'].includes(widget_type)) {
      return new Response(JSON.stringify({ error: 'widget_type must be popup|carousel|grid' }), { status: 400 });
    }
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings ?? {})) {
      if (/color$/.test(k) && typeof v === 'string' && !/^#[0-9a-fA-F]{3,8}$/.test(v)) continue;
      clean[k] = v;
    }
    const { error } = await supabase
      .from('review_widget_settings')
      .upsert({ business_id: auth.businessId, widget_type, settings: clean, updated_at: new Date().toISOString() }, { onConflict: 'business_id,widget_type' });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, snippets: buildSnippets(appUrl, auth.businessId, widget_type, clean) }), { status: 200 });
  }

  if (req.method === 'POST') {
    // Send installation instructions to the client's web person.
    const { email, widget_type } = (await req.json()) as { email?: string; widget_type?: string };
    const to = email?.trim().toLowerCase();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400 });
    }
    const type = widget_type && ['popup', 'carousel', 'grid'].includes(widget_type) ? widget_type : 'grid';
    const { data: row } = await supabase
      .from('review_widget_settings')
      .select('settings')
      .eq('business_id', auth.businessId)
      .eq('widget_type', type)
      .maybeSingle();
    const settings = { ...WIDGET_DEFAULTS[type], ...(row?.settings as Record<string, unknown> | undefined ?? {}) };
    const { script, container } = buildSnippets(appUrl, auth.businessId, type, settings);
    const { data: biz } = await supabase.from('businesses').select('name').eq('id', auth.businessId).single();

    const html = `
    <div style="font-family:sans-serif;line-height:1.6;color:#1c1c28;max-width:560px;margin:0 auto;">
      <h2>Install the ${biz?.name || ''} review widget</h2>
      <p>Two quick steps — no coding knowledge needed beyond copy &amp; paste.</p>
      <p><strong>1. Add this to the website's <code>&lt;head&gt;</code>:</strong></p>
      <pre style="background:#f3f4f6;padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;">${script.replace(/</g, '&lt;')}</pre>
      ${container ? `<p><strong>2. Add this where the reviews should appear:</strong></p>
      <pre style="background:#f3f4f6;padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;">${container.replace(/</g, '&lt;')}</pre>` : '<p><strong>2. That\'s it — the popup places itself.</strong></p>'}
      <p style="color:#6b7280;font-size:14px;">Using Wix, Squarespace or WordPress? Look for "Add HTML", "Custom Code" or "Embed" in the site editor and paste the snippets there.</p>
      <p style="color:#9ca3af;font-size:12px;">Sent on behalf of ${biz?.name || 'a HeyElsie Reviews client'} · HeyElsie Reviews</p>
    </div>`;
    await sendEmail(to, `Widget installation for ${biz?.name || 'your client'} (2 copy-paste steps)`, html);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
