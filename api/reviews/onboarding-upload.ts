// Onboarding file upload: when a client can't export a clean CSV, they upload
// screenshots of their contacts or photos of recent invoices during onboarding.
// Files go to the crm-attachments bucket; we log a row for the team to action,
// and ping the owner so they can turn them into contacts.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { sendEmail } from '../../src/integrations/resend/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const ALLOWED = /^(image\/(png|jpe?g|webp)|application\/pdf)$/;

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return new Response(JSON.stringify({ error: 'file is required' }), { status: 400 });
    if (!ALLOWED.test(file.type)) {
      return new Response(JSON.stringify({ error: 'Upload a PNG, JPEG, WebP or PDF' }), { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'File must be under 10MB' }), { status: 400 });
    }

    const crmProvider = String(form.get('crm_provider') ?? '') || null;
    const kind = String(form.get('kind') ?? 'onboarding');
    // Keep the original name but strip anything unsafe for a storage path.
    const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `onboarding/${auth.businessId}/${Date.now()}-${safeName}`;

    const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/crm-attachments/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': file.type,
        'x-upsert': 'true',
      },
      body: await file.arrayBuffer(),
    });
    if (!up.ok) return new Response(JSON.stringify({ error: `Upload failed: ${await up.text()}` }), { status: 500 });

    const { data, error } = await supabase
      .from('review_onboarding_uploads')
      .insert({
        business_id: auth.businessId,
        storage_path: path,
        original_name: file.name ?? null,
        content_type: file.type,
        kind,
        crm_provider: crmProvider,
        created_by: auth.userId,
      })
      .select('*')
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    // Ping the owner so the upload gets turned into contacts (best-effort).
    try {
      const notify = process.env.ONBOARDING_NOTIFY_EMAIL || 'hugodesouzax@gmail.com';
      const { data: biz } = await supabase.from('businesses').select('name').eq('id', auth.businessId).maybeSingle();
      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/crm-attachments/${path}`;
      await sendEmail(
        notify,
        `New onboarding upload from ${biz?.name || 'a client'}`,
        `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#1A1A1A">
          <p><strong>${biz?.name || 'A client'}</strong> uploaded a file during onboarding.</p>
          <p>Software: <strong>${crmProvider || 'not given'}</strong><br/>File: ${file.name || 'upload'}</p>
          <p><a href="${publicUrl}">Open the file</a></p>
        </div>`,
      );
    } catch { /* notification is best-effort */ }

    return new Response(JSON.stringify({ ok: true, upload: data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
