import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Public agent onboarding — the link an admin sends to a new hire.
 *
 * Flow (one page, staged):
 *   1. sign   — read the agreement, type name, draw a signature
 *   2. email  — enter email → we email a 6-digit code (POST /sign)
 *   3. verify — enter the code + choose a password → account created (POST /verify)
 *   4. done   — log into the CRM
 *
 * Renders outside the app Layout (no auth). The agreement text + the open/closed
 * gate come from /api/agent-onboarding/config, which reads the admin-editable
 * wk_agent_agreement row.
 */

interface Term {
  heading: string;
  body: string;
}
interface Agreement {
  title: string;
  intro: string;
  terms: Term[];
  company: string;
}

type Stage = 'loading' | 'closed' | 'sign' | 'email' | 'verify' | 'done';

export default function AgentJoinPage() {
  const [stage, setStage] = useState<Stage>('loading');
  const [agreement, setAgreement] = useState<Agreement | null>(null);

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

  useEffect(() => {
    document.title = 'Join the team | HeyElsie';
    fetch('/api/agent-onboarding/config')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setStage('closed'); return; }
        setAgreement(j.agreement);
        setStage(j.open ? 'sign' : 'closed');
      })
      .catch(() => setStage('closed'));
  }, []);

  // Signature pad — only mounted during the sign stage.
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

  const goEmail = () => {
    setError(null);
    if (!name.trim()) { setError('Please type your full name.'); return; }
    if (!hasInk) { setError('Please sign in the box.'); return; }
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
      const png = canvasRef.current?.toDataURL('image/png') ?? null;
      const res = await fetch('/api/agent-onboarding/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), signaturePng: png }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not send the code.'); return; }
      setSignupId(j.signupId);
      setStage('verify');
    } catch {
      setError('Network error — please try again.');
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
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const company = agreement?.company || 'HeyElsie';

  return (
    <div className="min-h-screen bg-[#F7F7F4] text-[#1A1A1A]">
      <header className="bg-white border-b border-[#E5E7EB]">
        <div className="max-w-[760px] mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-[9px] bg-[#3C5A87] text-white grid place-items-center font-extrabold">H</span>
            <span className="font-extrabold text-[17px]">{company}</span>
          </div>
          <span className={`text-[12px] font-semibold px-3 py-1 rounded-full ${stage === 'done' ? 'bg-[#DEF3E8] text-[#2E7D5B]' : 'bg-[#EEF2F8] text-[#3C5A87]'}`}>
            {stage === 'done' ? 'Done' : 'Join the team'}
          </span>
        </div>
      </header>

      <main className="max-w-[760px] mx-auto px-5 py-8 pb-24">
        {stage === 'loading' && (
          <div className="text-center py-24 text-[#6B7280]">Loading…</div>
        )}

        {stage === 'closed' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center">
            <h1 className="text-[22px] font-extrabold mb-2">Onboarding is closed</h1>
            <p className="text-[#6B7280] text-[15px]">
              We&apos;re not taking new agents through this link right now. Please contact your manager.
            </p>
          </div>
        )}

        {stage === 'sign' && agreement && (
          <>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight mb-1.5">{agreement.title}</h1>
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
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={goEmail}
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
            <h1 className="text-[22px] font-extrabold mb-1.5">What&apos;s your email?</h1>
            <p className="text-[#6B7280] text-[14px] mb-5">We&apos;ll send you a 6-digit code to confirm it. This becomes your CRM login.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void sendCode()}
              placeholder="you@example.com"
              className="w-full h-12 px-4 border border-[#E5E7EB] rounded-xl text-[15px] mb-3 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
            />
            {error && <p className="text-[13px] text-[#B42318] mb-3">{error}</p>}
            <button
              onClick={() => void sendCode()}
              disabled={busy}
              className="w-full bg-[#3C5A87] text-white font-semibold text-[15px] py-3 rounded-xl hover:bg-[#33507a] disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
            <button onClick={() => { setError(null); setStage('sign'); }} className="w-full text-[13px] text-[#6B7280] mt-3 hover:text-[#1A1A1A]">
              ← Back to the agreement
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
              {busy ? 'Creating your account…' : 'Create my account'}
            </button>
            <button onClick={() => { setError(null); void sendCode(); }} disabled={busy} className="w-full text-[13px] text-[#6B7280] mt-3 hover:text-[#1A1A1A] disabled:opacity-60">
              Didn&apos;t get it? Resend code
            </button>
          </div>
        )}

        {stage === 'done' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-[#DEF3E8] text-[#2E7D5B] grid place-items-center text-3xl mx-auto mb-5">✓</div>
            <h1 className="text-[24px] font-extrabold mb-2">You&apos;re in, {name.split(' ')[0]}!</h1>
            <p className="text-[#6B7280] text-[15px] mb-6">
              Your agent account is ready. Log in with <strong className="text-[#1A1A1A]">{email}</strong> and the password you just set.
            </p>
            <Link
              to="/login"
              className="inline-block bg-[#3C5A87] text-white font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-[#33507a]"
            >
              Log into the CRM
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
