// Shared helpers for the role-scoped working agreements (public /join links).
//
// wk_agent_agreement holds one row per role, keyed by `slug`:
//   'sales-closer'  mode 'account'    → /join          (creates a CRM account)
//   'property'      mode 'sign_only'  → /join/property (signature only)
//
// wk_agreement_signatures stores a FULL SNAPSHOT of the wording at the moment
// somebody signed. Never a foreign key on its own: the agreement row is
// editable, so a key alone would leave no record of what was actually agreed.

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';

export interface AgreementTerm {
  heading: string;
  body: string;
}

export interface AgreementRow {
  id: number;
  slug: string;
  role_label: string | null;
  title: string;
  intro: string;
  company: string;
  terms: AgreementTerm[];
  acks: string[];
  mode: 'account' | 'sign_only';
  version: number;
  onboarding_open: boolean;
}

const COLS =
  'id, slug, role_label, title, intro, company, terms, acks, mode, version, onboarding_open';

/**
 * Load one agreement. No slug means the original singleton row (id = 1), which
 * is what the untouched /join link asks for.
 */
export async function loadAgreement(slug?: string | null): Promise<AgreementRow | null> {
  const clean = (slug || '').trim().toLowerCase();
  const q = supabaseAdmin.from('wk_agent_agreement').select(COLS);
  const { data } = clean ? await q.eq('slug', clean).maybeSingle() : await q.eq('id', 1).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug ?? 'sales-closer',
    role_label: data.role_label ?? null,
    title: data.title ?? '',
    intro: data.intro ?? '',
    company: data.company ?? 'HeyElsie',
    terms: Array.isArray(data.terms) ? (data.terms as AgreementTerm[]) : [],
    acks: Array.isArray(data.acks) ? (data.acks as string[]) : [],
    mode: data.mode === 'sign_only' ? 'sign_only' : 'account',
    version: typeof data.version === 'number' ? data.version : 1,
    onboarding_open: data.onboarding_open !== false,
  };
}

/**
 * Write the immutable record of a signature. The terms are copied from the
 * agreement row on the server, never taken from the request body, so a signed
 * copy can never be forged from the browser.
 *
 * Returns the new row id, or null if the insert failed (callers decide whether
 * that is fatal: it is for the signature-only flow, best-effort for the older
 * account flow which already has its own wk_agent_signups record).
 */
export async function recordSignature(args: {
  agreement: AgreementRow;
  fullName: string;
  email: string;
  signaturePng?: string | null;
  profileId?: string | null;
  signupId?: string | null;
  req?: Request;
}): Promise<string | null> {
  const { agreement, fullName, email, signaturePng, profileId, signupId, req } = args;
  const ip =
    req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req?.headers.get('x-real-ip') ||
    null;

  const { data, error } = await supabaseAdmin
    .from('wk_agreement_signatures')
    .insert({
      agreement_slug: agreement.slug,
      agreement_version: agreement.version,
      full_name: fullName,
      email,
      signature_png: signaturePng ?? null,
      agreement_title: agreement.title,
      agreement_intro: agreement.intro,
      agreement_company: agreement.company,
      terms: agreement.terms,
      acks: agreement.acks,
      profile_id: profileId ?? null,
      signup_id: signupId ?? null,
      ip,
      user_agent: req?.headers.get('user-agent') ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[agreements] recordSignature failed:', error?.message);
    return null;
  }
  return data.id as string;
}
