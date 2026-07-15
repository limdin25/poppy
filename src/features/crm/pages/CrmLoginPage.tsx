// CrmLoginPage — dedicated agent sign-in at /crm/login.
//
// Hugo 2026-04-27 (PR 45): rather than send agents to the regular
// /signin page (which has social login, account-creation links, the
// password-seed dance for Particle users, etc.), CRM agents get a
// purpose-built screen: just email + password + sign-in. Whatever
// the admin typed when inviting them in /crm/settings → Agents is
// what they paste in here.
//
// On success: bounce to /admin/crm/inbox (or whatever the location.state
// redirected from). CrmGuard takes over from there.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Loader2, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

export default function CrmLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CrmGuard stamps location.state.from = the path the agent tried to
  // open. Fall back to /admin/crm/inbox so a clean visit to the login
  // page still lands somewhere useful.
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/admin/crm/inbox';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password required.');
      return;
    }
    setSubmitting(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInErr) {
      setError(signInErr.message || 'Sign-in failed. Check your credentials.');
      setSubmitting(false);
      return;
    }
    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F3F3EE] px-4">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-6">
          <Link to="/admin/crm" className="inline-flex items-center gap-2 mb-5">
            <span className="text-[22px] font-semibold tracking-tight">Elsie</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#1E9A80] bg-[#ECFDF5] rounded-[6px] px-1.5 py-0.5">CRM</span>
          </Link>
          <h1 className="text-[22px] font-bold text-[#0A0A0A] tracking-tight">CRM agent sign-in</h1>
          <p className="text-[13px] text-[#737373] mt-1">
            Use the email and password your admin gave you.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white border border-[#E8E5DF] rounded-[20px] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.05)] space-y-4"
        >
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#525252]">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourcompany.com"
                className="w-full pl-10 pr-3 py-2 text-[14px] bg-white border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/40 focus:border-[#1E9A80]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[#525252]">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password from your admin"
                className="w-full pl-10 pr-10 py-2 text-[14px] bg-white border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/40 focus:border-[#1E9A80]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A1A1A]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#1E9A80] text-white text-[14px] font-semibold py-2.5 rounded-[10px] shadow-[0_4px_16px_rgba(30,154,128,0.35)] hover:bg-[#1E9A80]/90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="text-[11px] text-[#737373] text-center pt-2">
            Forgot your password? Ask your admin to reset it from CRM → Settings → Agents.
          </div>
        </form>

        <div className="text-center mt-5 text-[12px] text-[#737373]">
          Not an agent?{' '}
          <Link to="/signin" className="text-[#1E9A80] font-semibold hover:underline">
            Use the regular sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
