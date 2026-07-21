import { supabaseAdmin } from '../../src/integrations/supabase/client.js';

export const config = { runtime: 'edge' };

/**
 * Public: the agreement text + whether onboarding is open, for the /join page
 * to render. No auth — this is the same terms the new hire is about to sign.
 * Reads via the service role, so the admin-only RLS on wk_agent_agreement is
 * fine (the browser never queries the table directly for the public page).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const { data } = await supabaseAdmin
    .from('wk_agent_agreement')
    .select('title, intro, terms, company, onboarding_open')
    .eq('id', 1)
    .single();

  const a = data ?? {
    title: 'Agent working agreement',
    intro: '',
    terms: [],
    company: 'HeyElsie',
    onboarding_open: true,
  };

  return Response.json({
    ok: true,
    open: a.onboarding_open !== false,
    agreement: {
      title: a.title,
      intro: a.intro,
      terms: Array.isArray(a.terms) ? a.terms : [],
      company: a.company,
    },
  });
}
