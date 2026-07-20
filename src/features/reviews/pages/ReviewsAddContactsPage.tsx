import { useRef, useState, type FormEvent } from 'react'
import Papa from 'papaparse'
import { Upload, Download, Rocket } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { SectionCard } from '@/core/ui/SectionCard'
import { Switch } from '@/core/ui/Switch'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession, reviewsApi } from '../lib'

type Tab = 'single' | 'csv'

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.trim().toLowerCase())) return row[k]?.trim() ?? ''
  }
  return ''
}

export default function ReviewsAddContactsPage() {
  const session = useReviewsSession()
  const [tab, setTab] = useState<Tab>('single')

  // Single contact
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [doNotContact, setDoNotContact] = useState(false)
  const [consent, setConsent] = useState(false)
  const [singleMsg, setSingleMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // CSV
  const fileRef = useRef<HTMLInputElement>(null)
  const [csvResult, setCsvResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<string | null>(null)

  async function addSingle(e: FormEvent) {
    e.preventDefault()
    if (!email && !phone) { setSingleMsg('At least one contact method (email or phone) is required'); return }
    if (!doNotContact && !consent) { setSingleMsg('Please confirm you have consent to message this customer'); return }
    setBusy(true)
    setSingleMsg(null)
    try {
      const { error } = await supabase.from('contacts').insert({
        business_id: session.businessId,
        name: `${first} ${last}`.trim(),
        phone: phone || null,
        email: email || null,
      })
      if (error) throw new Error(error.message)
      if (doNotContact) {
        await reviewsApi('/api/reviews/suppress', {
          body: { phone: phone || undefined, email: email || undefined },
          impersonateBusinessId: session.impersonating ? session.businessId : null,
        })
      }
      setSingleMsg(doNotContact ? 'Contact added to the do-not-contact list.' : 'Contact added — they\'ll be included in your next campaign.')
      setFirst(''); setLast(''); setEmail(''); setPhone(''); setConsent(false); setDoNotContact(false)
    } catch (err) {
      setSingleMsg((err as Error).message)
    }
    setBusy(false)
  }

  function downloadTemplate() {
    const blob = new Blob(['First Name,Last Name,Phone Number,Email\nSally,Smith,07700900123,sally@example.com\n'], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'heyelsie-contacts-template.csv'
    a.click()
  }

  function handleFile(file: File) {
    setCsvError(null)
    setCsvResult(null)
    if (file.size > 10 * 1024 * 1024) { setCsvError('CSV must be under 10MB'); return }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data.map((row) => {
          const firstName = pick(row, ['first name', 'firstname', 'first'])
          const lastName = pick(row, ['last name', 'lastname', 'last', 'surname'])
          const fullName = pick(row, ['full name', 'name', 'customer name'])
          return {
            name: fullName || `${firstName} ${lastName}`.trim(),
            phone: pick(row, ['phone', 'phone number', 'mobile', 'mobile number', 'tel', 'telephone']),
            email: pick(row, ['email', 'email address', 'e-mail']),
          }
        }).filter((r) => r.phone || r.email)
        if (!rows.length) { setCsvError('No usable rows found — the file needs a Phone or Email column.'); return }
        try {
          const out = await reviewsApi<{ imported: number; skipped: number }>('/api/contacts/import', {
            body: { rows },
            impersonateBusinessId: session.impersonating ? session.businessId : null,
          })
          setCsvResult({ imported: out.imported ?? rows.length, skipped: out.skipped ?? 0 })
        } catch (err) {
          setCsvError((err as Error).message)
        }
      },
      error: () => setCsvError('Could not read that file — is it a CSV?'),
    })
  }

  async function launchReactivation() {
    setLaunching(true)
    setLaunchResult(null)
    try {
      const out = await reviewsApi<{ queued: number; firstSendAt: string }>('/api/reviews/campaigns', {
        body: { type: 'reactivation' },
        impersonateBusinessId: session.impersonating ? session.businessId : null,
      })
      setLaunchResult(`Campaign launched — ${out.queued} requests queued, first sends ${new Date(out.firstSendAt).toLocaleString('en-GB')}. They drip out gradually so reviews look organic.`)
    } catch (err) {
      setLaunchResult((err as Error).message)
    }
    setLaunching(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Add contacts</h1>
        <p className="text-sm text-ink-subtle">Add contacts individually or import from a CSV file</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-border/40 p-1 sm:w-fit">
        {(['single', 'csv'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('flex-1 rounded-lg px-4 py-1.5 text-sm font-medium sm:flex-none',
              tab === t ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
            {t === 'single' ? 'Single contact' : 'Import CSV'}
          </button>
        ))}
      </div>

      {tab === 'single' ? (
        <SectionCard title="Add a single contact">
          <form onSubmit={addSingle} className="max-w-md space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-border/30 px-3 py-2">
              <span className="text-sm text-ink">Add to do-not-contact list<br /><span className="text-xs text-ink-subtle">Contact will never receive any messages</span></span>
              <Switch checked={doNotContact} onChange={setDoNotContact} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="First name *" value={first} onChange={(e) => setFirst(e.target.value)} required />
              <Input placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
            <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Phone number (07…)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <p className="text-xs text-ink-subtle">At least one contact method (email or phone) is required</p>
            {!doNotContact && (
              <label className="flex items-start gap-2 text-xs text-ink">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-brand" />
                I have the required consent to message this customer by email or SMS
              </label>
            )}
            {singleMsg && <p className="text-sm text-brand-700">{singleMsg}</p>}
            <Button type="submit" disabled={busy || !first}>{busy ? 'Adding…' : 'Add contact'}</Button>
          </form>
        </SectionCard>
      ) : (
        <SectionCard title="Upload CSV file">
          <div className="max-w-lg space-y-4">
            <div className="rounded-xl bg-border/30 p-3 text-sm">
              <p className="font-medium text-ink">Your CSV needs:</p>
              <ul className="mt-1 list-disc pl-5 text-ink-subtle">
                <li><strong>Name</strong>: First Name, Last Name, or Full Name column</li>
                <li><strong>Contact</strong>: Phone Number or Email column</li>
              </ul>
              <button onClick={downloadTemplate} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
                <Download style={{ width: 14, height: 14 }} /> Download template
              </button>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border p-8 text-center hover:border-brand/50"
            >
              <Upload className="text-ink-subtle" style={{ width: 24, height: 24 }} />
              <span className="text-sm font-medium text-ink">Click to upload or drag and drop</span>
              <span className="text-xs text-ink-subtle">CSV files only, up to 10MB</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {csvError && <p className="text-sm text-danger">{csvError}</p>}
            {csvResult && (
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-sm font-medium text-emerald-800">
                  Imported {csvResult.imported} contacts{csvResult.skipped ? ` (${csvResult.skipped} skipped)` : ''}.
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  Ready to ask them all for a review? Requests go to every eligible contact — never a hand-picked
                  happy few (that's against Google's rules and UK law) — and drip out gradually.
                </p>
                <Button onClick={launchReactivation} disabled={launching} className="mt-3" size="sm">
                  <Rocket style={{ width: 14, height: 14 }} /> {launching ? 'Launching…' : 'Launch reactivation campaign'}
                </Button>
                {launchResult && <p className="mt-2 text-xs text-emerald-800">{launchResult}</p>}
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
