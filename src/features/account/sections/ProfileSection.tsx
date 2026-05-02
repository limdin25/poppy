import { useState } from 'react'
import { User, Mail, Lock } from 'lucide-react'

export default function ProfileSection() {
  const [name, setName] = useState('Hugo de Souza')
  const [email, setEmail] = useState('hugo@smithplumbing.co.uk')
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Personal Details</h2>

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
          className="mt-4 h-10 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600"
        >
          {saved ? '✓ Saved' : 'Save changes'}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Password</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          You signed up with a magic link. Set a password if you'd prefer to log in that way.
        </p>
        <button className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-muted transition hover:bg-elevated">
          <Lock size={14} />
          Set password
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
