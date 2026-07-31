// Session gate: signed-out visitors get the landing page (which hosts the
// sign-in card); signed-in users get the app. In mock mode the gate does not
// exist and the app renders directly.

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';

const LandingPage = lazy(() => import('../landing/LandingPage'));

export function AuthGate({ children }: { children: ReactNode }) {
  const client = supabase();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(client === null);

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

  return (
    <Suspense fallback={null}>
      <LandingPage />
    </Suspense>
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
