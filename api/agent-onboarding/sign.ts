import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { hashOnboardingCode, genOnboardingCode } from '../lib/onboarding.js';

export const config = { runtime: 'edge' };

/**
 * Public step 1: the new hire has read + signed the agreement and given their
 * name + email. We store the signup, generate a 6-digit code, email it, and
 * return the signup id so step 2 (verify) can create the account.
 *
 * Guards: onboarding must be open; an email that already has an agent account
 * is bounced to the login instead of being re-onboarded.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { name, email, signaturePng } = (await req.json()) as {
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

    // Onboarding open?
    const { data: agr } = await supabaseAdmin
      .from('wk_agent_agreement')
      .select('onboarding_open, company')
      .eq('id', 1)
      .single();
    if (agr && agr.onboarding_open === false) {
      return Response.json(
        { error: 'Onboarding is currently closed. Please contact your manager.' },
        { status: 403 },
      );
    }
    const company = agr?.company || 'HeyElsie';

    // Never onboard an email that already has an account — an existing agent, or
    // a business owner logging in with their real email. They should sign in, not
    // create a second identity (and we must never touch their existing account).
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', cleanEmail)
      .limit(1);
    const { data: created } = await supabaseAdmin
      .from('wk_agent_signups')
      .select('id')
      .eq('email', cleanEmail)
      .eq('status', 'created')
      .limit(1);
    if ((existingProfile && existingProfile.length) || (created && created.length)) {
      return Response.json(
        { error: 'An account already exists for this email. Please log in instead.' },
        { status: 409 },
      );
    }

    // Clear any earlier in-progress signup for this email so there is one
    // live code per person.
    await supabaseAdmin.from('wk_agent_signups').delete().eq('email', cleanEmail).neq('status', 'created');

    const code = genOnboardingCode();
    const code_hash = await hashOnboardingCode(code, cleanEmail);
    const code_expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data: row, error } = await supabaseAdmin
      .from('wk_agent_signups')
      .insert({
        name: cleanName,
        email: cleanEmail,
        signature_png: signaturePng ?? null,
        status: 'code_sent',
        code_hash,
        code_expires_at,
        attempts: 0,
      })
      .select('id')
      .single();

    if (error || !row) {
      return Response.json({ error: error?.message || 'Could not start onboarding' }, { status: 500 });
    }

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1A1A">
        <h2 style="font-weight:800">Confirm your email</h2>
        <p style="color:#46514B;font-size:15px">Hi ${cleanName.split(' ')[0]}, use this code to finish joining ${company} as an agent:</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#F3F4F6;border-radius:12px;padding:18px;text-align:center;margin:18px 0">${code}</div>
        <p style="color:#6B7280;font-size:13px">This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>
      </div>`;
    await sendEmail(cleanEmail, `Your ${company} verification code`, html);

    return Response.json({ ok: true, signupId: row.id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
