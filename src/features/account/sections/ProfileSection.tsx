import { useState, useEffect } from 'react'
import { User, Mail, Lock, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'

export default function ProfileSection() {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) {
      setName(user.user_metadata?.name || '')
      setEmail(user.email || '')
    }
  }, [user])

  async function handleSave() {
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({
      email: email !== user?.email ? email : undefined,
      data: { name },
    })
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Personal Details</h2>

        {error && (
          <div className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-[13px] text-danger">{error}</div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[13px] font-medium text-ink">Full name</label>
            <div className="relative mt-1.5">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Email address</label>
            <div className="relative mt-1.5">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saved ? 'Saved!' : 'Save changes'}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Password</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Change your password or set one if you signed up with a magic link.
        </p>
        <button
          onClick={() => {
            supabase.auth.resetPasswordForEmail(email, {
              redirectTo: `${window.location.origin}/reset-password`,
            })
          }}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-muted transition hover:bg-elevated"
        >
          <Lock size={14} />
          Send password reset email
        </button>
      </div>

      <div className="rounded-xl border border-danger/20 bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-danger">Danger Zone</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Permanently delete your account and all associated data.
        </p>
        <button className="mt-4 h-10 rounded-lg border border-danger/30 px-4 text-[13px] font-medium text-danger transition hover:bg-danger/5">
          Delete account
        </button>
      </div>
    </div>
  )
}
