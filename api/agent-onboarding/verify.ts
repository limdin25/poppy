import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { hashOnboardingCode } from '../lib/onboarding.js';

export const config = { runtime: 'edge' };

// New hires always join as a capped 'agent' — never admin, never uncapped.
// This route is public (the hire has no account yet), so the role is hard-
// coded here and can never be escalated from the request body.
const AGENT_DAILY_LIMIT_PENCE = 1000; // £10/day default cap

/**
 * Public step 2: verify the emailed code, then create the CRM agent account
 * (auth user + profiles.workspace_role='agent' + spend-limit row). After this
 * the agent shows in Settings → Agents & spend and can log into the CRM.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { signupId, code, password } = (await req.json()) as {
      signupId?: string;
      code?: string;
      password?: string;
    };
    if (!signupId || !code) return Response.json({ error: 'Missing code' }, { status: 400 });
    if (!password || String(password).length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const { data: s } = await supabaseAdmin
      .from('wk_agent_signups')
      .select('*')
      .eq('id', signupId)
      .single();
    if (!s) return Response.json({ error: 'Onboarding not found. Please start again.' }, { status: 404 });
    if (s.status === 'created') {
      return Response.json({ error: 'This account has already been created. Please log in.' }, { status: 409 });
    }
    if (s.status !== 'code_sent') {
      return Response.json({ error: 'Please request a new code.' }, { status: 400 });
    }
    if (s.code_expires_at && new Date(s.code_expires_at).getTime() < Date.now()) {
      return Response.json({ error: 'Your code has expired. Please start again.' }, { status: 400 });
    }
    if ((s.attempts ?? 0) >= 5) {
      return Response.json({ error: 'Too many attempts. Please start again.' }, { status: 429 });
    }

    const expected = await hashOnboardingCode(String(code), s.email);
    if (expected !== s.code_hash) {
      await supabaseAdmin
        .from('wk_agent_signups')
        .update({ attempts: (s.attempts ?? 0) + 1 })
        .eq('id', signupId);
      return Response.json({ error: 'That code is not right. Please try again.' }, { status: 400 });
    }

    // Defence in depth: onboarding could have been closed after the code was sent.
    const { data: agr } = await supabaseAdmin
      .from('wk_agent_agreement')
      .select('onboarding_open')
      .eq('id', 1)
      .single();
    if (agr && agr.onboarding_open === false) {
      return Response.json({ error: 'Onboarding is currently closed.' }, { status: 403 });
    }

    const email = String(s.email);
    const name = String(s.name);

    // 1) Create the auth user. This is a PUBLIC route, so we NEVER take over an
    //    existing account (doing so would reset its password + role — exactly
    //    what happened when a real owner email was used to test /join). If the
    //    email is already registered, bounce them to the login instead.
    const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      const exists = msg.includes('already') || msg.includes('registered') || msg.includes('exists');
      if (exists) {
        return Response.json(
          { error: 'This email already has an account. Please log in instead.' },
          { status: 409 },
        );
      }
      return Response.json({ error: createErr.message }, { status: 500 });
    }
    const userId = createData.user?.id ?? null;
    if (!userId) return Response.json({ error: 'No user id returned' }, { status: 500 });

    // 2) Profile as a workspace agent.
    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        { id: userId, email, name, workspace_role: 'agent', agent_status: 'offline' },
        { onConflict: 'id' },
      );
    if (profErr) return Response.json({ error: `Profile: ${profErr.message}` }, { status: 500 });

    // 3) Spend-limit row (mirrors wk-create-agent) so they show on the roster.
    const { error: limErr } = await supabaseAdmin
      .from('wk_voice_agent_limits')
      .upsert(
        {
          agent_id: userId,
          daily_limit_pence: AGENT_DAILY_LIMIT_PENCE,
          daily_spend_pence: 0,
          is_admin: false,
          show_on_leaderboard: true,
        },
        { onConflict: 'agent_id' },
      );
    if (limErr) return Response.json({ error: `Limit: ${limErr.message}` }, { status: 500 });

    // 4) Close out the signup (clear the code hash — it's spent).
    await supabaseAdmin
      .from('wk_agent_signups')
      .update({ status: 'created', agent_id: userId, code_hash: null })
      .eq('id', signupId);

    // 5) Welcome email with payment-setup instructions (best-effort — a failed
    //    send must never fail the account creation the hire just completed).
    try {
      const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
      const first = name.split(' ')[0] || name;
      const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A;line-height:1.6">
        <h2 style="font-weight:800;margin-bottom:6px">Welcome to the team, ${first}!</h2>
        <p style="color:#46514B;font-size:15px">Your account is all set up. You can log in any time at
          <a href="${appUrl}/login" style="color:#3C5A87">${appUrl}/login</a> with this email address.</p>

        <h3 style="font-weight:800;font-size:16px;margin:22px 0 6px">Set up your payment so we can pay you</h3>
        <p style="color:#46514B;font-size:15px">Before your first payment, please set up how you would like to be paid. We pay in USD, AUD, CAD, EUR and GBP.</p>
        <p style="color:#46514B;font-size:15px">For employers that pay in these currencies, <strong>OnlineJobs recommends paying with Payoneer</strong>. This is what OnlineJobs explains:</p>
        <ul style="color:#46514B;font-size:15px;padding-left:20px">
          <li>Payoneer has the best foreign currency exchange rates (the actual forex rate plus 2%).</li>
          <li>Transactions are processed quickly, and workers can withdraw funds much faster than PayPal.</li>
        </ul>
        <div style="background:#F3F4F6;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14px;color:#1A1A1A">
          <strong>OnlineJobs special bonus:</strong> workers receive a free $75 USD signup bonus from Payoneer when they register for a new Payoneer account through OnlineJobs, and receive a total of $1,000 in transfers.
        </div>
        <p style="color:#46514B;font-size:15px">Once your Payoneer account is ready, just <strong>reply to this email with the email address on your Payoneer account</strong> and we will link it up. As soon as you are set up, we can pay you.</p>

        <p style="color:#46514B;font-size:15px">A quick reminder on payments: each work week closes on Friday and your salary lands within 72 hours, so expect it Monday morning before your shift. Your commission is separate and is paid within 7 days of each client's first payment clearing.</p>
        <p style="color:#6B7280;font-size:13px;margin-top:18px">Glad to have you on board. Any questions, just reply here.</p>
      </div>`;
      await sendEmail(email, 'Welcome to HeyElsie, set up your payment to get paid', html);
    } catch (mailErr) {
      console.error('[agent-onboarding/verify] welcome email failed:', mailErr);
    }

    return Response.json({ ok: true, email });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
