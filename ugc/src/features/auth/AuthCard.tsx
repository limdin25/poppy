// The sign in / sign up form, extracted so the landing page can host it.

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export function AuthCard() {
  const client = supabase();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!client || busy || !email || !password) return;
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'signup') {
        const { error } = await client.auth.signUp({ email, password });
        setMessage(error ? error.message : 'Check your inbox to confirm your email, then sign in.');
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) setMessage(error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-2xl border border-hairline bg-white p-6 shadow-card">
      <p className="mb-1 text-[15px] font-extrabold tracking-tight text-ink">
        {mode === 'signin' ? 'Welcome back' : 'Create your account'}
      </p>
      <p className="mb-5 text-[12px] text-ink-muted">
        {mode === 'signin' ? 'Sign in to open your ads.' : 'Two photos away from your first ad.'}
      </p>
      <div className="space-y-2.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full rounded-slot border border-hairline px-3 py-2.5 text-[13px] outline-none focus:border-live"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="Password"
          className="w-full rounded-slot border border-hairline px-3 py-2.5 text-[13px] outline-none focus:border-live"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="w-full rounded-btn bg-ink py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-40"
        >
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        {message && <p className="text-[11px] text-ink-muted">{message}</p>}
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="w-full pt-1 text-[11px] font-semibold text-live"
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
