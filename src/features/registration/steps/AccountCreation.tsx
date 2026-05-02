import { useState } from 'react'
import { User, Mail, ShieldCheck, Star, Clock } from 'lucide-react'

interface Props {
  businessName: string
  onSubmit: (name: string, email: string) => void
}

export default function AccountCreation({ businessName, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setSubmitting(true)
    // TODO: API call to register
    setTimeout(() => onSubmit(name, email), 1500)
  }

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="text-2xl font-semibold text-ink">
        Poppy's almost ready to take your calls
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Complete your registration to activate Poppy for{' '}
        <span className="font-medium text-ink">{businessName}</span>
      </p>

      {/* Trust bullets */}
      <div className="mt-6 space-y-3">
        {[
          { icon: Clock, text: 'Grow your business while Poppy answers calls 24/7' },
          { icon: ShieldCheck, text: 'Free for the first 7 days, no credit card required' },
          { icon: Star, text: 'Our support team is here for you and ready to help' },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3">
            <Icon size={18} className="shrink-0 text-brand" />
            <span className="text-[14px] text-ink-muted">{text}</span>
          </div>
        ))}
      </div>

      {/* Testimonial */}
      <div className="mt-6 rounded-xl border border-border bg-elevated/50 p-4">
        <p className="text-[13px] italic text-ink-muted">
          "Poppy just works. Setup was fast and it sounds so real, customers
          think it's an actual receptionist."
        </p>
        <p className="mt-2 text-[12px] font-medium text-ink-subtle">
          — BlueTap Plumbing, Essex
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label className="text-[13px] font-medium text-ink">Your name</label>
          <div className="relative mt-1.5">
            <User
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink">
            Email address
          </label>
          <div className="relative mt-1.5">
            <Mail
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.co.uk"
              required
              className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!name.trim() || !email.trim() || submitting}
          className="h-12 w-full rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition-all hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Creating account...
            </span>
          ) : (
            'Try Poppy Now'
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] text-ink-subtle">
        By creating an account, you agree with our Privacy Policy and Terms of
        Service
      </p>
    </div>
  )
}
