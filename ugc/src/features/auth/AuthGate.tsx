// Sign in / sign up, white and minimal. In mock mode the gate does not exist.

import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';

export function AuthGate({ children }: { children: ReactNode }) {
  const client = supabase();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(client === null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [client]);

  if (!client) return children;
  if (!ready) return null;
  if (session) return children;

  const submit = async () => {
    if (busy || !email || !password) return;
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
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <h1 className="text-lg font-extrabold tracking-tight text-ink">UGC Factory</h1>
        <p className="mb-5 text-[12px] text-ink-muted">
          {mode === 'signin' ? 'Welcome back.' : 'Create your account.'}
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
            className="w-full rounded-btn bg-ink py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
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
    </div>
  );
}

// The buy button used on the projects page in http mode.
export async function startCheckout(): Promise<void> {
  const client = supabase();
  if (!client) return;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  const r = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await r.json()) as { url?: string; error?: string };
  if (body.url) window.location.href = body.url;
}
