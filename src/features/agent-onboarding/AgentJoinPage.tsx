import { useEffect, useRef, useState } from 'react';
import { downloadSignedAgreement } from '@/core/agreements/signedAgreementDoc';

// The CRM login always lives on the app origin, even when this page is served
// from go.heyelsie.com. Absolute so it works from either host.
const CRM_LOGIN_URL = 'https://app.heyelsie.com/login';

/**
 * Public agent onboarding, the link an admin sends to a new hire.
 *
 * One page, two modes, decided by the agreement itself:
 *
 *   mode 'account'   (/join, the B2B Sales Closer agreement)
 *     1. sign    read the agreement, type name, draw a signature
 *     2. confirm a pop-up of tick-box acknowledgements so there is no way they
 *                did not read it
 *     3. email   enter email, we email a 6-digit code (POST /sign)
 *     4. verify  enter the code + choose a password, account created (POST /verify)
 *     5. done    download the signed agreement + log into the CRM
 *
 *   mode 'sign_only' (/join/property, for somebody who already works here and
 *                     already has a CRM login)
 *     1. sign    same
 *     2. confirm same
 *     3. email   confirm their email and submit (POST /sign-only)
 *     4. done    download the signed agreement
 *     No password, no 6-digit code, and no account is created or changed.
 *
 * The role comes from the URL: /join/<slug>. Plain /join is the original
 * agreement and is unchanged.
 *
 * Renders outside the app Layout (no auth) and uses no router, so the slug is
 * read straight off the pathname (go.heyelsie.com serves this page without a
 * Router around it).
 */

interface Term {
  heading: string;
  body: string;
}
interface Agreement {
  slug: string;
  roleLabel: string | null;
  title: string;
  intro: string;
  terms: Term[];
  acks: string[];
  company: string;
  mode: 'account' | 'sign_only';
  version: number;
}

type Stage = 'loading' | 'closed' | 'sign' | 'email' | 'verify' | 'done';

// Fallback acknowledgements for the original agreement, used only if the row
// has none stored. The live tick boxes come from the agreement itself, so each
// role confirms its own terms.
const ACKS = [
  'I understand the working hours: Monday to Friday, 10:00am to 6:00pm UK time, with a 1 hour break.',
  "I understand my pay: a weekly salary paid on Monday, plus 50% commission on each client's first month.",
  'I understand I must tell my manager every time I go on a break and again when I come back, and that three strikes can end my role.',
  "I understand my first week is a paid trial, and after the trial either side gives one week's notice.",
  'I understand I am responsible for my own taxes and equipment, and I will keep everything confidential.',
];

/** /join → null, /join/property → "property". */
function slugFromPath(): string | null {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const m = path.match(/^\/join\/([a-z0-9][a-z0-9-]*)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

export default function AgentJoinPage() {
  const [stage, setStage] = useState<Stage>('loading');
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [signupId, setSignupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // Captured when the acknowledgements are confirmed, so they survive to the
  // email/verify/done stages (the canvas is unmounted after the sign stage).
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [signedAt, setSignedAt] = useState<Date | null>(null);

  // Acknowledgement pop-up.
  const [showAck, setShowAck] = useState(false);
  const [acks, setAcks] = useState<boolean[]>([]);

  const signOnly = agreement?.mode === 'sign_only';
  const ackList = agreement && agreement.acks.length ? agreement.acks : ACKS;

  useEffect(() => {
    // Neutral until the agreement says which company it is, so the property
    // page never flashes the wrong name in the tab.
    document.title = 'Join the team';
    const slug = slugFromPath();
    fetch(`/api/agent-onboarding/config${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`)
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
      .then(({ status, body }) => {
        if (status === 404) { setNotFound(true); setStage('closed'); return; }
        if (!body?.ok) { setStage('closed'); return; }
        setAgreement(body.agreement);
        // The company differs per role (HeyElsie for sales, Unico for property).
        if (body.agreement?.company) document.title = `Join the team | ${body.agreement.company}`;
        setStage(body.open ? 'sign' : 'closed');
      })
      .catch(() => setStage('closed'));
  }, []);

  // Signature pad, only mounted during the sign stage.
  useEffect(() => {
    if (stage !== 'sign') return;
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1A1A1A';
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => { drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasInk(true);
    };
    const up = () => { drawing.current = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [stage]);

  const clearSig = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  // "Sign & continue" opens the acknowledgement pop-up (does not advance yet).
  const openAck = () => {
    setError(null);
    if (!name.trim()) { setError('Please type your full name.'); return; }
    if (!hasInk) { setError('Please sign in the box.'); return; }
    setAcks(Array(ackList.length).fill(false));
    setShowAck(true);
  };

  // Confirming the pop-up finalises the signature and moves to the email step.
  const confirmAck = () => {
    const png = canvasRef.current?.toDataURL('image/png') ?? null;
    setSignaturePng(png);
    setSignedAt(new Date());
    setShowAck(false);
    setError(null);
    setStage('email');
  };

  const sendCode = async () => {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Please enter a valid email.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/agent-onboarding/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: agreement?.slug, name: name.trim(), email: email.trim(), signaturePng }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not send the code.'); return; }
      setSignupId(j.signupId);
      setStage('verify');
    } catch {
      setError('Network error, please try again.');
    } finally {
      setBusy(false);
    }
  };

  // sign_only: record the signature against the agreement and stop. No account
  // is created, and an email that already has one is fine.
  const submitSignature = async () => {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Please enter a valid email.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/agent-onboarding/sign-only', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: agreement?.slug, name: name.trim(), email: email.trim(), signaturePng }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not save your signature.'); return; }
      setStage('done');
      window.scrollTo(0, 0);
    } catch {
      setError('Network error, please try again.');
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async () => {
    setError(null);
    if (code.trim().length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/agent-onboarding/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signupId, code: code.trim(), password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not create your account.'); return; }
      setStage('done');
      window.scrollTo(0, 0);
    } catch {
      setError('Network error, please try again.');
    } finally {
      setBusy(false);
    }
  };

  // A self-contained signed copy the worker can keep (opens + prints to PDF).
  const downloadAgreement = () => {
    if (!agreement) return;
    downloadSignedAgreement({
      company: agreement.company,
      title: agreement.title,
      intro: agreement.intro,
      terms: agreement.terms,
      acks: ackList,
      fullName: name,
      email,
      signedAt: signedAt ?? new Date(),
      signaturePng,
      slug: agreement.slug,
      version: agreement.version,
    });
  };

  const company = agreement?.company || 'HeyElsie';
  // The badge follows the company on the agreement, so the property page reads
  // U for Unico rather than the HeyElsie H.
  const companyInitial = company.trim().charAt(0).toUpperCase() || 'H';
  const allAcked = acks.length > 0 && acks.every(Boolean);

  return (
    <div className="min-h-screen bg-[#F7F7F4] text-[#1A1A1A]">
      <header className="bg-white border-b border-[#E5E7EB]">
        <div className="max-w-[760px] mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-[9px] bg-[#3C5A87] text-white grid place-items-center font-extrabold">{companyInitial}</span>
            <span className="font-extrabold text-[17px]">{company}</span>
          </div>
          <span className={`text-[12px] font-semibold px-3 py-1 rounded-full ${stage === 'done' ? 'bg-[#DEF3E8] text-[#2E7D5B]' : 'bg-[#EEF2F8] text-[#3C5A87]'}`}>
            {stage === 'done' ? 'Done' : 'Join the team'}
          </span>
        </div>
      </header>

      <main className="max-w-[760px] mx-auto px-5 py-8 pb-24">
        {stage === 'loading' && (
          <div className="text-center py-24 text-[#6B7280]">Loading</div>
        )}

        {stage === 'closed' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center">
            <h1 className="text-[22px] font-extrabold mb-2">
              {notFound ? 'This link is not active' : 'Onboarding is closed'}
            </h1>
            <p className="text-[#6B7280] text-[15px]">
              {notFound
                ? 'There is no agreement at this address. Please check the link your manager sent you.'
                : 'We are not taking new agents through this link right now. Please contact your manager.'}
            </p>
          </div>
        )}

        {stage === 'sign' && agreement && (
          <>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight mb-1.5">{agreement.title}</h1>
            {agreement.roleLabel && (
              <div className="inline-block text-[12px] font-semibold text-[#3C5A87] bg-[#EEF2F8] px-3 py-1 rounded-full mb-3">
                {agreement.roleLabel}
              </div>
            )}
            <p className="text-[#46514B] text-[15px] mb-6">{agreement.intro}</p>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 space-y-4">
              {agreement.terms.map((t, i) => (
                <div key={i}>
                  <h2 className="text-[16px] font-bold mb-1">{t.heading}</h2>
                  <p className="text-[14px] text-[#46514B] leading-relaxed">{t.body}</p>
                </div>
              ))}
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 mt-4 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold mb-1.5">Your full name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full h-12 px-4 border border-[#E5E7EB] rounded-xl text-[15px] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5">Sign here</label>
                <canvas
                  ref={canvasRef}
                  className="w-full h-40 bg-white border border-dashed border-[#3C5A87]/60 rounded-xl touch-none cursor-crosshair block"
                />
                <p className="text-[12px] text-[#9CA3AF] mt-1.5 sm:hidden">Draw your signature with your finger.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={openAck}
                  className="bg-[#3C5A87] text-white font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-[#33507a]"
                >
                  Sign &amp; continue
                </button>
                <button onClick={clearSig} className="text-[14px] text-[#6B7280] px-3 py-2 rounded-xl border border-[#E5E7EB] hover:bg-[#F3F3EE]">
                  Clear
                </button>
              </div>
              {error && <p className="text-[13px] text-[#B42318]">{error}</p>}
              <p className="text-[12px] text-[#9CA3AF]">By signing you agree to the terms above.</p>
            </div>
          </>
        )}

        {stage === 'email' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 max-w-md mx-auto">
            <h1 className="text-[22px] font-extrabold mb-1.5">
              {signOnly ? 'Confirm your email' : 'What is your email?'}
            </h1>
            <p className="text-[#6B7280] text-[14px] mb-5">
              {signOnly
                ? 'We will file your signed agreement against this address and send you a copy to keep.'
                : 'We will send you a 6-digit code to confirm it. This becomes your CRM login.'}
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void (signOnly ? submitSignature() : sendCode())}
              placeholder="you@example.com"
              className="w-full h-12 px-4 border border-[#E5E7EB] rounded-xl text-[15px] mb-3 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
            />
            {error && <p className="text-[13px] text-[#B42318] mb-3">{error}</p>}
            <button
              onClick={() => void (signOnly ? submitSignature() : sendCode())}
              disabled={busy}
              className="w-full bg-[#3C5A87] text-white font-semibold text-[15px] py-3 rounded-xl hover:bg-[#33507a] disabled:opacity-60"
            >
              {signOnly
                ? (busy ? 'Saving your signature' : 'Submit my signed agreement')
                : (busy ? 'Sending' : 'Send code')}
            </button>
            <button onClick={() => { setError(null); setStage('sign'); }} className="w-full text-[13px] text-[#6B7280] mt-3 hover:text-[#1A1A1A]">
              Back to the agreement
            </button>
          </div>
        )}

        {stage === 'verify' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 max-w-md mx-auto">
            <h1 className="text-[22px] font-extrabold mb-1.5">Check your email</h1>
            <p className="text-[#6B7280] text-[14px] mb-5">
              We sent a 6-digit code to <strong className="text-[#1A1A1A]">{email}</strong>. Enter it below and choose a password.
            </p>
            <label className="block text-[13px] font-semibold mb-1.5">6-digit code</label>
            <input
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className="w-full h-12 px-4 border border-[#E5E7EB] rounded-xl text-[18px] tracking-[6px] font-mono text-center mb-4 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
            />
            <label className="block text-[13px] font-semibold mb-1.5">Choose a password</label>
            <div className="relative mb-4">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void createAccount()}
                placeholder="At least 8 characters"
                className="w-full h-12 px-4 pr-16 border border-[#E5E7EB] rounded-xl text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#6B7280] hover:text-[#1A1A1A]"
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
            {error && <p className="text-[13px] text-[#B42318] mb-3">{error}</p>}
            <button
              onClick={() => void createAccount()}
              disabled={busy}
              className="w-full bg-[#3C5A87] text-white font-semibold text-[15px] py-3 rounded-xl hover:bg-[#33507a] disabled:opacity-60"
            >
              {busy ? 'Creating your account' : 'Create my account'}
            </button>
            <button onClick={() => { setError(null); void sendCode(); }} disabled={busy} className="w-full text-[13px] text-[#6B7280] mt-3 hover:text-[#1A1A1A] disabled:opacity-60">
              Did not get it? Resend code
            </button>
          </div>
        )}

        {stage === 'done' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-[#DEF3E8] text-[#2E7D5B] grid place-items-center text-3xl mx-auto mb-5">✓</div>
            <h1 className="text-[24px] font-extrabold mb-2">
              {signOnly ? `Thank you, ${name.split(' ')[0]}!` : `You are in, ${name.split(' ')[0]}!`}
            </h1>
            <p className="text-[#6B7280] text-[15px] mb-6">
              {signOnly ? (
                <>
                  Your signed agreement is saved and a copy is on its way to{' '}
                  <strong className="text-[#1A1A1A]">{email}</strong>. Nothing else to do, carry on in the CRM
                  with the login you already use.
                </>
              ) : (
                <>
                  Your agent account is ready. Log in with <strong className="text-[#1A1A1A]">{email}</strong> and the password you just set.
                </>
              )}
            </p>
            <div className="flex flex-col gap-2.5">
              <a
                href={CRM_LOGIN_URL}
                className="inline-block bg-[#3C5A87] text-white font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-[#33507a]"
              >
                {signOnly ? 'Go to the CRM' : 'Log into the CRM'}
              </a>
              <button
                onClick={downloadAgreement}
                className="inline-block border border-[#E5E7EB] text-[#1A1A1A] font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-[#F3F3EE]"
              >
                Download your signed agreement
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Acknowledgement pop-up, shown before the signature is finalised. */}
      {showAck && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[20px] font-extrabold mb-1">Before you sign</h2>
            <p className="text-[#6B7280] text-[14px] mb-4">Please tick each box to confirm you have read and understood.</p>
            <div className="space-y-2.5">
              {ackList.map((label, i) => (
                <label key={i} className="flex items-start gap-3 p-3 border border-[#E5E7EB] rounded-xl cursor-pointer hover:bg-[#F9FAFB]">
                  <input
                    type="checkbox"
                    checked={acks[i] ?? false}
                    onChange={(e) => setAcks(acks.map((v, j) => (j === i ? e.target.checked : v)))}
                    className="mt-0.5 w-5 h-5 accent-[#3C5A87] flex-shrink-0"
                  />
                  <span className="text-[14px] text-[#1A1A1A] leading-snug">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[#E5E7EB]">
              <button
                onClick={confirmAck}
                disabled={!allAcked}
                className="flex-1 bg-[#3C5A87] text-white font-semibold text-[15px] py-3 rounded-xl hover:bg-[#33507a] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                I understand, complete my signature
              </button>
              <button onClick={() => setShowAck(false)} className="text-[14px] text-[#6B7280] px-4 py-3 rounded-xl hover:bg-[#F3F3EE]">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
