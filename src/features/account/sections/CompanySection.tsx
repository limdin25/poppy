import { useState, useEffect, useRef } from 'react'
import { Building2, Globe, Camera, Loader2, Coins } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { CURRENCIES, type Currency } from '@/core/lib/currency'
import AddressAutocomplete from '@/core/components/AddressAutocomplete'
import TeamSection from './TeamSection'

export default function CompanySection() {
  const { businessId } = useAuth()
  const { data: business, loading, refetch } = useBusiness()
  const [businessName, setBusinessName] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [currency, setCurrency] = useState<Currency>('GBP')
  const [logoUrl, setLogoUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (business) {
      setBusinessName(business.name || '')
      setWebsite(business.website || '')
      setAddress(business.address || '')
      setCurrency((business.currency as Currency) || 'GBP')
      setLogoUrl(business.logo_url || '')
    }
  }, [business])

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !businessId) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `logos/${businessId}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('uploads').upload(path, file, { upsert: true })
    if (uploadErr) { setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path)
    await supabase.from('businesses').update({ logo_url: publicUrl }).eq('id', businessId)
    setLogoUrl(publicUrl)
    setUploading(false)
  }

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    await supabase
      .from('businesses')
      .update({ name: businessName, website, address, currency })
      .eq('id', businessId)
    refetch()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Business Details</h2>

        <div className="mt-4 flex items-center gap-4">
          <div className="relative">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-elevated text-ink-subtle">
                <Building2 size={24} />
              </div>
            )}
            {uploading && <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30"><Loader2 size={16} className="animate-spin text-white" /></div>}
          </div>
          <div>
            <button onClick={() => logoRef.current?.click()} className="flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
              <Camera size={14} />
              {logoUrl ? 'Change logo' : 'Upload logo'}
            </button>
            <p className="mt-0.5 text-[12px] text-ink-subtle">PNG or JPG, max 2MB</p>
            <input ref={logoRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-[13px] font-medium text-ink">Business name</label>
            <div className="relative mt-1.5">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Website</label>
            <div className="relative mt-1.5">
              <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Business address</label>
            <div className="mt-1.5">
              <AddressAutocomplete value={address} onChange={setAddress} />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Currency</label>
            <p className="text-[12px] text-ink-subtle">Used for deal values across the inbox and pipeline.</p>
            <div className="relative mt-1.5">
              <Coins size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <select
                data-testid="currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-accent px-6 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saved ? 'Saved!' : 'Save changes'}
        </button>
      </div>

      <TeamSection />
    </div>
  )
}
