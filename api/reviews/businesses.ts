// Multi-business for the Reviews app. GET → every (non-draft) business the caller
// belongs to (Business Switcher). POST activate → set the active business. POST
// create → make/reuse a DRAFT business for the Add-Business wizard (invisible
// until finalized). POST finalize → activate the draft after Google connect.
//
// All writes are gated to REVIEWS users (the caller's current business must have
// the reviews flag) so a receptionist/CRM identity can never re-point its own
// active business and mis-scope its app. Every query is scoped to the caller.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function memberBusinessIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('team_members').select('business_id').eq('user_id', userId);
  return [...new Set((data ?? []).map((m) => m.business_id))];
}

/** The caller must be a Reviews user (their current business has the reviews flag). */
async function callerIsReviewsUser(businessId: string): Promise<boolean> {
  const { data } = await supabase
    .from('feature_flags').select('enabled')
    .eq('business_id', businessId).eq('flag_key', 'reviews').maybeSingle();
  return !!data?.enabled;
}

async function setActive(userId: string, businessId: string) {
  // Upsert so it persists even if the profiles row is somehow missing.
  await supabase.from('profiles').upsert({ id: userId, active_business_id: businessId }, { onConflict: 'id' });
}

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const ids = await memberBusinessIds(auth.userId);
    if (!ids.length) return new Response(JSON.stringify({ businesses: [] }), { status: 200 });
    const { data } = await supabase.from('businesses').select('id, name, address, status').in('id', ids);
    const businesses = (data ?? [])
      .filter((b) => b.status !== 'draft')
      .map((b) => ({
        id: b.id,
        name: b.name,
        addressLine: b.address ?? null,
        avatarInitials: initials(b.name || 'Business'),
        isActive: b.id === auth.businessId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return new Response(JSON.stringify({ businesses }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  // Every mutation requires the caller to be a Reviews user.
  if (!(await callerIsReviewsUser(auth.businessId))) {
    return new Response(JSON.stringify({ error: 'Reviews access required' }), { status: 403 });
  }

  try {
    const body = (await req.json()) as { action?: string; business_id?: string; name?: string };

    if (body.action === 'activate') {
      if (!body.business_id) return new Response(JSON.stringify({ error: 'business_id required' }), { status: 400 });
      const ids = await memberBusinessIds(auth.userId);
      if (!ids.includes(body.business_id)) {
        return new Response(JSON.stringify({ error: 'Not a member of that business' }), { status: 403 });
      }
      await setActive(auth.userId, body.business_id);
      return new Response(JSON.stringify({ ok: true, activeBusinessId: body.business_id }), { status: 200 });
    }

    if (body.action === 'create') {
      // Reuse an existing unfinished draft rather than minting a new one on every
      // click / OAuth cancellation (avoids orphan businesses in the switcher).
      const ids = await memberBusinessIds(auth.userId);
      if (ids.length) {
        const { data: existingDraft } = await supabase
          .from('businesses').select('id').in('id', ids).eq('status', 'draft').limit(1).maybeSingle();
        if (existingDraft) return new Response(JSON.stringify({ ok: true, businessId: existingDraft.id, reused: true }), { status: 200 });
      }

      const name = (body.name?.trim() || 'New business').slice(0, 120);
      const { data: prof } = await supabase.from('profiles').select('email, name').eq('id', auth.userId).maybeSingle();
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business'}-${crypto.randomUUID().slice(0, 8)}`;

      // Draft: not active, invisible in the switcher, until finalized.
      const { data: biz, error: bizErr } = await supabase
        .from('businesses')
        .insert({ owner_id: auth.userId, name, slug, currency: 'GBP', status: 'draft' })
        .select('id')
        .single();
      if (bizErr || !biz) return new Response(JSON.stringify({ error: bizErr?.message || 'create failed' }), { status: 500 });

      await Promise.all([
        supabase.from('team_members').insert({
          business_id: biz.id, user_id: auth.userId, email: prof?.email ?? null, name: prof?.name ?? null,
          role: 'owner', joined_at: new Date().toISOString(),
        }),
        supabase.from('feature_flags').insert({ business_id: biz.id, flag_key: 'reviews', enabled: true }),
        supabase.from('review_settings').insert({
          business_id: biz.id,
          owner_first_name: (prof?.name ?? '').split(/\s+/)[0] || null,
          inbound_token: crypto.randomUUID().replace(/-/g, ''),
        }),
      ]);

      return new Response(JSON.stringify({ ok: true, businessId: biz.id }), { status: 200 });
    }

    if (body.action === 'finalize') {
      if (!body.business_id) return new Response(JSON.stringify({ error: 'business_id required' }), { status: 400 });
      const ids = await memberBusinessIds(auth.userId);
      if (!ids.includes(body.business_id)) {
        return new Response(JSON.stringify({ error: 'Not a member of that business' }), { status: 403 });
      }
      await supabase.from('businesses').update({ status: 'active' }).eq('id', body.business_id);
      await setActive(auth.userId, body.business_id);
      return new Response(JSON.stringify({ ok: true, businessId: body.business_id }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
