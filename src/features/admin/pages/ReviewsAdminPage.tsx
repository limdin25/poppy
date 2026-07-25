// /super Reviews — every review client, sender-number purchases (manual, admin
// only), referral payouts, and the closer's onboard-a-client flow.

import { useState } from 'react'
import { Star, Phone, Gift, UserPlus, ExternalLink, Copy, Check, Pencil, KeyRound, Mail } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { Select } from '@/core/ui/Select'
import { Switch } from '@/core/ui/Switch'
import { Dialog } from '@/core/ui/Dialog'
import { useAdminApi } from '../hooks/useAdminApi'

type Tab = 'clients' | 'numbers' | 'referrals'

interface Client {
  id: string
  name: string
  owner: { email: string; name: string } | null
  plan: string | null
  billing_status: string | null
  cap: number
  used: number
  gbp_status: string
  rating: number | null
  total_reviews: number | null
  sms_from_number: string | null
  sending_paused: boolean
  attested: boolean
  pending_replies: number
  pending_number_request: boolean
}
interface Plan { key: string; name: string; priceGbp: number; paymentLink: string }
interface NumberRequest { id: string; business_id: string; business_name: string; status: string; note: string | null; purchased_number: string | null; created_at: string }
interface Referral { id: string; referrer_name: string; invitee_email: string | null; invitee_business_name: string | null; status: string; created_at: string }
interface ClientDetail {
  business: { id: string; name: string; plan: string | null; billing_status: string | null }
  owner: { user_id: string | null; email: string | null; name: string | null }
  settings: Record<string, unknown>
  plans: Array<{ key: string; name: string; priceGbp: number }>
}
interface EditForm { business_name: string; owner_name: string; owner_email: string; plan: string; settings: Record<string, unknown> }

export default function ReviewsAdminPage() {
  const { session } = useAuth()
  const [tab, setTab] = useState<Tab>('clients')
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const clients = useAdminApi<{ clients: Client[]; plans: Plan[] }>('reviews', { clients: [], plans: [] })
  const numbers = useAdminApi<{ requests: NumberRequest[] }>('reviews/numbers', { requests: [] })
  const referrals = useAdminApi<{ referrals: Referral[] }>('reviews/referrals', { referrals: [] })

  // Onboard form
  const [obBusiness, setObBusiness] = useState('')
  const [obName, setObName] = useState('')
  const [obEmail, setObEmail] = useState('')
  const [obPlan, setObPlan] = useState('reviews_starter')
  const [obResult, setObResult] = useState<{ paymentLink: string; setPasswordLink: string | null } | null>(null)

  // Edit-client dialog
  const [editId, setEditId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editBusy, setEditBusy] = useState<string | null>(null)
  const [editMsg, setEditMsg] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>({ business_name: '', owner_name: '', owner_email: '', plan: '', settings: {} })
  const [newPw, setNewPw] = useState('')
  const [resetLink, setResetLink] = useState<string | null>(null)

  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`/api/admin/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error || `Failed (${res.status})`)
    return json as Record<string, unknown>
  }

  async function get(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`/api/admin/${path}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error || `Failed (${res.status})`)
    return json as Record<string, unknown>
  }

  async function openEdit(c: Client) {
    setEditId(c.id); setDetail(null); setEditMsg(null); setNewPw(''); setResetLink(null); setEditLoading(true)
    try {
      const d = (await get(`reviews/client?business_id=${c.id}`)) as unknown as ClientDetail
      setDetail(d)
      setForm({
        business_name: d.business.name ?? '',
        owner_name: d.owner.name ?? '',
        owner_email: d.owner.email ?? '',
        plan: d.business.plan ?? '',
        settings: d.settings ?? {},
      })
    } catch (err) {
      setEditMsg((err as Error).message)
    }
    setEditLoading(false)
  }

  function setS(key: string, value: unknown) {
    setForm((f) => ({ ...f, settings: { ...f.settings, [key]: value } }))
  }

  // Integer setter: rounds + clamps to [min,max] and treats a cleared field as
  // the minimum, so a value can never violate the review_settings CHECK bounds.
  function setNum(key: string, raw: string, min: number, max: number) {
    if (raw === '') { setS(key, min); return }
    const n = Math.round(Number(raw))
    setS(key, Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min)
  }

  async function saveEdit() {
    setEditBusy('save'); setEditMsg(null)
    try {
      await post('reviews/client', {
        action: 'update', business_id: editId,
        business_name: form.business_name, owner_name: form.owner_name, owner_email: form.owner_email,
        plan: form.plan, settings: form.settings,
      })
      setEditMsg('Saved.')
      clients.refetch()
    } catch (err) {
      setEditMsg((err as Error).message)
    }
    setEditBusy(null)
  }

  async function setPassword() {
    if (newPw.length < 8) { setEditMsg('Password must be at least 8 characters.'); return }
    setEditBusy('pw'); setEditMsg(null)
    try {
      await post('reviews/client', { action: 'set_password', business_id: editId, password: newPw })
      setEditMsg('Password set — tell the client their new password.')
      setNewPw('')
    } catch (err) {
      setEditMsg((err as Error).message)
    }
    setEditBusy(null)
  }

  async function sendReset() {
    setEditBusy('reset'); setEditMsg(null)
    try {
      const out = await post('reviews/client', { action: 'send_reset', business_id: editId })
      setResetLink(out.resetLink ? String(out.resetLink) : null)
      setEditMsg(out.emailed ? 'Reset link emailed to the client.' : 'Email did not send — copy the link below and send it manually.')
    } catch (err) {
      setEditMsg((err as Error).message)
    }
    setEditBusy(null)
  }

  async function buyNumber(r: NumberRequest) {
    if (!window.confirm(`Buy a UK number for ${r.business_name}? (~£1-2/mo on the Elsie Twilio account)`)) return
    setBusy(r.id)
    setMsg(null)
    try {
      const out = await post('reviews/numbers', { request_id: r.id, action: 'buy' })
      setMsg(`Purchased ${out.number} for ${r.business_name} — inbound STOP webhook wired automatically.`)
      numbers.refetch()
      clients.refetch()
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(null)
  }

  async function rewardReferral(r: Referral) {
    setBusy(r.id)
    try {
      await post('reviews/referrals', { referral_id: r.id })
      referrals.refetch()
      setMsg('Marked rewarded — remember to actually send both £100 gift cards!')
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(null)
  }

  async function onboard() {
    setBusy('onboard')
    setMsg(null)
    try {
      const out = await post('reviews/onboard', {
        business_name: obBusiness, owner_name: obName, owner_email: obEmail, plan_key: obPlan,
      })
      setObResult({ paymentLink: String(out.paymentLink), setPasswordLink: out.setPasswordLink ? String(out.setPasswordLink) : null })
      clients.refetch()
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(null)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const sNum = (k: string, d: number) => { const v = form.settings[k]; return typeof v === 'number' ? v : (v == null || v === '' ? d : Number(v)) }
  const sBool = (k: string, d: boolean) => { const v = form.settings[k]; return typeof v === 'boolean' ? v : d }
  const sStr = (k: string) => { const v = form.settings[k]; return v == null ? '' : String(v) }

  const pendingNumbers = numbers.data.requests.filter((r) => r.status === 'pending')
  const payoutQueue = referrals.data.referrals.filter((r) => r.status === 'paid')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Reviews clients</h1>
          <p className="text-sm text-ink-subtle">{clients.data.clients.length} clients · {pendingNumbers.length} numbers to buy · {payoutQueue.length} referral payouts due</p>
        </div>
        <Button size="sm" onClick={() => { setOnboardOpen(true); setObResult(null) }}>
          <UserPlus style={{ width: 14, height: 14 }} /> Onboard client
        </Button>
      </div>

      <div className="flex gap-1 rounded-xl bg-border/40 p-1 sm:w-fit">
        {([['clients', 'Clients'], ['numbers', `Numbers${pendingNumbers.length ? ` (${pendingNumbers.length})` : ''}`], ['referrals', `Referrals${payoutQueue.length ? ` (${payoutQueue.length})` : ''}`]] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('rounded-lg px-4 py-1.5 text-sm font-medium', tab === t ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="rounded-xl bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700">{msg}</p>}

      {tab === 'clients' && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Usage</th>
                <th className="px-4 py-3">Google</th>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Flags</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.data.clients.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-ink-subtle">{c.owner?.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{c.plan?.replace('reviews_', '') ?? '—'}</p>
                    <p className="text-xs text-ink-subtle">{c.billing_status ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{c.used}/{c.cap}</p>
                    <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-border">
                      <div className={cn('h-full', c.used >= c.cap ? 'bg-red-500' : 'bg-brand')} style={{ width: `${Math.min(100, (c.used / c.cap) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.gbp_status === 'connected' ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <Star className="fill-amber-400 text-amber-400" style={{ width: 13, height: 13 }} />
                        {c.rating ?? '—'} · {c.total_reviews ?? 0}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">{c.gbp_status}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.sms_from_number ?? <span className="font-medium text-amber-600">{c.pending_number_request ? 'NEEDS NUMBER' : '—'}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-subtle">
                    {c.sending_paused && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">paused</span>}
                    {!c.attested && <span className="mr-1 rounded bg-red-100 px-1.5 py-0.5 text-red-700">no attestation</span>}
                    {c.pending_replies > 0 && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">{c.pending_replies} replies</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => openEdit(c)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-ink-subtle hover:text-ink">
                        <Pencil style={{ width: 12, height: 12 }} /> Edit
                      </button>
                      <a href={`https://go.heyelsie.com/dashboard?as=${c.id}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                        View as client <ExternalLink style={{ width: 12, height: 12 }} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.data.clients.length === 0 && !clients.loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-subtle">No review clients yet — onboard the first one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'numbers' && (
        <div className="space-y-2">
          {numbers.data.requests.length === 0 && <p className="py-8 text-center text-sm text-ink-subtle">No number requests.</p>}
          {numbers.data.requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div>
                <p className="text-sm font-medium text-ink">{r.business_name}</p>
                <p className="text-xs text-ink-subtle">{r.note} · {new Date(r.created_at).toLocaleDateString('en-GB')}</p>
                {r.purchased_number && <p className="text-xs font-medium text-emerald-600">{r.purchased_number}</p>}
              </div>
              {r.status === 'pending' ? (
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy === r.id} onClick={() => buyNumber(r)}>
                    <Phone style={{ width: 13, height: 13 }} /> {busy === r.id ? 'Buying…' : 'Buy UK number'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === r.id}
                    onClick={() => post('reviews/numbers', { request_id: r.id, action: 'dismiss' }).then(() => numbers.refetch())}>
                    Dismiss
                  </Button>
                </div>
              ) : (
                <span className="rounded-full bg-border/50 px-2.5 py-0.5 text-[11px] font-medium text-ink-subtle">{r.status}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'referrals' && (
        <div className="space-y-2">
          {referrals.data.referrals.length === 0 && <p className="py-8 text-center text-sm text-ink-subtle">No referrals yet.</p>}
          {referrals.data.referrals.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div>
                <p className="text-sm font-medium text-ink">{r.referrer_name} → {r.invitee_business_name || r.invitee_email}</p>
                <p className="text-xs text-ink-subtle">{new Date(r.created_at).toLocaleDateString('en-GB')} · {r.status}</p>
              </div>
              {r.status === 'paid' ? (
                <Button size="sm" disabled={busy === r.id} onClick={() => rewardReferral(r)}>
                  <Gift style={{ width: 13, height: 13 }} /> Send £100 + £100, mark done
                </Button>
              ) : (
                <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  r.status === 'rewarded' ? 'bg-emerald-100 text-emerald-700' : 'bg-border/50 text-ink-subtle')}>
                  {r.status}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={onboardOpen} onClose={() => setOnboardOpen(false)}>
        <div className="space-y-3 p-5">
          <h3 className="text-base font-semibold text-ink">Onboard a client (closer flow)</h3>
          {obResult ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-700">Account created. Two links to send:</p>
              <div>
                <p className="text-xs font-medium text-ink-subtle">Payment link (text it to them now, mid-call)</p>
                <div className="flex gap-2">
                  <Input readOnly value={obResult.paymentLink} className="text-xs" />
                  <Button size="sm" variant="secondary" onClick={() => copy(obResult.paymentLink, 'pay')}>
                    {copied === 'pay' ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
                  </Button>
                </div>
              </div>
              {obResult.setPasswordLink && (
                <div>
                  <p className="text-xs font-medium text-ink-subtle">Set-password link (also emailed to them)</p>
                  <div className="flex gap-2">
                    <Input readOnly value={obResult.setPasswordLink} className="text-xs" />
                    <Button size="sm" variant="secondary" onClick={() => copy(obResult.setPasswordLink!, 'pw')}>
                      {copied === 'pw' ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-ink-subtle">A sender-number request is already in the Numbers queue.</p>
            </div>
          ) : (
            <>
              <Input placeholder="Business name" value={obBusiness} onChange={(e) => setObBusiness(e.target.value)} />
              <Input placeholder="Owner name" value={obName} onChange={(e) => setObName(e.target.value)} />
              <Input type="email" placeholder="Owner email" value={obEmail} onChange={(e) => setObEmail(e.target.value)} />
              <div className="flex gap-2">
                {clients.data.plans.map((p) => (
                  <button key={p.key} onClick={() => setObPlan(p.key)}
                    className={cn('flex-1 rounded-xl border px-3 py-2 text-sm font-medium',
                      obPlan === p.key ? 'border-brand bg-brand-50 text-brand-700' : 'border-border text-ink-subtle')}>
                    {p.name}<br /><span className="text-xs">£{p.priceGbp}/mo</span>
                  </button>
                ))}
              </div>
              <Button className="w-full" disabled={busy === 'onboard' || !obBusiness || !obName || !obEmail} onClick={onboard}>
                {busy === 'onboard' ? 'Creating…' : 'Create account + get payment link'}
              </Button>
            </>
          )}
        </div>
      </Dialog>

      <Dialog open={!!editId} onClose={() => setEditId(null)}>
        <div className="max-h-[85vh] space-y-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink">Edit client</h3>
            {detail?.business.billing_status && (
              <span className="rounded-full bg-border/50 px-2.5 py-0.5 text-[11px] font-medium text-ink-subtle">{detail.business.billing_status}</span>
            )}
          </div>

          {editMsg && <p className="rounded-xl bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700">{editMsg}</p>}
          {editLoading && <p className="py-6 text-center text-sm text-ink-subtle">Loading…</p>}

          {detail && !editLoading && (
            <>
              {/* Account */}
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Account</p>
                <label className="block text-xs font-medium text-ink-subtle">Company name
                  <Input className="mt-1" value={form.business_name} onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))} />
                </label>
                <label className="block text-xs font-medium text-ink-subtle">Owner name
                  <Input className="mt-1" value={form.owner_name} onChange={(e) => setForm((f) => ({ ...f, owner_name: e.target.value }))} />
                </label>
                <label className="block text-xs font-medium text-ink-subtle">Owner email
                  <Input className="mt-1" type="email" value={form.owner_email} onChange={(e) => setForm((f) => ({ ...f, owner_email: e.target.value }))} />
                </label>
                <label className="block text-xs font-medium text-ink-subtle">Plan
                  <Select className="mt-1" value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}>
                    <option value="">— no plan —</option>
                    {detail.plans.map((p) => <option key={p.key} value={p.key}>{p.name} · £{p.priceGbp}/mo</option>)}
                  </Select>
                </label>
              </div>

              {/* Review settings */}
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Review settings</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium text-ink-subtle">Greeting first name
                    <Input className="mt-1" value={sStr('owner_first_name')} onChange={(e) => setS('owner_first_name', e.target.value)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">AI reply business name
                    <Input className="mt-1" value={sStr('business_display_name')} onChange={(e) => setS('business_display_name', e.target.value)} />
                  </label>
                  <label className="col-span-2 block text-xs font-medium text-ink-subtle">Sender number (Twilio)
                    <Input className="mt-1" value={sStr('sms_from_number')} onChange={(e) => setS('sms_from_number', e.target.value)} placeholder="+44…" />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">Timezone
                    <Input className="mt-1" value={sStr('timezone')} onChange={(e) => setS('timezone', e.target.value)} placeholder="Europe/London" />
                  </label>
                  <div />
                  <label className="block text-xs font-medium text-ink-subtle">Quiet start (24h)
                    <Input className="mt-1" type="number" step={1} min={0} max={23} value={sNum('quiet_start', 9)} onChange={(e) => setNum('quiet_start', e.target.value, 0, 23)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">Quiet end (24h)
                    <Input className="mt-1" type="number" step={1} min={0} max={23} value={sNum('quiet_end', 20)} onChange={(e) => setNum('quiet_end', e.target.value, 0, 23)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">Sends per day
                    <Input className="mt-1" type="number" step={1} min={1} max={1000} value={sNum('drip_per_day', 25)} onChange={(e) => setNum('drip_per_day', e.target.value, 1, 1000)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">First send delay (hrs)
                    <Input className="mt-1" type="number" step={1} min={0} max={168} value={sNum('initial_delay_hours', 0)} onChange={(e) => setNum('initial_delay_hours', e.target.value, 0, 168)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">Follow-ups
                    <Input className="mt-1" type="number" step={1} min={0} max={3} value={sNum('followup_count', 2)} onChange={(e) => setNum('followup_count', e.target.value, 0, 3)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-subtle">Follow-up gap (days)
                    <Input className="mt-1" type="number" step={1} min={1} max={14} value={sNum('followup_gap_days', 3)} onChange={(e) => setNum('followup_gap_days', e.target.value, 1, 14)} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-4 pt-1">
                  <div className="flex items-center gap-2"><Switch checked={sBool('followups_enabled', true)} onChange={(v) => setS('followups_enabled', v)} /><span className="text-xs text-ink">Follow-ups on</span></div>
                  <div className="flex items-center gap-2"><Switch checked={sBool('image_enabled', true)} onChange={(v) => setS('image_enabled', v)} /><span className="text-xs text-ink">Personalized image</span></div>
                  <div className="flex items-center gap-2"><Switch checked={sBool('smart_messaging', true)} onChange={(v) => setS('smart_messaging', v)} /><span className="text-xs text-ink">Smart messaging</span></div>
                  <div className="flex items-center gap-2"><Switch checked={sBool('sending_paused', false)} onChange={(v) => setS('sending_paused', v)} /><span className="text-xs text-ink">Sending paused</span></div>
                </div>
              </div>

              <Button className="w-full" disabled={editBusy === 'save'} onClick={saveEdit}>
                {editBusy === 'save' ? 'Saving…' : 'Save changes'}
              </Button>

              {/* Password */}
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Password</p>
                <div className="flex gap-2">
                  <Input type="text" placeholder="New password (min 8 chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <Button size="sm" variant="secondary" disabled={editBusy === 'pw' || newPw.length < 8} onClick={setPassword}>
                    <KeyRound style={{ width: 13, height: 13 }} /> {editBusy === 'pw' ? 'Setting…' : 'Set'}
                  </Button>
                </div>
                <Button size="sm" variant="ghost" disabled={editBusy === 'reset'} onClick={sendReset}>
                  <Mail style={{ width: 13, height: 13 }} /> {editBusy === 'reset' ? 'Sending…' : 'Email client a reset link'}
                </Button>
                {resetLink && (
                  <div className="flex gap-2">
                    <Input readOnly value={resetLink} className="text-xs" />
                    <Button size="sm" variant="secondary" onClick={() => copy(resetLink, 'reset')}>
                      {copied === 'reset' ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Dialog>
    </div>
  )
}
