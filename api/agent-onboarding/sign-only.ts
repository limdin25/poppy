import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { loadAgreement, recordSignature } from '../lib/agreements.js';

export const config = { runtime: 'edge' };

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Public: sign a working agreement WITHOUT creating an account.
 *
 * For somebody who already works here and already has a CRM login (Pedro on the
 * property team). They read the agreement, type their full name, draw their
 * signature, confirm their email, submit. We store an immutable snapshot of the
 * exact wording they agreed to and stop there.
 *
 * This route never creates an auth user, never writes to profiles, and never
 * changes an existing account in any way. It only ever inserts one row into
 * wk_agreement_signatures. The account-creating flow is a different route
 * (sign.ts + verify.ts) and is untouched.
 *
 * Only agreements marked mode = 'sign_only' can be signed here, so the sales
 * closer agreement can never be used to skip account creation.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { slug, name, email, signaturePng } = (await req.json()) as {
      slug?: string;
      name?: string;
      email?: string;
      signaturePng?: string;
    };

    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanName) return Response.json({ error: 'Your full name is required' }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return Response.json({ error: 'A valid email is required' }, { status: 400 });
    }
    if (!signaturePng || !signaturePng.startsWith('data:image/')) {
      return Response.json({ error: 'Please sign in the box before submitting' }, { status: 400 });
    }

    const agreement = await loadAgreement(slug);
    if (!agreement) {
      return Response.json({ error: 'No agreement at this link.' }, { status: 404 });
    }
    if (agreement.mode !== 'sign_only') {
      return Response.json({ error: 'This agreement is not signed here.' }, { status: 400 });
    }
    if (!agreement.onboarding_open) {
      return Response.json(
        { error: 'This agreement is closed for signing. Please contact your manager.' },
        { status: 403 },
      );
    }

    // If they already have a CRM account we simply note which one, so the signed
    // copy is filed against the right person. We do not touch that account, and
    // not having one is fine too.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', cleanEmail)
      .limit(1);
    const profileId = profile && profile.length ? (profile[0].id as string) : null;

    const signatureId = await recordSignature({
      agreement,
      fullName: cleanName,
      email: cleanEmail,
      signaturePng,
      profileId,
      req,
    });
    if (!signatureId) {
      return Response.json({ error: 'Could not save your signature. Please try again.' }, { status: 500 });
    }

    // Their own copy, best effort. A failed send must never lose the signature
    // we have already stored.
    try {
      const sections = agreement.terms
        .map(
          (t) =>
            `<h3 style="font-size:15px;margin:16px 0 4px">${esc(t.heading)}</h3>` +
            `<p style="margin:0;color:#46514B;font-size:14px">${esc(t.body)}</p>`,
        )
        .join('');
      const signedOn = new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1A1A1A;line-height:1.6">
        <h2 style="font-weight:800;margin-bottom:4px">${esc(agreement.title)}</h2>
        <p style="color:#6B7280;font-size:13px;margin:0 0 16px">Signed by ${esc(cleanName)} on ${esc(signedOn)}. Keep this email as your copy.</p>
        <p style="color:#46514B;font-size:14px">${esc(agreement.intro)}</p>
        ${sections}
        <p style="color:#9CA3AF;font-size:12px;margin-top:22px">${esc(agreement.company)}. Any questions, just reply to this email.</p>
      </div>`;
      await sendEmail(cleanEmail, `Your signed working agreement with ${agreement.company}`, html);
    } catch (mailErr) {
      console.error('[agent-onboarding/sign-only] copy email failed:', mailErr);
    }

    return Response.json({ ok: true, signatureId, hasAccount: !!profileId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
