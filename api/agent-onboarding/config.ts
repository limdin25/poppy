import { supabaseAdmin } from '../../src/integrations/supabase/client.js';

export const config = { runtime: 'edge' };

/**
 * Public: the agreement text + whether onboarding is open, for the /join page
 * to render. No auth, this is the same terms the new hire is about to sign.
 * Reads via the service role, so the admin-only RLS on wk_agent_agreement is
 * fine (the browser never queries the table directly for the public page).
 *
 * ?slug=property picks a role-scoped agreement (public URL /join/property).
 * With no slug it returns the original B2B Sales Closer row, so the plain
 * /join link keeps behaving exactly as it always has.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const slug = (new URL(req.url).searchParams.get('slug') || '').trim().toLowerCase();

  const cols = 'slug, role_label, title, intro, terms, acks, company, mode, version, onboarding_open';
  const { data } = slug
    ? await supabaseAdmin.from('wk_agent_agreement').select(cols).eq('slug', slug).maybeSingle()
    : await supabaseAdmin.from('wk_agent_agreement').select(cols).eq('id', 1).maybeSingle();

  // An unknown slug is a dead link, not an empty agreement to sign.
  if (slug && !data) {
    return Response.json({ ok: false, error: 'No agreement at this link.' }, { status: 404 });
  }

  const a = data ?? {
    slug: 'sales-closer',
    role_label: null,
    title: 'Agent working agreement',
    intro: '',
    terms: [],
    acks: [],
    company: 'HeyElsie',
    mode: 'account',
    version: 1,
    onboarding_open: true,
  };

  return Response.json({
    ok: true,
    open: a.onboarding_open !== false,
    agreement: {
      slug: a.slug ?? 'sales-closer',
      roleLabel: a.role_label ?? null,
      title: a.title,
      intro: a.intro,
      terms: Array.isArray(a.terms) ? a.terms : [],
      acks: Array.isArray(a.acks) ? a.acks : [],
      company: a.company,
      mode: a.mode === 'sign_only' ? 'sign_only' : 'account',
      version: typeof a.version === 'number' ? a.version : 1,
    },
  });
}
