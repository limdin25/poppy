import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { callWaAdmin, EMPTY_PROFILE, type SenderProfile } from '../../lib/waAdmin';

/**
 * The WhatsApp business profile: what a lead sees when they tap the sender's
 * name (Hugo 2026-08-03). Deliberately its OWN card, with its own Save,
 * because it has nothing to do with message templates.
 */

// Twilio's allowed vertical labels for a WhatsApp sender profile.
const VERTICALS = [
  '', 'Professional Services', 'Automotive', 'Beauty, Spa and Salon',
  'Clothing and Apparel', 'Education', 'Entertainment',
  'Event Planning and Service', 'Finance and Banking', 'Food and Grocery',
  'Public Service', 'Hotel and Lodging', 'Medical and Health', 'Non-profit',
  'Shopping and Retail', 'Travel and Transportation', 'Restaurant', 'Other',
];

const inputCls =
  'w-full border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-[13px] text-[#1A1A1A] bg-white focus:outline-none focus:border-[#3C5A87]';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-[#6B7280] mb-1';

export default function WhatsAppProfileCard() {
  const [profile, setProfile] = useState<SenderProfile>(EMPTY_PROFILE);
  const [senderLine, setSenderLine] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callWaAdmin<{
        sender: string; status: string; quality_rating: string;
        messaging_limit: string; profile: SenderProfile;
      }>({ action: 'profile_get' });
      setProfile({ ...EMPTY_PROFILE, ...res.profile });
      setSenderLine(
        `${res.sender.replace('whatsapp:', '')} is ${res.status}. Quality ${res.quality_rating || 'unknown'}, limit ${res.messaging_limit || 'unknown'}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const res = await callWaAdmin<{ note?: string }>({ action: 'profile_update', profile });
      setNote(res.note ?? 'Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const setP = (key: keyof SenderProfile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setProfile((p) => ({ ...p, [key]: e.target.value }));

  return (
    <section
      data-testid="wa-profile-card"
      className="bg-white border border-[#E5E7EB] rounded-2xl p-5"
    >
      <h2 className="text-[15px] font-bold text-[#1A1A1A] mb-1">WhatsApp business profile</h2>
      <p className="text-[11px] text-[#6B7280] leading-snug mb-3">
        What a lead sees when they tap your name in WhatsApp. Nothing here touches your
        templates.{senderLine ? ` ${senderLine}` : ''}
      </p>

      {error && (
        <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {note && (
        <div className="mb-3 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {note}
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-[#6B7280] py-2">Loading profile from Twilio...</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Display name (Meta reviews changes)</label>
            <input className={inputCls} value={profile.name} onChange={setP('name')} data-testid="wa-profile-name" />
          </div>
          <div>
            <label className={labelCls}>About / bio ({profile.about.length}/139)</label>
            <input className={inputCls} maxLength={139} value={profile.about} onChange={setP('about')} data-testid="wa-profile-about" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Description ({profile.description.length}/512)</label>
            <input className={inputCls} maxLength={512} value={profile.description} onChange={setP('description')} />
          </div>
          <div>
            <label className={labelCls}>Website</label>
            <input className={inputCls} placeholder="https://heypubli.com" value={profile.website} onChange={setP('website')} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={profile.email} onChange={setP('email')} />
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <input className={inputCls} value={profile.address} onChange={setP('address')} />
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <select className={inputCls} value={profile.vertical} onChange={setP('vertical')}>
              {VERTICALS.map((v) => (
                <option key={v || 'none'} value={v}>{v || 'Not set'}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Logo URL (public image link)</label>
            <input className={inputCls} value={profile.logo_url} onChange={setP('logo_url')} />
          </div>
          <div className="col-span-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              data-testid="wa-profile-save"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3C5A87] text-white text-[12px] font-medium',
                saving && 'opacity-50',
              )}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save profile
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
