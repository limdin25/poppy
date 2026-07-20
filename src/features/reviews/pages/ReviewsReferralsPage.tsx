import { useEffect, useState, type FormEvent } from 'react'
import { Gift, Copy, Check } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { SectionCard } from '@/core/ui/SectionCard'
import { EmptyState } from '@/core/ui/EmptyState'
import { useReviewsSession, reviewsApi, fmtDate } from '../lib'

interface Referral {
  id: string
  invitee_name: string | null
  invitee_email: string | null
  status: string
  created_at: string
  rewarded_at: string | null
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  invited: { label: 'Invited', tone: 'bg-border/50 text-ink-subtle' },
  signed_up: { label: 'Signed up', tone: 'bg-blue-100 text-blue-700' },
  paid: { label: 'First payment made', tone: 'bg-amber-100 text-amber-700' },
  rewarded: { label: '£100 sent 🎉', tone: 'bg-emerald-100 text-emerald-700' },
}

export default function ReviewsReferralsPage() {
  const session = useReviewsSession()
  const [link, setLink] = useState('')
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    reviewsApi<{ referralLink: string; referrals: Referral[] }>('/api/reviews/referrals', { impersonateBusinessId: imp })
      .then((out) => { setLink(out.referralLink); setReferrals(out.referrals) })
      .catch((e) => setMsg((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await reviewsApi('/api/reviews/referrals', { body: { name, email }, impersonateBusinessId: imp })
      setReferrals((prev) => [{ id: crypto.randomUUID(), invitee_name: name, invitee_email: email, status: 'invited', created_at: new Date().toISOString(), rewarded_at: null }, ...prev])
      setMsg(`Invitation sent to ${email}`)
      setName(''); setEmail('')
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Refer a friend</h1>
        <p className="text-sm text-ink-subtle">Give £100, get £100</p>
      </div>

      <div className="rounded-2xl bg-gradient-to-r from-brand to-brand-600 p-6 text-white">
        <div className="flex items-center gap-3">
          <Gift style={{ width: 28, height: 28 }} />
          <div>
            <p className="text-lg font-semibold">Give £100, Get £100</p>
            <p className="text-sm text-white/85">
              Know a business that could use more reviews? When they complete their first paid month, you BOTH
              get a £100 gift card.
            </p>
          </div>
        </div>
      </div>

      <SectionCard title="Your referral link">
        <div className="flex gap-2">
          <Input value={link} readOnly className="text-xs" />
          <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Invite a friend">
        <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Friend's name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="email" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" disabled={busy || !email}>Send invitation</Button>
        </form>
      </SectionCard>

      <SectionCard title="Your referrals">
        {referrals.length === 0 ? (
          <EmptyState title="No referrals yet" description="Share your link or invite a friend above to start earning." className="py-8" />
        ) : (
          <div className="divide-y divide-border/60">
            {referrals.map((r) => {
              const s = STATUS_LABELS[r.status] ?? STATUS_LABELS.invited
              return (
                <div key={r.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-ink">{r.invitee_name || r.invitee_email}</p>
                    <p className="text-xs text-ink-subtle">{r.invitee_email} · {fmtDate(r.created_at)}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.tone}`}>{s.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
    </div>
  )
}
